import { AppState } from './config.js';
import { UI } from './ui.js';

import {
  Chart,
  ScatterController,
  PointElement,
  LinearScale,
  Tooltip,
} from 'chart.js';

export const XYAnalysis = {
  chartInstance: null,

  init() {
    Chart.register(ScatterController, PointElement, LinearScale, Tooltip);
  },

  openXYModal() {
    document.getElementById('xyModal').style.display = 'flex';
    UI.populateXYSelectors();
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

  generateScatterData(fileIndex, signalXName, signalYName) {
    const file = AppState.files[fileIndex];
    if (!file) return [];

    const rawX = file.signals[signalXName];
    const rawY = file.signals[signalYName];

    if (!rawX || !rawY) return [];

    const scatterPoints = [];

    rawX.forEach((pointX) => {
      const time = pointX.x;

      const pointY = rawY.reduce((prev, curr) =>
        Math.abs(curr.x - time) < Math.abs(prev.x - time) ? curr : prev
      );

      if (Math.abs(pointY.x - time) < 0.5) {
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

    if (this.chartInstance) {
      this.chartInstance.destroy();
    }

    const isDark = document.body.classList.contains('dark-theme');
    const color = isDark ? 'rgba(255, 99, 132, 0.8)' : 'rgba(227, 24, 55, 0.6)';
    const gridColor = isDark
      ? 'rgba(255, 255, 255, 0.1)'
      : 'rgba(0, 0, 0, 0.1)';
    const textColor = isDark ? '#eee' : '#333';

    this.chartInstance = new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: `${signalY} (Y) vs ${signalX} (X)`,
            data: data,
            backgroundColor: color,
            borderColor: color,
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
          legend: {
            labels: { color: textColor },
          },
          tooltip: {
            callbacks: {
              label: (context) =>
                `X: ${context.parsed.x.toFixed(2)}, Y: ${context.parsed.y.toFixed(2)}`,
            },
          },
        },
      },
    });
  },
};
