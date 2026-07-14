import { AppState, DOM } from './config.js';
import { Chart } from 'chart.js';
import { PaletteManager } from './palettemanager.js';

export const DynoManager = {
  chartInstance: null,
  currentPulls: [],
  selectedPullIndex: 0,
  currentConfig: null,
  selectedExtraSignals: [],

  init() {
    window.openDynoModal = () => this.openSetupModal();
    window.closeDynoSetupModal = () => this.closeSetupModal();
    window.closeDynoModal = () => this.closeModal();
    window.generateDyno = () => this.generateFromSetup();
  },

  openSetupModal() {
    if (AppState.files.length === 0) {
      alert('Please load a log file first.');
      return;
    }

    const modal = document.getElementById('dynoSetupModal');
    if (!modal) return;

    const file = AppState.files[0];
    const signals = [...file.availableSignals].sort();

    const populateSelect = (elementId, searchTerms) => {
      const select = document.getElementById(elementId);
      if (!select) return;
      select.innerHTML = '<option value="">-- Select Signal --</option>';

      let bestMatch = '';
      signals.forEach((sig) => {
        const opt = document.createElement('option');
        opt.value = sig;
        opt.innerText = sig;
        select.appendChild(opt);

        if (!bestMatch) {
          const lowerSig = sig.toLowerCase();
          if (searchTerms.some((term) => lowerSig.includes(term)))
            bestMatch = sig;
        }
      });
      if (bestMatch) select.value = bestMatch;
    };

    populateSelect('dynoSetupRpm', ['engine speed', 'rpm']);
    populateSelect('dynoSetupTorque', [
      'measured engine torque',
      'engine torque',
      'torque',
    ]);
    populateSelect('dynoSetupPedal', [
      'gas pedal',
      'throttle position',
      'pedal',
    ]);

    modal.style.display = 'flex';
  },

  closeSetupModal() {
    const modal = document.getElementById('dynoSetupModal');
    if (modal) modal.style.display = 'none';
  },

  generateFromSetup() {
    const rpmKey = document.getElementById('dynoSetupRpm').value;
    const torqueKey = document.getElementById('dynoSetupTorque').value;
    const pedalKey = document.getElementById('dynoSetupPedal').value;

    if (!rpmKey || !torqueKey || !pedalKey) {
      alert('Please select Engine Speed, Torque, and Pedal Position signals.');
      return;
    }

    this.currentConfig = {
      rpmKey,
      torqueKey,
      pedalKey,
      pedalStart: parseFloat(
        document.getElementById('dynoSetupPedalStart').value
      ),
      pedalWot: parseFloat(document.getElementById('dynoSetupPedalWot').value),
      rpmDelta: parseInt(
        document.getElementById('dynoSetupRpmDelta').value,
        10
      ),
    };

    this.closeSetupModal();
    this.openModal();
  },

  openModal() {
    const modal = document.getElementById('dynoModal');
    if (modal) {
      modal.style.display = 'flex';
      this.injectHeaderControls(modal);
      this.render();
      this.populateSignalList();
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
      this.selectedExtraSignals = [];
    }
  },

  injectHeaderControls(modal) {
    if (!document.getElementById('dyno-pull-select')) {
      const searchInput = document.getElementById('dynoSignalSearch');
      if (searchInput && searchInput.parentElement) {
        const select = document.createElement('select');
        select.id = 'dyno-pull-select';
        select.className = 'template-select';
        select.style.width = '100%';
        select.style.marginBottom = '10px';
        select.style.display = 'none';

        select.onchange = (e) => {
          this.selectedPullIndex = parseInt(e.target.value, 10);
          this.drawChart();
        };

        searchInput.parentElement.insertBefore(select, searchInput);
      }
    }

    if (!document.getElementById('btn-export-dyno')) {
      const closeBtn = modal.querySelector('.btn-close');
      if (closeBtn && closeBtn.parentElement) {
        const mainHeader = closeBtn.parentElement;

        const exportBtn = document.createElement('button');
        exportBtn.id = 'btn-export-dyno';
        exportBtn.className = 'btn btn-sm btn-primary';
        exportBtn.innerHTML = '<i class="fas fa-camera"></i> Save PNG';
        exportBtn.style.marginRight = 'auto';
        exportBtn.style.marginLeft = '15px';
        exportBtn.onclick = () => this.exportChart();

        mainHeader.insertBefore(exportBtn, closeBtn);
      }
    }
  },

  exportChart() {
    const canvas = document.getElementById('dynoCanvas');
    if (!canvas) return;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const ctx = tempCanvas.getContext('2d');

    const isDark = document.body.classList.contains('dark-theme');
    ctx.fillStyle = isDark ? '#1e1e1e' : '#ffffff';
    ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    ctx.drawImage(canvas, 0, 0);

    const link = document.createElement('a');
    link.download = 'mygiulia_virtual_dyno.png';
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
  },

  populateSignalList() {
    const list = document.getElementById('dynoSignalList');
    const search = document.getElementById('dynoSignalSearch');
    if (!list || !search) return;

    const file = AppState.files[0];

    if (!file || !file.availableSignals) return;

    const signals = file.availableSignals.sort();

    const renderList = (filter = '') => {
      list.innerHTML = '';
      const lowerFilter = filter.toLowerCase();

      signals.forEach((sig) => {
        if (
          sig === this.currentConfig.rpmKey ||
          sig === this.currentConfig.torqueKey ||
          sig === this.currentConfig.pedalKey
        )
          return;
        if (filter && !sig.toLowerCase().includes(lowerFilter)) return;

        const div = document.createElement('div');
        div.className = 'custom-checkbox-container';
        div.style.marginBottom = '12px';
        div.style.fontSize = '0.85em';
        div.style.position = 'relative';

        const isChecked = this.selectedExtraSignals.includes(sig);

        div.innerHTML = `
            <input type="checkbox" id="dyno-sig-${sig}" value="${sig}" ${isChecked ? 'checked' : ''} style="position: absolute; opacity: 0;">
            <span class="checkmark"></span>
            <label for="dyno-sig-${sig}" style="cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; width: 100%; padding-left: 28px; line-height: 1.2;">${sig}</label>
        `;

        const cb = div.querySelector('input');
        cb.onchange = (e) => {
          if (e.target.checked) {
            if (!this.selectedExtraSignals.includes(sig))
              this.selectedExtraSignals.push(sig);
          } else {
            this.selectedExtraSignals = this.selectedExtraSignals.filter(
              (s) => s !== sig
            );
          }
          this.drawChart();
        };

        list.appendChild(div);
      });
    };

    renderList();
    search.oninput = (e) => renderList(e.target.value);
  },

  extractPulls(file) {
    const pulls = [];
    let currentPull = { rpm: [], torque: [], power: [], time: [] };
    let inPull = false;
    let hitWot = false;

    const { rpmKey, torqueKey, pedalKey, pedalStart, pedalWot, rpmDelta } =
      this.currentConfig;

    const rpmData = file.signals[rpmKey] || [];
    const torqueData = file.signals[torqueKey] || [];
    const pedalData = file.signals[pedalKey] || [];

    let maxPedal = 0;
    pedalData.forEach((p) => {
      const val = parseFloat(p.y);
      if (val > maxPedal) maxPedal = val;
    });

    const isDecimal = maxPedal <= 1.0;
    const threshStart = isDecimal ? pedalStart / 100 : pedalStart;
    const threshWot = isDecimal ? pedalWot / 100 : pedalWot;

    const timeSet = new Set();
    rpmData.forEach((p) => timeSet.add(p.x));
    torqueData.forEach((p) => timeSet.add(p.x));
    pedalData.forEach((p) => timeSet.add(p.x));

    const times = Array.from(timeSet).sort((a, b) => a - b);

    let lastRpm = null,
      lastTorque = null,
      lastPedal = 100;
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

      if (lastPedal > threshStart && lastRpm !== null && lastTorque !== null) {
        inPull = true;
        if (lastPedal >= threshWot) hitWot = true;

        const power = (lastTorque * lastRpm) / 7021.5;
        currentPull.rpm.push(lastRpm);
        currentPull.torque.push(lastTorque);
        currentPull.power.push(power);
        currentPull.time.push(t);
      } else if (inPull) {
        if (
          hitWot &&
          currentPull.rpm.length > 0 &&
          Math.max(...currentPull.rpm) - Math.min(...currentPull.rpm) > rpmDelta
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
      Math.max(...currentPull.rpm) - Math.min(...currentPull.rpm) > rpmDelta
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
        `No sweeps found matching your criteria:\n- Start Pedal: ${this.currentConfig.pedalStart}%\n- WOT Pedal: ${this.currentConfig.pedalWot}%\n- Min RPM Delta: ${this.currentConfig.rpmDelta}`
      );
      this.closeModal();
      return;
    }

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

    if (this.chartInstance) this.chartInstance.destroy();

    const activePull = this.currentPulls[this.selectedPullIndex];
    const file = AppState.files[0];

    const extraData = {};
    this.selectedExtraSignals.forEach((sig) => {
      extraData[sig] = new Float32Array(activePull.time.length);
      const raw = file.signals[sig] || [];
      let rIdx = 0;
      let lastVal = 0;
      activePull.time.forEach((t, i) => {
        while (rIdx < raw.length && raw[rIdx].x <= t) {
          lastVal = parseFloat(raw[rIdx].y);
          rIdx++;
        }
        extraData[sig][i] = lastVal;
      });
    });

    const binSize = 50;
    const binnedData = {};

    activePull.rpm.forEach((rpm, i) => {
      const bin = Math.round(rpm / binSize) * binSize;
      if (!binnedData[bin]) {
        binnedData[bin] = { torqueSum: 0, powerSum: 0, count: 0, extras: {} };
        this.selectedExtraSignals.forEach(
          (sig) => (binnedData[bin].extras[sig] = 0)
        );
      }
      binnedData[bin].torqueSum += activePull.torque[i];
      binnedData[bin].powerSum += activePull.power[i];
      this.selectedExtraSignals.forEach((sig) => {
        binnedData[bin].extras[sig] += extraData[sig][i];
      });
      binnedData[bin].count++;
    });

    const binnedPoints = Object.keys(binnedData)
      .map(Number)
      .sort((a, b) => a - b)
      .map((bin) => {
        const count = binnedData[bin].count;
        const pt = {
          rpm: bin,
          torque: binnedData[bin].torqueSum / count,
          power: binnedData[bin].powerSum / count,
          extras: {},
        };
        this.selectedExtraSignals.forEach((sig) => {
          pt.extras[sig] = binnedData[bin].extras[sig] / count;
        });
        return pt;
      });

    const dataPoints = binnedPoints.map((dp, i, arr) => {
      const windowSize = 2;
      let tSum = 0,
        pSum = 0,
        count = 0;
      const eSum = {};
      this.selectedExtraSignals.forEach((sig) => (eSum[sig] = 0));

      for (
        let j = Math.max(0, i - windowSize);
        j <= Math.min(arr.length - 1, i + windowSize);
        j++
      ) {
        tSum += arr[j].torque;
        pSum += arr[j].power;
        this.selectedExtraSignals.forEach(
          (sig) => (eSum[sig] += arr[j].extras[sig])
        );
        count++;
      }

      const pt = {
        rpm: dp.rpm,
        torque: tSum / count,
        power: pSum / count,
        extras: {},
      };
      this.selectedExtraSignals.forEach(
        (sig) => (pt.extras[sig] = eSum[sig] / count)
      );
      return pt;
    });

    const torqueData = dataPoints.map((d) => ({ x: d.rpm, y: d.torque }));
    const powerData = dataPoints.map((d) => ({ x: d.rpm, y: d.power }));
    const maxTorque = Math.max(...dataPoints.map((d) => d.torque));
    const maxPower = Math.max(...dataPoints.map((d) => d.power));

    const datasets = [
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
        label: 'Power (HP)',
        data: powerData,
        borderColor: '#c22636',
        backgroundColor: 'rgba(194, 38, 54, 0.1)',
        yAxisID: 'yPower',
        tension: 0.4,
        cubicInterpolationMode: 'monotone',
        pointRadius: 0,
        borderWidth: 3,
      },
    ];

    this.selectedExtraSignals.forEach((sig) => {
      const sigIdx = file.availableSignals.indexOf(sig);
      const color = PaletteManager.getColorForSignal(0, sigIdx);

      datasets.push({
        label: sig,
        data: dataPoints.map((d) => ({ x: d.rpm, y: d.extras[sig] })),
        borderColor: color,
        yAxisID: 'yExtra',
        tension: 0.4,
        cubicInterpolationMode: 'monotone',
        pointRadius: 0,
        borderWidth: 2,
        borderDash: [5, 5],
      });
    });

    this.chartInstance = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          datalabels: { display: false },
          title: {
            display: true,
            text: `Virtual Dyno - Max Power: ${maxPower.toFixed(1)} HP | Max Torque: ${maxTorque.toFixed(1)} Nm`,
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
            grid: { color: 'rgba(128,128,128,0.1)' },
            min: Math.floor(Math.min(...activePull.rpm) / 500) * 500,
            max: Math.ceil(Math.max(...activePull.rpm) / 500) * 500,
          },
          yTorque: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Torque (Nm)' },
            min: 0,
            max: 1000,
            grid: { color: 'rgba(128,128,128,0.1)' },
          },
          yPower: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'Power (HP)' },
            min: 0,
            max: Math.ceil(maxPower / 100) * 100 + 50,
            grid: { drawOnChartArea: false },
          },
          yExtra: {
            type: 'linear',
            position: 'right',
            display: false,
            grid: { drawOnChartArea: false },
          },
        },
      },
    });
  },
};
