import { AppState, DOM, DEFAULT_SIGNALS, getChartColors } from './config.js';
import { UI } from './ui.js';
import Hammer from 'hammerjs';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  LogarithmicScale,
  TimeScale,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import 'chartjs-adapter-date-fns';
import zoomPlugin from 'chartjs-plugin-zoom';

export const ChartManager = {
  hoverValue: null,
  activeChartIndex: null,

  datalabelsSettings: {
    timeRange: 5000,
    visibleDatasets: 5,
  },

  init: () => {
    window.Hammer = Hammer;

    Chart.register(
      LineController,
      LineElement,
      PointElement,
      LinearScale,
      LogarithmicScale,
      TimeScale,
      Title,
      Tooltip,
      Legend,
      Filler,
      ChartDataLabels,
      zoomPlugin
    );
  },

  render: () => {
    const container = DOM.get('chartContainer');
    if (!container) return;

    AppState.chartInstances.forEach((c) => {
      if (c) c.destroy();
    });
    AppState.chartInstances = [];

    container
      .querySelectorAll('.chart-card-compact')
      .forEach((card) => card.remove());

    if (AppState.files.length === 0) {
      UI.updateDataLoadedState(false);
      AppState.globalStartTime = 0;
      AppState.logDuration = 0;
      return;
    }

    UI.updateDataLoadedState(true);

    const primary = AppState.files[0];
    AppState.globalStartTime = primary.startTime;
    AppState.logDuration = primary.duration;

    AppState.files.forEach((file, idx) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'chart-card-compact';
      wrapper.innerHTML = `
                <div class="chart-header-sm">
                    <span class="chart-name">${file.name}</span>
                    <button class="btn-remove" onclick="removeFile(${idx})">×</button>
                </div>
                <div class="canvas-wrapper">
                    <canvas id="chart-${idx}" tabindex="0"></canvas>
                </div>
            `;
      container.appendChild(wrapper);

      const canvas = document.getElementById(`chart-${idx}`);
      ChartManager.createInstance(canvas, file, idx);
      ChartManager.initKeyboardControls(canvas, idx);
    });

    if (typeof Sliders !== 'undefined') Sliders.init(AppState.logDuration);
  },

  createInstance: (canvas, file, index) => {
    const ctx = canvas.getContext('2d');

    canvas.addEventListener('mousemove', (e) => {
      const chart = AppState.chartInstances[index];
      if (!chart) return;

      const prevIndex = ChartManager.activeChartIndex;
      ChartManager.hoverValue = chart.scales.x.getValueForPixel(e.offsetX);
      ChartManager.activeChartIndex = index;

      chart.draw();
      if (
        prevIndex !== null &&
        prevIndex !== index &&
        AppState.chartInstances[prevIndex]
      ) {
        AppState.chartInstances[prevIndex].draw();
      }
    });

    canvas.addEventListener('mouseleave', () => {
      const prevIndex = ChartManager.activeChartIndex;
      ChartManager.hoverValue = null;
      ChartManager.activeChartIndex = null;
      if (prevIndex !== null && AppState.chartInstances[prevIndex]) {
        AppState.chartInstances[prevIndex].draw();
      }
    });

    const datasets = file.availableSignals.map((key, idx) => {
      const isImportant = DEFAULT_SIGNALS.some((k) => key.includes(k));
      const chartColors = getChartColors();
      const color = chartColors[idx % chartColors.length];

      const rawData = file.signals[key];
      const yValues = rawData.map((d) => parseFloat(d.y) || 0);
      const min = Math.min(...yValues);
      const max = Math.max(...yValues);
      const range = max - min;

      const normalizedData = rawData.map((d) => ({
        x: d.x,
        y: range === 0 ? 0 : (parseFloat(d.y) - min) / range,
      }));

      return {
        label: key,
        originalMin: min,
        originalMax: max,
        data: normalizedData,
        borderColor: color,
        backgroundColor: 'transparent',
        borderWidth: isImportant ? 3 : 1.5,
        pointRadius: 0,
        pointHoverRadius: 6,
        tension: 0.1,
        fill: false,
        hidden: !isImportant,
      };
    });

    const chart = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      plugins: [ChartManager.highlighterPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        scales: {
          y: {
            // type: 'logarithmic',
            beginAtZero: true,
            max: 1.2,
            ticks: {
              display: false,
            },
          },
          x: {
            type: 'time',
            time: { unit: 'second', displayFormats: { second: 'mm:ss' } },
            min: file.startTime,
            max: file.startTime + file.duration * 1000,
          },
        },
        plugins: {
          datalabels: {
            display: (context) => {
              const chart = context.chart;

              const xRange = chart.scales.x.max - chart.scales.x.min;
              const isZoomedIn =
                xRange < ChartManager.datalabelsSettings.timeRange;

              const visibleDatasets = chart.data.datasets.filter(
                (ds) => !ds.hidden
              ).length;
              const isNotCrowded =
                visibleDatasets <=
                ChartManager.datalabelsSettings.visibleDatasets;

              return isZoomedIn && isNotCrowded;
            },
            anchor: 'end',
            align: 'top',
            offset: 5,
            borderRadius: 4,
            padding: 4,
            backgroundColor: (context) => context.dataset.borderColor,
            color: 'white',
            font: {
              weight: 'bold',
              size: 10,
            },
            formatter: (value, context) => {
              const ds = context.dataset;
              const realY =
                value.y * (ds.originalMax - ds.originalMin) + ds.originalMin;
              return realY.toFixed(1);
            },
            listeners: {
              enter: (context) => {
                context.hovered = true;
                return true;
              },
              leave: (context) => {
                context.hovered = false;
                return true;
              },
            },
          },

          legend: {
            display: true,
            position: 'bottom',
            align: 'end',
            labels: {
              boxWidth: 12,
              padding: 10,
              font: {
                size: 11,
              },
              filter: (item) => {
                const text = item.text.replace(/\n/g, ' ');
                const checkbox = document.querySelector(
                  `#signalList input[data-key="${text}"]`
                );
                return checkbox ? checkbox.checked : false;
              },
            },
          },
          tooltip: {
            enabled: true,
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(34, 34, 34, 0.7)',
            titleColor: '#fff',
            bodyColor: '#eee',
            borderColor: 'rgba(68, 68, 68, 0.5)',
            borderWidth: 1,
            padding: 10,
            bodyFont: { family: 'monospace' },
            position: 'nearest',
            callbacks: {
              label: (context) => {
                const ds = context.dataset;
                const normalizedY = context.parsed.y;
                const realY =
                  normalizedY * (ds.originalMax - ds.originalMin) +
                  ds.originalMin;
                return ` ${ds.label}: ${realY.toFixed(2)}`;
              },
            },
          },
          zoom: {
            pan: {
              enabled: true,
              mode: 'x',
              threshold: 10,
              onPan: ChartManager.syncAll,
            },
            zoom: {
              wheel: {
                enabled: true,
                speed: 0.1,
              },
              pinch: {
                enabled: true,
              },
              mode: 'x',
              onZoom: ({ chart }) => {
                ChartManager.updateLabelVisibility(chart);
                ChartManager.syncAll({ chart });
              },

              onPan: ({ chart }) => {
                ChartManager.updateLabelVisibility(chart);
                ChartManager.syncAll({ chart });
              },
            },
          },
        },
      },
    });
    AppState.chartInstances[index] = chart;
  },

  updateLabelVisibility(chart) {
    if (window.innerWidth <= 768) {
      if (chart.options.plugins.datalabels.display !== false) {
        chart.options.plugins.datalabels.display = false;
        chart.update('none');
      }
      return;
    }

    const xRange = chart.scales.x.max - chart.scales.x.min;
    const visibleDatasets = chart.data.datasets.filter(
      (ds) => !ds.hidden
    ).length;
    const shouldShow =
      xRange < ChartManager.datalabelsSettings.timeRange &&
      visibleDatasets < ChartManager.datalabelsSettings.visibleDatasets;
    if (chart.options.plugins.datalabels.display !== shouldShow) {
      chart.options.plugins.datalabels.display = shouldShow;
      chart.update('none');
    }
  },

  getAlphaColor: (hex, alpha = 0.1) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  },

  removeFile: (index) => {
    ChartManager.hoverValue = null;
    ChartManager.activeChartIndex = null;

    AppState.files.splice(index, 1);

    ChartManager.render();

    if (AppState.files.length == 0) {
      UI.updateDataLoadedState(false);
    }

    UI.renderSignalList();
  },

  syncAll: ({ chart }) => {
    if (typeof Sliders !== 'undefined') Sliders.syncFromChart({ chart });
  },

  initKeyboardControls: (canvas, index) => {
    canvas.addEventListener('keydown', (e) => {
      const chart = AppState.chartInstances[index];
      if (!chart) return;

      const amount = e.shiftKey ? 0.05 : 0.01;
      switch (e.key) {
        case 'ArrowLeft':
          chart.pan({ x: chart.width * amount }, undefined, 'none');
          break;
        case 'ArrowRight':
          chart.pan({ x: -chart.width * amount }, undefined, 'none');
          break;
        case '+':
        case '=':
          chart.zoom(1.1, undefined, 'none');
          break;
        case '-':
        case '_':
          chart.zoom(0.9, undefined, 'none');
          break;
        case 'r':
        case 'R':
          Sliders.reset();
          return;
        default:
          return;
      }

      ChartManager.hoverValue = (chart.scales.x.min + chart.scales.x.max) / 2;
      ChartManager.activeChartIndex = index;
      ChartManager.syncAll({ chart });
      chart.draw();
    });
  },

  highlighterPlugin: {
    id: 'anomalyHighlighter',
    afterDraw(chart) {
      const {
        ctx,
        chartArea: { top, bottom, left, right },
        scales: { x },
      } = chart;
      const chartIdx = AppState.chartInstances.indexOf(chart);

      if (chartIdx === -1) return;

      ctx.save();

      if (
        AppState.activeHighlight &&
        AppState.activeHighlight.targetIndex === chartIdx
      ) {
        const file = AppState.files[chartIdx];

        const pxStart = x.getPixelForValue(
          file.startTime + AppState.activeHighlight.start * 1000
        );
        const pxEnd = x.getPixelForValue(
          file.startTime + AppState.activeHighlight.end * 1000
        );

        const visibleXStart = Math.max(pxStart, left);
        const visibleXEnd = Math.min(pxEnd, right);
        const drawWidth = visibleXEnd - visibleXStart;

        if (drawWidth > 0) {
          ctx.fillStyle = 'rgba(255, 0, 0, 0.08)';
          ctx.fillRect(visibleXStart, top, drawWidth, bottom - top);

          ctx.strokeStyle = 'rgba(255, 0, 0, 0.4)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);

          if (pxStart >= left && pxStart <= right) {
            ctx.beginPath();
            ctx.moveTo(pxStart, top);
            ctx.lineTo(pxStart, bottom);
            ctx.stroke();
          }
          if (pxEnd >= left && pxEnd <= right) {
            ctx.beginPath();
            ctx.moveTo(pxEnd, top);
            ctx.lineTo(pxEnd, bottom);
            ctx.stroke();
          }
        }
      }

      if (
        ChartManager.activeChartIndex === chartIdx &&
        ChartManager.hoverValue
      ) {
        const xPixel = x.getPixelForValue(ChartManager.hoverValue);
        if (xPixel >= chart.chartArea.left && xPixel <= chart.chartArea.right) {
          ctx.beginPath();
          ctx.strokeStyle = '#9a0000';
          ctx.lineWidth = 2;
          ctx.moveTo(xPixel, top);
          ctx.lineTo(xPixel, bottom);
          ctx.stroke();
        }
      }
      ctx.restore();
    },
  },
};

export const Sliders = {
  get els() {
    return {
      start: DOM.get('rangeStart'),
      end: DOM.get('rangeEnd'),
      txtStart: DOM.get('txtStart'),
      txtEnd: DOM.get('txtEnd'),
      bar: DOM.get('sliderHighlight'),
    };
  },

  init: (maxDuration) => {
    const { start, end } = Sliders.els;
    if (!start || !end) return;
    start.max = maxDuration;
    end.max = maxDuration;
    start.value = 0;
    end.value = maxDuration;
    Sliders.updateUI(false);
  },

  zoomTo: (startSec, endSec, targetIndex = null) => {
    AppState.activeHighlight = {
      start: startSec,
      end: endSec,
      targetIndex: targetIndex,
    };

    if (targetIndex !== null && AppState.chartInstances[targetIndex]) {
      const chart = AppState.chartInstances[targetIndex];
      const file = AppState.files[targetIndex];

      const duration = endSec - startSec;
      const padding = duration * 4.0;

      const viewMin = Math.max(0, startSec - padding);
      const viewMax = Math.min(file.duration, endSec + padding);

      chart.options.scales.x.min = file.startTime + viewMin * 1000;
      chart.options.scales.x.max = file.startTime + viewMax * 1000;
      chart.update('none');
    }

    const { start, end } = Sliders.els;
    if (start && end) {
      start.value = startSec;
      end.value = endSec;
      Sliders.updateVis(startSec, endSec);
    }
  },

  syncFromChart: ({ chart }) => {
    const { start, end } = Sliders.els;
    const s = Math.max(
      0,
      (chart.scales.x.min - AppState.globalStartTime) / 1000
    );
    const e = Math.min(
      AppState.logDuration,
      (chart.scales.x.max - AppState.globalStartTime) / 1000
    );
    if (start) start.value = s;
    if (end) end.value = e;
    Sliders.updateVis(s, e);
  },
  updateFromInput: () => Sliders.updateUI(true),
  updateUI: (shouldUpdateChart) => {
    const { start, end } = Sliders.els;
    if (!start || !end) return;
    let v1 = parseFloat(start.value);
    let v2 = parseFloat(end.value);
    if (v1 > v2) [v1, v2] = [v2, v1];
    Sliders.updateVis(v1, v2);
    if (shouldUpdateChart) {
      AppState.chartInstances.forEach((chart) => {
        chart.options.scales.x.min = AppState.globalStartTime + v1 * 1000;
        chart.options.scales.x.max = AppState.globalStartTime + v2 * 1000;
        chart.update('none');
      });
    }
  },
  updateVis: (start, end) => {
    const { txtStart, txtEnd, bar, start: startEl } = Sliders.els;
    if (txtStart) txtStart.innerText = start.toFixed(1) + 's';
    if (txtEnd) txtEnd.innerText = end.toFixed(1) + 's';
    const total = parseFloat(startEl?.max) || 100;
    if (bar) {
      bar.style.left = (start / total) * 100 + '%';
      bar.style.width = ((end - start) / total) * 100 + '%';
    }
  },
  reset: () => {
    AppState.activeHighlight = null;
    document
      .querySelectorAll('.result-item')
      .forEach((el) => el.classList.remove('selected'));

    AppState.chartInstances.forEach((chart, idx) => {
      const file = AppState.files[idx];
      if (file) {
        chart.options.scales.x.min = file.startTime;
        chart.options.scales.x.max = file.startTime + file.duration * 1000;
        chart.update('none');
      }
    });

    if (AppState.files.length > 0) {
      Sliders.init(AppState.files[0].duration);
    }
  },
};
