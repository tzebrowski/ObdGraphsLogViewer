import { AppState, DOM } from './config.js';
import { Chart } from 'chart.js';

export const DynoManager = {
  chartInstance: null,

  init() {
    window.openDynoModal = () => this.openModal();
    window.closeDynoModal = () => this.closeModal();
  },

  openModal() {
    const modal = document.getElementById('dynoModal');
    if (modal) {
      modal.style.display = 'flex';
      this.injectExportButton(modal);
      this.render();
    }
  },

  closeModal() {
    const modal = document.getElementById('dynoModal');
    if (modal) {
      modal.style.display = 'none';
      if (this.chartInstance) {
        this.chartInstance.destroy();
        this.chartInstance = null;
      }
    }
  },

  injectExportButton(modal) {
    const header = modal.querySelector('.modal-header');
    // Inject the export button if it doesn't already exist
    if (header && !document.getElementById('btn-export-dyno')) {
      const exportBtn = document.createElement('button');
      exportBtn.id = 'btn-export-dyno';
      exportBtn.className = 'btn btn-sm btn-primary';
      exportBtn.style.marginRight = 'auto';
      exportBtn.style.marginLeft = '15px';
      exportBtn.innerHTML = '<i class="fas fa-camera"></i> Save PNG';
      exportBtn.onclick = () => this.exportChart();
      header.insertBefore(exportBtn, header.querySelector('.btn-close'));
    }
  },

  exportChart() {
    const canvas = document.getElementById('dynoCanvas');
    if (!canvas) return;
    
    // Create a temporary canvas to draw the background color
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const ctx = tempCanvas.getContext('2d');
    
    // Fill background to match theme so it's not transparent
    const isDark = document.body.classList.contains('dark-theme') || document.body.classList.contains('pref-theme-dark');
    ctx.fillStyle = isDark ? '#1e1e1e' : '#ffffff';
    ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    
    // Draw the original chart on top
    ctx.drawImage(canvas, 0, 0);

    const link = document.createElement('a');
    link.download = 'mygiulia_virtual_dyno.png';
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
  },

  extractPulls(file) {
    const pulls = [];
    let currentPull = { rpm: [], torque: [], power: [], time: [] };
    let inPull = false;
    let hitWot = false; // Tracks if the 85% threshold was met during the 60% window

    // Detect necessary signals using strictly lowercase searches
    const rpmKey = file.availableSignals.find(s => s.toLowerCase().includes('engine speed') || s.toLowerCase().includes('rpm'));
    const torqueKey = file.availableSignals.find(s => s.toLowerCase().includes('measured engine torque') || s.toLowerCase().includes('engine torque'));
    const pedalKey = file.availableSignals.find(s => s.toLowerCase().includes('gas pedal') || s.toLowerCase().includes('throttle'));

    if (!rpmKey || !torqueKey) return pulls;

    const rpmData = file.signals[rpmKey] || [];
    const torqueData = file.signals[torqueKey] || [];
    const pedalData = pedalKey ? (file.signals[pedalKey] || []) : [];

    // Auto-adjust threshold based on max pedal value actually recorded in the log
    let maxPedal = 0;
    pedalData.forEach(p => { 
      const val = parseFloat(p.y);
      if (val > maxPedal) maxPedal = val; 
    });
    
    // DUAL THRESHOLD: Start recording at 60% to catch spool, require 85% to validate as a WOT sweep
    const pedalThresholdWOT = maxPedal <= 1.0 ? 0.85 : (maxPedal * 0.85);
    const pedalThresholdStart = maxPedal <= 1.0 ? 0.60 : (maxPedal * 0.60);

    // Merge all unique timestamps
    const timeSet = new Set();
    rpmData.forEach(p => timeSet.add(p.x));
    torqueData.forEach(p => timeSet.add(p.x));
    pedalData.forEach(p => timeSet.add(p.x));
    
    const times = Array.from(timeSet).sort((a, b) => a - b);

    let lastRpm = null;
    let lastTorque = null;
    let lastPedal = pedalKey ? null : 100;

    let rIdx = 0, tIdx = 0, pIdx = 0;

    times.forEach(t => {
      // Forward-fill logic
      while (rIdx < rpmData.length && rpmData[rIdx].x <= t) { 
        lastRpm = parseFloat(rpmData[rIdx].y); 
        rIdx++; 
      }
      while (tIdx < torqueData.length && torqueData[tIdx].x <= t) { 
        lastTorque = parseFloat(torqueData[tIdx].y); 
        tIdx++; 
      }
      while (pIdx < pedalData.length && pedalData[pIdx].x <= t) { 
        lastPedal = parseFloat(pedalData[pIdx].y); 
        pIdx++; 
      }

      // Check if we are above the starting threshold (60%)
      if (lastPedal > pedalThresholdStart && lastRpm !== null && lastTorque !== null) {
        inPull = true;
        // Flag if we actually hit the required WOT threshold (85%) during this sweep
        if (lastPedal >= pedalThresholdWOT) hitWot = true;

        const power = (lastTorque * lastRpm) / 7021.5; 
        currentPull.rpm.push(lastRpm);
        currentPull.torque.push(lastTorque);
        currentPull.power.push(power);
        currentPull.time.push(t);
      } else if (inPull) {
        // Pedal dropped below 60%. Save pull if it hit 85% and was long enough
        if (hitWot && currentPull.rpm.length > 0 && (Math.max(...currentPull.rpm) - Math.min(...currentPull.rpm) > 1200)) {
          pulls.push(currentPull);
        }
        currentPull = { rpm: [], torque: [], power: [], time: [] };
        inPull = false;
        hitWot = false;
      }
    });
    
    if (inPull && hitWot && currentPull.rpm.length > 0 && (Math.max(...currentPull.rpm) - Math.min(...currentPull.rpm) > 1200)) {
      pulls.push(currentPull);
    }

    return pulls;
  },

  render() {
    const canvas = document.getElementById('dynoCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    if (this.chartInstance) {
      this.chartInstance.destroy();
    }

    if (AppState.files.length === 0) return;

    const file = AppState.files[0]; 
    const pulls = this.extractPulls(file);

    if (pulls.length === 0) {
      alert("No Wide Open Throttle (WOT) sweeps detected in the active log.\n\nA WOT sweep requires >85% pedal position and >1200 RPM delta.");
      this.closeModal();
      return;
    }

    // Pick the longest RPM sweep
    pulls.sort((a, b) => (Math.max(...b.rpm) - Math.min(...b.rpm)) - (Math.max(...a.rpm) - Math.min(...a.rpm)));
    const bestPull = pulls[0];

    // --- BINNING & SMOOTHING LOGIC ---
    // 1. Group data into 50 RPM buckets to eliminate the "staircase" OBD polling effect
    const binSize = 50; 
    const binnedData = {};

    bestPull.rpm.forEach((rpm, i) => {
      const bin = Math.round(rpm / binSize) * binSize;
      if (!binnedData[bin]) {
        binnedData[bin] = { torqueSum: 0, powerSum: 0, count: 0 };
      }
      binnedData[bin].torqueSum += bestPull.torque[i];
      binnedData[bin].powerSum += bestPull.power[i];
      binnedData[bin].count++;
    });

    const binnedPoints = Object.keys(binnedData)
      .map(Number)
      .sort((a, b) => a - b)
      .map(bin => ({
        rpm: bin,
        torque: binnedData[bin].torqueSum / binnedData[bin].count,
        power: binnedData[bin].powerSum / binnedData[bin].count
      }));

    // 2. Apply a moving average over the bins for that buttery-smooth dyno look
    const dataPoints = binnedPoints.map((dp, i, arr) => {
      const windowSize = 2; // Reduced slightly to keep the ends sharp
      let tSum = 0, pSum = 0, count = 0;
      for (let j = Math.max(0, i - windowSize); j <= Math.min(arr.length - 1, i + windowSize); j++) {
        tSum += arr[j].torque;
        pSum += arr[j].power;
        count++;
      }
      return { rpm: dp.rpm, torque: tSum / count, power: pSum / count };
    });

    const torqueData = dataPoints.map(d => ({ x: d.rpm, y: d.torque }));
    const powerData = dataPoints.map(d => ({ x: d.rpm, y: d.power }));

    const maxTorque = Math.max(...dataPoints.map(d => d.torque));
    const maxPower = Math.max(...dataPoints.map(d => d.power));

    this.chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Torque (Nm)',
            data: torqueData,
            borderColor: '#1c3d72',
            backgroundColor: 'rgba(28, 61, 114, 0.1)',
            yAxisID: 'yTorque',
            tension: 0.4,
            cubicInterpolationMode: 'monotone',
            pointRadius: 0,
            borderWidth: 3
          },
          {
            label: 'Power (KM)',
            data: powerData,
            borderColor: '#c22636',
            backgroundColor: 'rgba(194, 38, 54, 0.1)',
            yAxisID: 'yPower',
            tension: 0.4,
            cubicInterpolationMode: 'monotone',
            pointRadius: 0,
            borderWidth: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          datalabels: {
            display: false
          },
          title: {
            display: true,
            text: `Virtual Dyno - Max Power: ${maxPower.toFixed(1)} KM | Max Torque: ${maxTorque.toFixed(1)} Nm`,
            font: { size: 16, weight: 'bold' }
          },
          tooltip: {
            callbacks: {
              label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(1)}`
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: 'Engine Speed (RPM)' },
            grid: { color: 'rgba(255,255,255,0.05)' },
            min: Math.floor(Math.min(...bestPull.rpm) / 500) * 500,
            max: Math.ceil(Math.max(...bestPull.rpm) / 500) * 500
          },
          yTorque: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Torque (Nm)' },
            min: 0,
            max: Math.ceil(maxTorque / 100) * 100 + 100,
            grid: { color: 'rgba(255,255,255,0.05)' }
          },
          yPower: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'Power (KM)' },
            min: 0,
            max: Math.ceil(maxPower / 100) * 100 + 50,
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  }
};

