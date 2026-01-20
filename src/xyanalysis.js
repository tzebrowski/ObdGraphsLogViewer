import { AppState } from './config.js';
import { UI } from './ui.js';

import {
  Chart,
  ScatterController,
  PointElement,
  LinearScale,
  Tooltip,
} from 'chart.js';

import zoomPlugin from 'chartjs-plugin-zoom';

export const XYAnalysis = {
  charts: [null, null], // Store instances for Panel 0 and Panel 1

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

    // After populating files, populate signal selectors for the active file
    this.onFileChange();
  },

  onFileChange() {
    const fileIdx = document.getElementById('xyGlobalFile').value;
    const file = AppState.files[fileIdx];
    if (!file) return;

    // Populate selectors for BOTH panels
    const options = file.availableSignals
      .sort()
      .map((s) => `<option value="${s}">${s}</option>`)
      .join('');

    ['0', '1'].forEach((panelIdx) => {
      document.getElementById(`xyX-${panelIdx}`).innerHTML = options;
      document.getElementById(`xyY-${panelIdx}`).innerHTML = options;

      // Smart Defaults:
      // Panel 0: RPM vs MAP (if available)
      // Panel 1: RPM vs MAF (if available)
      if (panelIdx === '0') {
        this.setSelectValue(`xyX-0`, 'Engine Rpm');
        this.setSelectValue(`xyY-0`, 'Intake Manifold Pressure');
      } else {
        this.setSelectValue(`xyX-1`, 'Engine Rpm');
        this.setSelectValue(`xyY-1`, 'Air Mass Flow Measured');
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

  // Triggered by specific "Plot" buttons
  plot(panelIdx) {
    const fileIdx = document.getElementById('xyGlobalFile').value;
    const xSig = document.getElementById(`xyX-${panelIdx}`).value;
    const ySig = document.getElementById(`xyY-${panelIdx}`).value;

    this.renderChart(panelIdx, fileIdx, xSig, ySig);
  },

  resetAllZooms() {
    this.charts.forEach((c) => c?.resetZoom());
  },

  renderChart(panelIdx, fileIdx, signalX, signalY) {
    const canvasId = `xyCanvas-${panelIdx}`;
    const ctx = document.getElementById(canvasId).getContext('2d');

    // Destroy existing chart in this slot
    if (this.charts[panelIdx]) {
      this.charts[panelIdx].destroy();
    }

    const data = this.generateScatterData(fileIdx, signalX, signalY);

    if (data.length === 0) {
      console.warn(`Panel ${panelIdx}: No data`);
      return;
    }

    // Calculate Colors
    const yValues = data.map((p) => p.y);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);
    const pointColors = data.map((p) => this.getHeatColor(p.y, minY, maxY));

    // Update Legend for this specific panel
    this.updateLegend(panelIdx, minY, maxY);

    // Common Chart Config
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
            pointRadius: 2,
            pointHoverRadius: 5,
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
          // 1. Disable Legend (Hides dataset toggles)
          legend: { display: false },

          // 2. Disable Data Labels (Prevents text clutter on every dot)
          datalabels: { display: false },

          tooltip: {
            callbacks: {
              label: (ctx) =>
                `${signalY}: ${ctx.parsed.y.toFixed(2)}, ${signalX}: ${ctx.parsed.x.toFixed(2)}`,
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

  updateLegend(panelIdx, min, max) {
    const legend = document.getElementById(`xyLegend-${panelIdx}`);
    if (!legend) return;

    legend.style.display = 'flex';
    legend.querySelector('.max-val').innerText = max.toFixed(1);
    legend.querySelector('.min-val').innerText = min.toFixed(1);
  },

  generateScatterData(fileIndex, signalXName, signalYName) {
    // Reusing your existing logic
    const file = AppState.files[fileIndex];
    if (!file) return [];

    const rawX = file.signals[signalXName];
    const rawY = file.signals[signalYName];
    if (!rawX || !rawY) return [];

    const scatterPoints = [];
    let yIndex = 0;
    // Determine tolerance based on timestamp magnitude (ms vs s)
    const isMilliseconds = rawX.length > 0 && rawX[0].x > 100000;
    const tolerance = isMilliseconds ? 500 : 0.5;

    rawX.forEach((pointX) => {
      const time = pointX.x;
      // Find closest Y point
      while (
        yIndex < rawY.length - 1 &&
        Math.abs(rawY[yIndex + 1].x - time) < Math.abs(rawY[yIndex].x - time)
      ) {
        yIndex++;
      }
      const pointY = rawY[yIndex];

      // Only add point if time aligns within tolerance
      if (pointY && Math.abs(pointY.x - time) <= tolerance) {
        scatterPoints.push({
          x: parseFloat(pointX.y),
          y: parseFloat(pointY.y),
        });
      }
    });
    return scatterPoints;
  },

  getHeatColor(value, min, max) {
    if (min === max) return 'hsla(240, 100%, 50%, 0.8)';
    let ratio = (value - min) / (max - min);
    ratio = Math.max(0, Math.min(1, ratio));
    const hue = (1 - ratio) * 240; // Blue (240) to Red (0)
    return `hsla(${hue}, 100%, 50%, 0.8)`;
  },
};
