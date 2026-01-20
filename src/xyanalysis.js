import { AppState } from './config.js';

import {
  Chart,
  ScatterController,
  PointElement,
  LinearScale,
  Tooltip,
} from 'chart.js';

import zoomPlugin from 'chartjs-plugin-zoom';

export const XYAnalysis = {
  charts: [null, null],

  init() {
    Chart.register(
      ScatterController,
      PointElement,
      LinearScale,
      Tooltip,
      zoomPlugin
    );
  },

  openXYModal() {
    document.getElementById('xyModal').style.display = 'flex';
    this.populateGlobalFileSelector();
  },

  closeXYModal() {
    document.getElementById('xyModal').style.display = 'none';
  },

  populateGlobalFileSelector() {
    const fileSelect = document.getElementById('xyGlobalFile');
    fileSelect.innerHTML = AppState.files
      .map((f, i) => `<option value="${i}">${f.name}</option>`)
      .join('');
    this.onFileChange();
  },

  onFileChange() {
    const fileIdx = document.getElementById('xyGlobalFile').value;
    const file = AppState.files[fileIdx];
    if (!file) return;

    const options = file.availableSignals
      .sort()
      .map((s) => `<option value="${s}">${s}</option>`)
      .join('');

    ['0', '1'].forEach((panelIdx) => {
      document.getElementById(`xyX-${panelIdx}`).innerHTML = options;
      document.getElementById(`xyY-${panelIdx}`).innerHTML = options;
      document.getElementById(`xyZ-${panelIdx}`).innerHTML = options;

      // Smart Defaults
      if (panelIdx === '0') {
        this.setSelectValue(`xyX-0`, 'Engine Rpm');
        this.setSelectValue(`xyY-0`, 'Intake Manifold Pressure');
        this.setSelectValue(`xyZ-0`, 'Air Mass'); // Z-Axis Example
      } else {
        this.setSelectValue(`xyX-1`, 'Engine Rpm');
        this.setSelectValue(`xyY-1`, 'Air Mass Flow Measured');
        this.setSelectValue(`xyZ-1`, 'Intake Manifold Pressure');
      }
    });
  },

  setSelectValue(id, searchStr) {
    const sel = document.getElementById(id);
    for (let opt of sel.options) {
      if (opt.value.includes(searchStr)) {
        sel.value = opt.value;
        break;
      }
    }
  },

  plot(panelIdx) {
    const fileIdx = document.getElementById('xyGlobalFile').value;
    const xSig = document.getElementById(`xyX-${panelIdx}`).value;
    const ySig = document.getElementById(`xyY-${panelIdx}`).value;
    const zSig = document.getElementById(`xyZ-${panelIdx}`).value;

    this.renderChart(panelIdx, fileIdx, xSig, ySig, zSig);
  },

  resetAllZooms() {
    this.charts.forEach((c) => c?.resetZoom());
  },

  renderChart(panelIdx, fileIdx, signalX, signalY, signalZ) {
    const canvasId = `xyCanvas-${panelIdx}`;
    const ctx = document.getElementById(canvasId).getContext('2d');

    if (this.charts[panelIdx]) {
      this.charts[panelIdx].destroy();
    }

    const data = this.generateScatterData(fileIdx, signalX, signalY, signalZ);

    if (data.length === 0) {
      return;
    }

    const zValues = data.map((p) => p.z);
    const minZ = Math.min(...zValues);
    const maxZ = Math.max(...zValues);

    const pointColors = data.map((p) => this.getHeatColor(p.z, minZ, maxZ));

    this.updateLegend(panelIdx, minZ, maxZ, signalZ);

    const isDark = document.body.classList.contains('dark-theme');
    const color = isDark ? '#eee' : '#333';
    const grid = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

    this.charts[panelIdx] = new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: `${signalY} vs ${signalX}`,
            data: data,
            backgroundColor: pointColors,
            borderColor: pointColors,
            borderWidth: 1,
            pointRadius: 3,
            pointHoverRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            position: 'bottom',
            title: { display: true, text: signalX, color },
            grid: { color: grid },
            ticks: { color },
          },
          y: {
            title: { display: true, text: signalY, color },
            grid: { color: grid },
            ticks: { color },
          },
        },
        plugins: {
          legend: { display: false },
          datalabels: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const raw = ctx.raw;
                return [
                  `X (${signalX}): ${raw.x.toFixed(2)}`,
                  `Y (${signalY}): ${raw.y.toFixed(2)}`,
                  `Z (${signalZ}): ${raw.z.toFixed(2)}`,
                ];
              },
            },
          },
          zoom: {
            zoom: {
              wheel: { enabled: true },
              drag: { enabled: true, backgroundColor: 'rgba(255,0,0,0.2)' },
              mode: 'xy',
            },
          },
        },
      },
    });
  },

  /* Inside src/xyanalysis.js */

  updateLegend(panelIdx, min, max, zLabel) {
     const legend = document.getElementById(`xyLegend-${panelIdx}`);
     if(!legend) return;
     
     legend.style.display = 'flex';
     legend.innerHTML = ''; // Clear previous content

     const labelContainer = document.createElement('div');
     labelContainer.className = 'legend-label-container';
     
     const labelSpan = document.createElement('span');
     labelSpan.className = 'z-axis-label';
     labelSpan.innerText = zLabel || 'Z-Axis';
     labelContainer.appendChild(labelSpan);
     legend.appendChild(labelContainer);

     const bar = document.createElement('div');
     bar.className = 'gradient-bar';
     legend.appendChild(bar);

     const valuesContainer = document.createElement('div');
     valuesContainer.className = 'legend-values';
     
     const steps = 5;
     for(let i = 0; i < steps; i++) {
         const pct = 1 - (i / (steps - 1)); 
         const val = min + (max - min) * pct;
         
         const valSpan = document.createElement('span');
         valSpan.innerText = val.toFixed(1); // Format to 1 decimal place
         valuesContainer.appendChild(valSpan);
     }
     legend.appendChild(valuesContainer);

     legend.title = `${zLabel} Scale: ${min.toFixed(2)} - ${max.toFixed(2)}`;
  },

  generateScatterData(fileIndex, signalXName, signalYName, signalZName) {
    const file = AppState.files[fileIndex];
    if (!file) return [];

    const rawX = file.signals[signalXName];
    const rawY = file.signals[signalYName];
    const rawZ = file.signals[signalZName]; // Get Z signal

    if (!rawX || !rawY || !rawZ) return [];

    const scatterPoints = [];
    let idxY = 0;
    let idxZ = 0;

    const isMilliseconds = rawX.length > 0 && rawX[0].x > 100000;
    const tolerance = isMilliseconds ? 500 : 0.5;

    // We align everything to X's timestamp
    rawX.forEach((pointX) => {
      const time = pointX.x;

      // Sync Y
      while (
        idxY < rawY.length - 1 &&
        Math.abs(rawY[idxY + 1].x - time) < Math.abs(rawY[idxY].x - time)
      ) {
        idxY++;
      }
      // Sync Z
      while (
        idxZ < rawZ.length - 1 &&
        Math.abs(rawZ[idxZ + 1].x - time) < Math.abs(rawZ[idxZ].x - time)
      ) {
        idxZ++;
      }

      const pointY = rawY[idxY];
      const pointZ = rawZ[idxZ];

      // Check alignment tolerance for both Y and Z
      if (
        pointY &&
        pointZ &&
        Math.abs(pointY.x - time) <= tolerance &&
        Math.abs(pointZ.x - time) <= tolerance
      ) {
        scatterPoints.push({
          x: parseFloat(pointX.y),
          y: parseFloat(pointY.y),
          z: parseFloat(pointZ.y), // Store Z value for color mapping
        });
      }
    });
    return scatterPoints;
  },

  getHeatColor(value, min, max) {
    if (min === max) return 'hsla(240, 100%, 50%, 0.8)';
    let ratio = (value - min) / (max - min);
    ratio = Math.max(0, Math.min(1, ratio));
    const hue = (1 - ratio) * 240;
    return `hsla(${hue}, 100%, 50%, 0.8)`;
  },
};
