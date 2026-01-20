import { AppState } from './config.js';
import { PaletteManager } from './palettemanager.js';

import {
  Chart,
  ScatterController,
  LineController,
  PointElement,
  LineElement,
  LinearScale,
  TimeScale,
  Tooltip,
  Legend,
} from 'chart.js';

import zoomPlugin from 'chartjs-plugin-zoom';
import 'chartjs-adapter-date-fns';

export const XYAnalysis = {
  charts: [null, null],
  timelineChart: null,

  init() {
    Chart.register(
      ScatterController,
      LineController,
      PointElement,
      LineElement,
      LinearScale,
      TimeScale,
      Tooltip,
      Legend,
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

      // Defaults
      if (panelIdx === '0') {
        this.setSelectValue(`xyX-0`, 'Engine Rpm');
        this.setSelectValue(`xyY-0`, 'Intake Manifold Pressure');
        this.setSelectValue(`xyZ-0`, 'Air Mass');
      } else {
        this.setSelectValue(`xyX-1`, 'Engine Rpm');
        this.setSelectValue(`xyY-1`, 'Air Mass Flow Measured');
        this.setSelectValue(`xyZ-1`, 'Intake Manifold Pressure');
      }
    });

    // Initial render of timeline with default signals
    this.updateTimeline();
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

    this.updateTimeline();
  },

  resetAllZooms() {
    this.charts.forEach((c) => c?.resetZoom());
    if (this.timelineChart) this.timelineChart.resetZoom();
  },

  updateTimeline() {
    const fileIdx = document.getElementById('xyGlobalFile').value;

    const signals = new Set();
    ['0', '1'].forEach((idx) => {
      signals.add(document.getElementById(`xyX-${idx}`).value);
      signals.add(document.getElementById(`xyY-${idx}`).value);
      signals.add(document.getElementById(`xyZ-${idx}`).value);
    });

    const uniqueSignals = Array.from(signals).filter((s) => s);

    this.renderTimeline(fileIdx, uniqueSignals);
  },

  renderTimeline(fileIdx, signalNames) {
    const canvas = document.getElementById('xyTimelineCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const file = AppState.files[fileIdx];

    if (this.timelineChart) this.timelineChart.destroy();
    if (!file || signalNames.length === 0) return;

    const datasets = signalNames
      .map((sigName, idx) => {
        const rawData = file.signals[sigName];
        if (!rawData) return null;

        // Normalize to 0-1 for overlaying multiple signals
        const yValues = rawData.map((p) => parseFloat(p.y));
        const min = Math.min(...yValues);
        const max = Math.max(...yValues);
        const range = max - min || 1;

        const data = rawData.map((p) => ({
          x: (p.x - file.startTime) / 1000,
          y: (parseFloat(p.y) - min) / range,
          originalValue: parseFloat(p.y),
        }));

        const defaultColors = [
          '#e6194b',
          '#3cb44b',
          '#ffe119',
          '#4363d8',
          '#f58231',
          '#911eb4',
        ];
        const color =
          window.PaletteManager && PaletteManager.getColorForSignal
            ? PaletteManager.getColorForSignal(0, idx)
            : defaultColors[idx % defaultColors.length];

        return {
          label: sigName,
          data: data,
          borderColor: color,
          backgroundColor: color,
          borderWidth: 1.5, // Clean line width
          pointRadius: 0, // Hides all points
          pointHoverRadius: 0, // No hover dots for cleaner UI
          hitRadius: 10, // Easier to hover line
          fill: false,
          tension: 0.1, // Slight smoothing
        };
      })
      .filter((ds) => ds !== null);

    this.timelineChart = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: 'Time (s)', font: { size: 10 } },
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { font: { size: 10 } },
          },
          y: { display: false, min: -0.05, max: 1.05 },
        },
        plugins: {
          // 1. CRITICAL FIX: Disable Data Labels (Removes the gray noise)
          datalabels: { display: false },

          legend: {
            display: true,
            position: 'top',
            labels: { boxWidth: 10, font: { size: 10 }, usePointStyle: true },
          },
          tooltip: {
            enabled: true,
            callbacks: {
              label: (context) => {
                const raw = context.raw.originalValue;
                return `${context.dataset.label}: ${raw.toFixed(2)}`;
              },
            },
          },
          zoom: {
            zoom: { wheel: { enabled: true }, mode: 'x' },
            pan: { enabled: true, mode: 'x' },
          },
        },
      },
    });
  },

  renderChart(panelIdx, fileIdx, signalX, signalY, signalZ) {
    const canvasId = `xyCanvas-${panelIdx}`;
    const ctx = document.getElementById(canvasId).getContext('2d');

    if (this.charts[panelIdx]) {
      this.charts[panelIdx].destroy();
    }

    const data = this.generateScatterData(fileIdx, signalX, signalY, signalZ);
    if (data.length === 0) return;

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
              label: (ctx) =>
                `X: ${ctx.raw.x.toFixed(2)}, Y: ${ctx.raw.y.toFixed(2)}, Z: ${ctx.raw.z.toFixed(2)}`,
            },
          },
          zoom: {
            zoom: { wheel: { enabled: true }, mode: 'xy' },
            pan: { enabled: true, mode: 'xy' },
          },
        },
      },
    });
  },

  updateLegend(panelIdx, min, max, zLabel) {
    const legend = document.getElementById(`xyLegend-${panelIdx}`);
    if (!legend) return;
    legend.style.display = 'flex';
    legend.innerHTML = '';

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
    for (let i = 0; i < steps; i++) {
      const pct = 1 - i / (steps - 1);
      const val = min + (max - min) * pct;
      const valSpan = document.createElement('span');
      valSpan.innerText = val.toFixed(1);
      valuesContainer.appendChild(valSpan);
    }
    legend.appendChild(valuesContainer);
  },

  generateScatterData(fileIndex, signalXName, signalYName, signalZName) {
    const file = AppState.files[fileIndex];
    if (!file) return [];

    const rawX = file.signals[signalXName];
    const rawY = file.signals[signalYName];
    const rawZ = file.signals[signalZName];

    if (!rawX || !rawY || !rawZ) return [];

    const scatterPoints = [];
    let idxY = 0;
    let idxZ = 0;
    const isMilliseconds = rawX.length > 0 && rawX[0].x > 100000;
    const tolerance = isMilliseconds ? 500 : 0.5;

    rawX.forEach((pointX) => {
      const time = pointX.x;
      while (
        idxY < rawY.length - 1 &&
        Math.abs(rawY[idxY + 1].x - time) < Math.abs(rawY[idxY].x - time)
      )
        idxY++;
      while (
        idxZ < rawZ.length - 1 &&
        Math.abs(rawZ[idxZ + 1].x - time) < Math.abs(rawZ[idxZ].x - time)
      )
        idxZ++;

      const pointY = rawY[idxY];
      const pointZ = rawZ[idxZ];

      if (
        pointY &&
        pointZ &&
        Math.abs(pointY.x - time) <= tolerance &&
        Math.abs(pointZ.x - time) <= tolerance
      ) {
        scatterPoints.push({
          x: parseFloat(pointX.y),
          y: parseFloat(pointY.y),
          z: parseFloat(pointZ.y),
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
