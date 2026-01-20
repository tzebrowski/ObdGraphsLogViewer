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
  chartInstance: null,

  init() {
    Chart.register(
      ScatterController,
      PointElement,
      LinearScale,
      Tooltip,
      zoomPlugin
    );

    const resetBtn = document.getElementById('xyResetZoom');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.resetZoom();
      });
    }
  },

  openXYModal() {
    document.getElementById('xyModal').style.display = 'flex';
    UI.populateXYSelectors();
    const legend = document.getElementById('xyLegendContainer');
    if (legend) legend.style.display = 'none';
  },

  closeXYModal() {
    document.getElementById('xyModal').style.display = 'none';
  },

  generateXY() {
    const fileIdx = document.getElementById('xyFileSelect').value;
    const x = document.getElementById('xyXAxis').value;
    const y = document.getElementById('xyYAxis').value;
    XYAnalysis.renderXYChart('xyChartCanvas', fileIdx, x, y);
  },

  resetZoom() {
    if (this.chartInstance) {
      this.chartInstance.resetZoom();
    }
  },

  generateScatterData(fileIndex, signalXName, signalYName) {
    const file = AppState.files[fileIndex];
    if (!file) {
      console.warn('XYAnalysis: File not found at index', fileIndex);
      return [];
    }

    const rawX = file.signals[signalXName];
    const rawY = file.signals[signalYName];

    if (!rawX || !rawY) {
      console.warn('XYAnalysis: Signals not found', signalXName, signalYName);
      return [];
    }

    const scatterPoints = [];
    let yIndex = 0;
    const isMilliseconds = rawX.length > 0 && rawX[0].x > 100000;
    const tolerance = isMilliseconds ? 500 : 0.5;

    rawX.forEach((pointX) => {
      const time = pointX.x;
      while (
        yIndex < rawY.length - 1 &&
        Math.abs(rawY[yIndex + 1].x - time) < Math.abs(rawY[yIndex].x - time)
      ) {
        yIndex++;
      }
      const pointY = rawY[yIndex];
      if (pointY && Math.abs(pointY.x - time) <= tolerance) {
        scatterPoints.push({
          x: parseFloat(pointX.y),
          y: parseFloat(pointY.y),
        });
      }
    });

    return scatterPoints;
  },

  renderXYChart(canvasId, fileIndex, signalX, signalY) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const data = this.generateScatterData(fileIndex, signalX, signalY);

    if (data.length === 0) {
      if (this.chartInstance) {
        this.chartInstance.destroy();
        this.chartInstance = null;
      }
      console.warn('XYAnalysis: No overlapping data found.');
      return;
    }

    if (this.chartInstance) {
      this.chartInstance.destroy();
    }

    const yValues = data.map((p) => p.y);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);

    const pointColors = data.map((p) => this.getHeatColor(p.y, minY, maxY));

    this.updateLegendUI(minY, maxY);

    const isDark = document.body.classList.contains('dark-theme');
    const gridColor = isDark
      ? 'rgba(255, 255, 255, 0.1)'
      : 'rgba(0, 0, 0, 0.1)';
    const textColor = isDark ? '#eee' : '#333';

    this.chartInstance = new Chart(ctx, {
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
            title: { display: true, text: signalX, color: textColor },
            type: 'linear',
            position: 'bottom',
            grid: { color: gridColor },
            ticks: { color: textColor },
          },
          y: {
            title: { display: true, text: signalY, color: textColor },
            grid: { color: gridColor },
            ticks: { color: textColor },
            beginAtZero: false,
          },
        },
        plugins: {
          datalabels: { display: false },
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                return [
                  `${signalY}: ${context.parsed.y.toFixed(2)}`,
                  `${signalX}: ${context.parsed.x.toFixed(2)}`,
                ];
              },
            },
          },
          zoom: {
            pan: {
              enabled: true,
              mode: 'xy',
            },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              drag: {
                enabled: true,
                backgroundColor: 'rgba(227, 24, 55, 0.3)',
              },
              mode: 'xy',
            },
          },
        },
      },
    });
  },

  updateLegendUI(min, max) {
    const legendContainer = document.getElementById('xyLegendContainer');
    const maxLabel = document.getElementById('xyLegendMax');
    const minLabel = document.getElementById('xyLegendMin');

    if (legendContainer && maxLabel && minLabel) {
      legendContainer.style.display = 'flex';
      maxLabel.innerText = max.toFixed(2);
      minLabel.innerText = min.toFixed(2);

      legendContainer.title = `Color Scale (Y Axis: ${min.toFixed(2)} - ${max.toFixed(2)})`;
    }
  },

  getHeatColor(value, min, max) {
    if (min === max) return 'hsla(240, 100%, 50%, 0.8)';

    let ratio = (value - min) / (max - min);
    ratio = Math.max(0, Math.min(1, ratio));
    const hue = (1 - ratio) * 240;
    return `hsla(${hue}, 100%, 50%, 0.8)`;
  },
};
