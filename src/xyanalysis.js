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
    Tooltip.positioners.xyFixed = function (elements, eventPosition) {
      if (!this.chart) return;
      const { chartArea } = this.chart;
      return {
        x: chartArea.right - 10,
        y: chartArea.top + 10,
      };
    };

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
    const modal = document.getElementById('xyModal');
    modal.style.display = 'flex';

    const splitView = document.getElementById('xySplitView');
    const timelineView = document.getElementById('xyTimelineView');

    if (splitView && timelineView) {
      splitView.style.flex = '3';
      timelineView.style.flex = '1';
    }

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

    this.plot('0');
    this.plot('1');
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
      const x = document.getElementById(`xyX-${idx}`).value;
      const y = document.getElementById(`xyY-${idx}`).value;
      const z = document.getElementById(`xyZ-${idx}`).value;
      if (x) signals.add(x);
      if (y) signals.add(y);
      if (z) signals.add(z);
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
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 0,
          hitRadius: 10,
          fill: false,
          tension: 0.1,
        };
      })
      .filter((ds) => ds !== null);

    const hoverLinePlugin = {
      id: 'xyHoverLine',
      afterDraw: (chart) => {
        if (chart.tooltip?._active && chart.tooltip._active.length) {
          const activePoint = chart.tooltip._active[0];
          const ctx = chart.ctx;
          const x = activePoint.element.x;
          const topY = chart.scales.y.top;
          const bottomY = chart.scales.y.bottom;

          ctx.save();
          ctx.beginPath();
          ctx.moveTo(x, topY);
          ctx.lineTo(x, bottomY);
          ctx.lineWidth = 1;
          const isDark = document.body.classList.contains('dark-theme');
          ctx.strokeStyle = isDark
            ? 'rgba(255, 255, 255, 0.5)'
            : 'rgba(0, 0, 0, 0.5)';
          ctx.stroke();
          ctx.restore();
        }
      },
    };

    const isDark = document.body.classList.contains('dark-theme');
    const textColor = isDark ? '#eee' : '#333';

    this.timelineChart = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      plugins: [hoverLinePlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'linear',
            title: {
              display: true,
              text: 'Time (s)',
              font: { size: 10 },
              color: textColor,
            },
            grid: {
              color: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
            },
            ticks: { font: { size: 10 }, color: textColor },
          },
          y: { display: false, min: -0.05, max: 1.05 },
        },
        plugins: {
          datalabels: { display: false },
          legend: {
            display: true,
            position: 'top',
            labels: {
              boxWidth: 10,
              font: { size: 10 },
              usePointStyle: true,
              color: textColor,
            },
          },
          tooltip: {
            enabled: true,
            position: 'xyFixed',
            mode: 'index',
            intersect: false,
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
            position: 'xyFixed',
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
