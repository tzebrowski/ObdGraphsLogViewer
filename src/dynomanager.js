import { AppState, DOM } from './config.js';
import { Chart } from 'chart.js';

export const DynoManager = {
  chartInstance: null,
  currentPulls: [],
  selectedPullIndex: 0,

  init() {
    window.openDynoModal = () => this.openModal();
    window.closeDynoModal = () => this.closeModal();
  },

  openModal() {
    const modal = document.getElementById('dynoModal');
    if (modal) {
      modal.style.display = 'flex';
      this.injectHeaderControls(modal);
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
      this.currentPulls = [];
      this.selectedPullIndex = 0;
    }
  },

  injectHeaderControls(modal) {
    const header = modal.querySelector('.modal-header');
    if (header && !document.getElementById('dyno-controls')) {
      const controlsDiv = document.createElement('div');
      controlsDiv.id = 'dyno-controls';
      controlsDiv.style.display = 'flex';
      controlsDiv.style.alignItems = 'center';
      controlsDiv.style.gap = '10px';
      controlsDiv.style.marginRight = 'auto';
      controlsDiv.style.marginLeft = '15px';

      // Dropdown for selecting pulls
      const select = document.createElement('select');
      select.id = 'dyno-pull-select';
      select.className = 'template-select';
      select.style.padding = '4px 8px';
      select.style.display = 'none'; // Hidden by default
      select.onchange = (e) => {
        this.selectedPullIndex = parseInt(e.target.value, 10);
        this.drawChart();
      };

      const exportBtn = document.createElement('button');
      exportBtn.id = 'btn-export-dyno';
      exportBtn.className = 'btn btn-sm btn-primary';
      exportBtn.innerHTML = '<i class="fas fa-camera"></i> Save PNG';
      exportBtn.onclick = () => this.exportChart();

      controlsDiv.appendChild(select);
      controlsDiv.appendChild(exportBtn);
      header.insertBefore(controlsDiv, header.querySelector('.btn-close'));
    }
  },

  exportChart() {
    const canvas = document.getElementById('dynoCanvas');
    if (!canvas) return;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const ctx = tempCanvas.getContext('2d');

    const isDark =
      document.body.classList.contains('dark-theme') ||
      document.body.classList.contains('pref-theme-dark');
    ctx.fillStyle = isDark ? '#1e1e1e' : '#ffffff';
    ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    ctx.drawImage(canvas, 0, 0);

    const link = document.createElement('a');
    link.download = 'mygiulia_virtual_dyno.png';
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
  },

  smoothData(data, windowSize = 4) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
      let sum = 0,
        count = 0;
      for (
        let j = Math.max(0, i - windowSize);
        j <= Math.min(data.length - 1, i + windowSize);
        j++
      ) {
        sum += data[j];
        count++;
      }
      result.push(sum / count);
    }
    return result;
  },

  extractPulls(file) {
    const pulls = [];
    let currentPull = { rpm: [], torque: [], power: [], time: [] };
    let inPull = false;
    let hitWot = false;

    const rpmKey = file.availableSignals.find(
      (s) =>
        s.toLowerCase().includes('engine speed') ||
        s.toLowerCase().includes('rpm')
    );
    const torqueKey = file.availableSignals.find(
      (s) =>
        s.toLowerCase().includes('measured engine torque') ||
        s.toLowerCase().includes('engine torque')
    );
    const pedalKey = file.availableSignals.find(
      (s) =>
        s.toLowerCase().includes('gas pedal') ||
        s.toLowerCase().includes('throttle')
    );

    if (!rpmKey || !torqueKey) return pulls;

    const rpmData = file.signals[rpmKey] || [];
    const torqueData = file.signals[torqueKey] || [];
    const pedalData = pedalKey ? file.signals[pedalKey] || [] : [];

    let maxPedal = 0;
    pedalData.forEach((p) => {
      const val = parseFloat(p.y);
      if (val > maxPedal) maxPedal = val;
    });

    const pedalThresholdWOT = maxPedal <= 1.0 ? 0.85 : maxPedal * 0.85;
    const pedalThresholdStart = maxPedal <= 1.0 ? 0.6 : maxPedal * 0.6;

    const timeSet = new Set();
    rpmData.forEach((p) => timeSet.add(p.x));
    torqueData.forEach((p) => timeSet.add(p.x));
    pedalData.forEach((p) => timeSet.add(p.x));

    const times = Array.from(timeSet).sort((a, b) => a - b);

    let lastRpm = null,
      lastTorque = null,
      lastPedal = pedalKey ? null : 100;
    let rIdx = 0,
      tIdx = 0,
      pIdx = 0;

    times.forEach((t) => {
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

      if (
        lastPedal > pedalThresholdStart &&
        lastRpm !== null &&
        lastTorque !== null
      ) {
        inPull = true;
        if (lastPedal >= pedalThresholdWOT) hitWot = true;

        const power = (lastTorque * lastRpm) / 7021.5;
        currentPull.rpm.push(lastRpm);
        currentPull.torque.push(lastTorque);
        currentPull.power.push(power);
        currentPull.time.push(t);
      } else if (inPull) {
        if (
          hitWot &&
          currentPull.rpm.length > 0 &&
          Math.max(...currentPull.rpm) - Math.min(...currentPull.rpm) > 1200
        ) {
          pulls.push(currentPull);
        }
        currentPull = { rpm: [], torque: [], power: [], time: [] };
        inPull = false;
        hitWot = false;
      }
    });

    if (
      inPull &&
      hitWot &&
      currentPull.rpm.length > 0 &&
      Math.max(...currentPull.rpm) - Math.min(...currentPull.rpm) > 1200
    ) {
      pulls.push(currentPull);
    }

    return pulls;
  },

  render() {
    if (AppState.files.length === 0) return;
    const file = AppState.files[0];

    this.currentPulls = this.extractPulls(file);

    if (this.currentPulls.length === 0) {
      alert(
        'No Wide Open Throttle (WOT) sweeps detected in the active log.\n\nA WOT sweep requires >85% pedal position and >1200 RPM delta.'
      );
      this.closeModal();
      return;
    }

    // Sort pulls so the longest RPM sweep is default (index 0)
    this.currentPulls.sort(
      (a, b) =>
        Math.max(...b.rpm) -
        Math.min(...b.rpm) -
        (Math.max(...a.rpm) - Math.min(...a.rpm))
    );
    this.selectedPullIndex = 0;

    this.updateDropdown();
    this.drawChart();
  },

  updateDropdown() {
    const select = document.getElementById('dyno-pull-select');
    if (!select) return;

    select.innerHTML = '';

    if (this.currentPulls.length <= 1) {
      select.style.display = 'none';
    } else {
      select.style.display = 'block';
      this.currentPulls.forEach((pull, idx) => {
        const minRpm = Math.min(...pull.rpm).toFixed(0);
        const maxRpm = Math.max(...pull.rpm).toFixed(0);
        const opt = document.createElement('option');
        opt.value = idx;
        opt.innerText = `Pull ${idx + 1}: ${minRpm} - ${maxRpm} RPM`;
        select.appendChild(opt);
      });
      select.value = this.selectedPullIndex;
    }
  },

  drawChart() {
    const canvas = document.getElementById('dynoCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (this.chartInstance) {
      this.chartInstance.destroy();
    }

    const activePull = this.currentPulls[this.selectedPullIndex];

    const binSize = 50;
    const binnedData = {};

    activePull.rpm.forEach((rpm, i) => {
      const bin = Math.round(rpm / binSize) * binSize;
      if (!binnedData[bin]) {
        binnedData[bin] = { torqueSum: 0, powerSum: 0, count: 0 };
      }
      binnedData[bin].torqueSum += activePull.torque[i];
      binnedData[bin].powerSum += activePull.power[i];
      binnedData[bin].count++;
    });

    const binnedPoints = Object.keys(binnedData)
      .map(Number)
      .sort((a, b) => a - b)
      .map((bin) => ({
        rpm: bin,
        torque: binnedData[bin].torqueSum / binnedData[bin].count,
        power: binnedData[bin].powerSum / binnedData[bin].count,
      }));

    const dataPoints = binnedPoints.map((dp, i, arr) => {
      const windowSize = 2;
      let tSum = 0,
        pSum = 0,
        count = 0;
      for (
        let j = Math.max(0, i - windowSize);
        j <= Math.min(arr.length - 1, i + windowSize);
        j++
      ) {
        tSum += arr[j].torque;
        pSum += arr[j].power;
        count++;
      }
      return { rpm: dp.rpm, torque: tSum / count, power: pSum / count };
    });

    const torqueData = dataPoints.map((d) => ({ x: d.rpm, y: d.torque }));
    const powerData = dataPoints.map((d) => ({ x: d.rpm, y: d.power }));

    const maxTorque = Math.max(...dataPoints.map((d) => d.torque));
    const maxPower = Math.max(...dataPoints.map((d) => d.power));

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
            borderWidth: 3,
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
            borderWidth: 3,
          },
        ],
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
            display: false,
          },
          title: {
            display: true,
            text: `Virtual Dyno - Max Power: ${maxPower.toFixed(1)} KM | Max Torque: ${maxTorque.toFixed(1)} Nm`,
            font: { size: 16, weight: 'bold' },
          },
          tooltip: {
            callbacks: {
              label: (context) =>
                `${context.dataset.label}: ${context.parsed.y.toFixed(1)}`,
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: 'Engine Speed (RPM)' },
            grid: { color: 'rgba(255,255,255,0.05)' },
            min: Math.floor(Math.min(...activePull.rpm) / 500) * 500,
            max: Math.ceil(Math.max(...activePull.rpm) / 500) * 500,
          },
          yTorque: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Torque (Nm)' },
            min: 0,
            max: 1000,
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          yPower: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'Power (KM)' },
            min: 0,
            max: Math.ceil(maxPower / 100) * 100 + 50,
            grid: { drawOnChartArea: false },
          },
        },
      },
    });
  },
};
