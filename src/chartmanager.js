import { AppState, DOM, DEFAULT_SIGNALS } from './config.js';
import { PaletteManager } from './palettemanager.js';
import { UI } from './ui.js';
import { Preferences } from './preferences.js';
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

/**
 * ChartManager Module
 * Handles multi-chart rendering, synchronization, and interactive telemetry visualization.
 */
export const ChartManager = {
  hoverValue: null,
  activeChartIndex: null,
  datalabelsSettings: { timeRange: 5000, visibleDatasets: 5 },

  // --- Core Lifecycle ---
  init() {
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

  render() {
    const container = DOM.get('chartContainer');
    if (!container) return;

    // Smart Update: If file count matches instances, just refresh colors/data
    if (this._canPerformSmartUpdate()) {
      this._performSmartUpdate();
      return;
    }

    this._fullRebuild(container);
  },

  zoomTo(startSec, endSec, targetIndex = null) {
    AppState.activeHighlight = { start: startSec, end: endSec, targetIndex };

    if (targetIndex !== null && AppState.chartInstances[targetIndex]) {
      const chart = AppState.chartInstances[targetIndex];
      const file = AppState.files[targetIndex];
      const duration = endSec - startSec;
      const padding = duration * 4.0;

      chart.options.scales.x.min =
        file.startTime + Math.max(0, startSec - padding) * 1000;
      chart.options.scales.x.max =
        file.startTime + Math.min(file.duration, endSec + padding) * 1000;
      chart.update('none');
    }
  },

  reset() {
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

        ChartManager.updateLabelVisibility(chart);
      }
    });
  },

  /**
   * Performs a high-performance update of area fills across all charts.
   * This avoids destroying/recreating DOM elements.
   */
  updateAreaFills() {
    const { showAreaFills } = Preferences.prefs;

    AppState.chartInstances.forEach((chart) => {
      chart.data.datasets.forEach((dataset) => {
        // Use existing border color to ensure consistency
        const color = dataset.borderColor;

        dataset.fill = showAreaFills ? 'origin' : false;
        dataset.backgroundColor = showAreaFills
          ? this.getAlphaColor(color, 0.1)
          : 'transparent';
      });

      // Apply changes instantly
      chart.update('none');
    });
  },

  // --- Instance Management ---

  createInstance(canvas, file, index) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    this._attachMouseListeners(canvas, index);

    const datasets = file.availableSignals.map((key, idx) =>
      this._buildDataset(file, key, index, idx)
    );

    const chart = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      plugins: [this.highlighterPlugin],
      options: this._getChartOptions(file),
    });

    AppState.chartInstances[index] = chart;
  },

  manualZoom(index, zoomLevel) {
    const chart = AppState.chartInstances[index];
    if (!chart) return;

    chart.zoom(zoomLevel);
    this.updateLabelVisibility(chart);
  },

  updateLabelVisibility(chart) {
    // 1. Mobile Guard: Always hide labels on small screens to prevent clutter
    if (window.innerWidth <= 768) {
      if (chart.options.plugins.datalabels.display !== false) {
        chart.options.plugins.datalabels.display = false;
        chart.update('none');
      }
      return;
    }

    // 2. Desktop Logic: Determine visibility based on zoom and dataset count
    const shouldShow = this._shouldShowLabels(chart);

    if (chart.options.plugins.datalabels.display !== shouldShow) {
      chart.options.plugins.datalabels.display = shouldShow;
      chart.update('none');
    }
  },

  initKeyboardControls(canvas, index) {
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
          this.reset();
          return;
        default:
          return;
      }

      this.hoverValue = (chart.scales.x.min + chart.scales.x.max) / 2;
      this.activeChartIndex = index;
      chart.draw();
    });
  },

  removeFile(index) {
    this.hoverValue = null;
    this.activeChartIndex = null;
    AppState.files.splice(index, 1);
    this.render();
    UI.renderSignalList();
  },

  // --- Internal Logic (Private Conventions) ---

  _canPerformSmartUpdate() {
    return (
      AppState.chartInstances.length > 0 &&
      AppState.chartInstances.length === AppState.files.length
    );
  },

  _performSmartUpdate() {
    AppState.chartInstances.forEach((chart, fileIdx) => {
      chart.data.datasets.forEach((dataset, sigIdx) => {
        dataset.borderColor = PaletteManager.getColorForSignal(fileIdx, sigIdx);
        dataset.backgroundColor = 'transparent';
      });
      chart.update('none');
    });
  },

  _fullRebuild(container) {
    // Cleanup existing instances
    AppState.chartInstances.forEach((c) => c?.destroy());
    AppState.chartInstances = [];
    container
      .querySelectorAll('.chart-card-compact')
      .forEach((card) => card.remove());

    if (AppState.files.length === 0) {
      this._handleEmptyState();
      return;
    }

    UI.updateDataLoadedState(true);
    this._syncGlobalMetadata();

    AppState.files.forEach((file, idx) =>
      this._renderChartCard(container, file, idx)
    );
  },

  _getChartOptions(file) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: { beginAtZero: true, max: 1.2, ticks: { display: false } },
        x: {
          type: 'time',
          time: { unit: 'second', displayFormats: { second: 'mm:ss' } },
          min: file.startTime,
          max: file.startTime + file.duration * 1000,
        },
      },
      plugins: {
        datalabels: {
          display: (context) => this._shouldShowLabels(context.chart),
          anchor: 'end',
          align: 'top',
          backgroundColor: (context) => context.dataset.borderColor,
          color: 'white',
          formatter: (value, context) => {
            const ds = context.dataset;
            const realY =
              value.y * (ds.originalMax - ds.originalMin) + ds.originalMin;
            return realY.toFixed(1);
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
          position: 'nearest',
          callbacks: {
            label: (context) => {
              const ds = context.dataset;
              const realY =
                context.parsed.y * (ds.originalMax - ds.originalMin) +
                ds.originalMin;
              return ` ${ds.label}: ${realY.toFixed(2)}`;
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

        zoom: {
          pan: { enabled: true, mode: 'x' },
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: 'x',
            onZoom: ({ chart }) => {
              this.updateLabelVisibility(chart);
            },
          },
        },
      },
    };
  },

  _shouldShowLabels(chart) {
    const xRange = chart.scales.x.max - chart.scales.x.min;
    const isZoomedIn = xRange < this.datalabelsSettings.timeRange;
    const visibleDatasets = chart.data.datasets.filter(
      (ds) => !ds.hidden
    ).length;
    const isNotCrowded =
      visibleDatasets <= this.datalabelsSettings.visibleDatasets;
    return isZoomedIn && isNotCrowded;
  },

  _renderChartCard(container, file, idx) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-card-compact';
    wrapper.innerHTML = `
      <div class="chart-header-sm" style="display: flex; justify-content: space-between; align-items: center;">
          <span class="chart-name">${file.name}</span>
          <div class="chart-actions" style="display: flex; gap: 8px; align-items: center;">
              <button class="btn-icon" onclick="manualZoom(${idx}, 1.2)" title="Zoom In">
                  <i class="fas fa-search-plus"></i>
              </button>
              <button class="btn-icon" onclick="manualZoom(${idx}, 0.8)" title="Zoom Out">
                  <i class="fas fa-search-minus"></i>
              </button>
              <button class="btn-remove" onclick="removeFile(${idx})">×</button>
          </div>
      </div>
      <div class="canvas-wrapper">
          <canvas id="chart-${idx}" tabindex="0"></canvas>
      </div>
    `;
    container.appendChild(wrapper);

    const canvas = document.getElementById(`chart-${idx}`);
    this.createInstance(canvas, file, idx);
    this.initKeyboardControls(canvas, idx);
  },

  _handleEmptyState() {
    UI.updateDataLoadedState(false);
    AppState.globalStartTime = 0;
    AppState.logDuration = 0;
  },

  _syncGlobalMetadata() {
    if (AppState.files.length > 0) {
      const primary = AppState.files[0];
      AppState.globalStartTime = primary.startTime;
      AppState.logDuration = primary.duration;
    }
  },

  _buildDataset(file, key, fileIdx, sigIdx) {
    const isImportant = DEFAULT_SIGNALS.some((k) => key.includes(k));
    const rawData = file.signals[key];
    const yValues = rawData.map((d) => parseFloat(d.y) || 0);

    const min = Math.min(...yValues);
    const max = Math.max(...yValues);
    const range = max - min;

    const normalizedData = rawData.map((d) => ({
      x: d.x,
      y: range === 0 ? 0 : (parseFloat(d.y) - min) / range,
    }));

    const color = PaletteManager.getColorForSignal(fileIdx, sigIdx);
    const { showAreaFills } = Preferences.prefs;

    return {
      label: key,
      originalMin: min,
      originalMax: max,
      data: normalizedData,
      borderColor: color,
      borderWidth: isImportant ? 3 : 1.5,
      pointRadius: 0,

      backgroundColor: showAreaFills
        ? this.getAlphaColor(color, 0.1)
        : 'transparent',
      fill: showAreaFills ? 'origin' : false,
      hidden: !isImportant,
    };
  },

  _attachMouseListeners(canvas, index) {
    canvas.addEventListener('mousemove', (e) => {
      const chart = AppState.chartInstances[index];
      if (!chart) return;

      const prevIndex = this.activeChartIndex;
      this.hoverValue = chart.scales.x.getValueForPixel(e.offsetX);
      this.activeChartIndex = index;

      chart.draw();
      if (prevIndex !== null && prevIndex !== index) {
        AppState.chartInstances[prevIndex]?.draw();
      }
    });

    canvas.addEventListener('mouseleave', () => {
      const prevIndex = this.activeChartIndex;
      this.hoverValue = null;
      this.activeChartIndex = null;
      AppState.chartInstances[prevIndex]?.draw();
    });
  },

  // --- Utilities ---

  getAlphaColor: (hex, alpha = 0.1) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

      // Draw active anomaly highlights
      if (AppState.activeHighlight?.targetIndex === chartIdx) {
        const file = AppState.files[chartIdx];
        const pxStart = x.getPixelForValue(
          file.startTime + AppState.activeHighlight.start * 1000
        );
        const pxEnd = x.getPixelForValue(
          file.startTime + AppState.activeHighlight.end * 1000
        );

        if (!isNaN(pxStart) && !isNaN(pxEnd)) {
          ctx.save();
          ctx.fillStyle = 'rgba(255, 0, 0, 0.08)';
          ctx.fillRect(
            Math.max(pxStart, left),
            top,
            Math.min(pxEnd, right) - Math.max(pxStart, left),
            bottom - top
          );
          ctx.restore();
        }
      }

      // Draw global vertical crosshair
      if (
        ChartManager.activeChartIndex === chartIdx &&
        ChartManager.hoverValue
      ) {
        const xPixel = x.getPixelForValue(ChartManager.hoverValue);
        if (xPixel >= left && xPixel <= right) {
          ctx.beginPath();
          ctx.strokeStyle = '#9a0000';
          ctx.lineWidth = 2;
          ctx.moveTo(xPixel, top);
          ctx.lineTo(xPixel, bottom);
          ctx.stroke();
        }
      }
    },
  },
};
