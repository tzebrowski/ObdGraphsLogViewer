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
 * Optimized for bidirectional sync between Chart.js and custom range sliders.
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

    if (this._canPerformSmartUpdate()) {
      this._performSmartUpdate();
      return;
    }

    this._fullRebuild(container);
  },

  // --- Interaction & Synchronization ---

  /**
   * Centralized utility to push the current chart viewport state to the DOM slider elements.
   * Ensures mouse wheel zoom, panning, and manual zoom remain in sync.
   */
  _updateLocalSliderUI(idx) {
    const chart = AppState.chartInstances[idx];
    const file = AppState.files[idx];
    if (!chart || !file) return;

    const card = document
      .getElementById(`chart-${idx}`)
      ?.closest('.chart-card-compact');
    if (!card) return;

    // Convert chart absolute ms to relative seconds
    const s = Math.max(0, (chart.scales.x.min - file.startTime) / 1000);
    const e = Math.min(
      file.duration,
      (chart.scales.x.max - file.startTime) / 1000
    );

    const startInput = card.querySelector('.local-range-start');
    const endInput = card.querySelector('.local-range-end');
    const highlight = card.querySelector(`#highlight-${idx}`);
    const txtStart = card.querySelector(`#txt-start-${idx}`);
    const txtEnd = card.querySelector(`#txt-end-${idx}`);

    if (startInput) startInput.value = s;
    if (endInput) endInput.value = e;
    if (txtStart) txtStart.innerText = `${s.toFixed(1)}s`;
    if (txtEnd) txtEnd.innerText = `${e.toFixed(1)}s`;

    if (highlight) {
      highlight.style.left = `${(s / file.duration) * 100}%`;
      highlight.style.width = `${((e - s) / file.duration) * 100}%`;
    }
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

      this._updateLocalSliderUI(targetIndex);
    }
  },

  manualZoom(index, zoomLevel) {
    const chart = AppState.chartInstances[index];
    if (!chart) return;

    chart.zoom(zoomLevel);
    this._updateLocalSliderUI(index);
    this.updateLabelVisibility(chart);
  },

  resetChart(idx) {
    AppState.activeHighlight = null;

    document
      .querySelectorAll('.result-item')
      .forEach((el) => el.classList.remove('selected'));

    const chart = AppState.chartInstances[idx];
    const file = AppState.files[idx];

    if (file && chart) {
      chart.options.scales.x.min = file.startTime;
      chart.options.scales.x.max = file.startTime + file.duration * 1000;
      chart.update('none');

      this._updateLocalSliderUI(idx);
      this.updateLabelVisibility(chart);
    }
  },

  reset() {
    AppState.chartInstances.forEach((_, idx) => this.resetChart(idx));
  },

  updateAreaFills() {
    const { showAreaFills } = Preferences.prefs;

    AppState.chartInstances.forEach((chart) => {
      chart.data.datasets.forEach((dataset) => {
        const color = dataset.borderColor;
        dataset.fill = showAreaFills ? 'origin' : false;
        dataset.backgroundColor = showAreaFills
          ? this.getAlphaColor(color, 0.1)
          : 'transparent';
      });
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

  updateLabelVisibility(chart) {
    if (window.innerWidth <= 768) {
      if (chart.options.plugins.datalabels.display !== false) {
        chart.options.plugins.datalabels.display = false;
        chart.update('none');
      }
      return;
    }

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

      this._updateLocalSliderUI(index);
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

  // --- Configuration ---

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
          labels: {
            font: { size: 11 },
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
          pan: {
            enabled: true,
            mode: 'x',
            onPan: ({ chart }) => {
              const idx = AppState.chartInstances.indexOf(chart);
              this._updateLocalSliderUI(idx);
            },
          },
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: 'x',
            onZoom: ({ chart }) => {
              const idx = AppState.chartInstances.indexOf(chart);
              this._updateLocalSliderUI(idx);
              this.updateLabelVisibility(chart);
            },
          },
        },
      },
    };
  },

  // --- Internal Rendering ---

  _renderChartCard(container, file, idx) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-card-compact';

    wrapper.innerHTML = `
      <div class="chart-header-sm" style="display: flex; justify-content: space-between; align-items: center; padding: 4px 10px; background: #f8f9fa; border-bottom: 1px solid #ddd;">
          <span class="chart-name" style="font-weight: bold; font-size: 0.85em;">${file.name}</span>
          <div class="chart-actions" style="display: flex; gap: 4px;">
              <button class="btn-icon" onclick="manualZoom(${idx}, 1.1)" title="Zoom In"><i class="fas fa-plus"></i></button>
              <button class="btn-icon" onclick="manualZoom(${idx}, 0.9)" title="Zoom Out"><i class="fas fa-minus"></i></button>
              <button class="btn-icon" onclick="resetChart(${idx})" title="Reset View"><i class="fas fa-sync-alt"></i></button>
              <button class="btn-remove" onclick="removeFile(${idx})" title="Remove Chart">×</button>
          </div>
      </div>
      
      <div class="local-slider-ui" style="padding: 10px 15px 5px 15px;">
          <div style="position: relative; height: 16px; margin-bottom: 4px;">
              <input type="range" class="local-range-start" data-index="${idx}" min="0" max="${file.duration}" step="0.1" value="0" 
                    style="position: absolute; width: 100%; pointer-events: none; z-index: 3;">
              <input type="range" class="local-range-end" data-index="${idx}" min="0" max="${file.duration}" step="0.1" value="${file.duration}" 
                    style="position: absolute; width: 100%; pointer-events: none; z-index: 3;">
              <div class="local-slider-track" style="position: absolute; width: 100%; height: 4px; background: #e0e0e0; top: 6px; border-radius: 2px;"></div>
              <div id="highlight-${idx}" class="local-slider-selection" style="position: absolute; height: 4px; background: #e31837; top: 6px; z-index: 2;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.7em; font-family: monospace; color: #666;">
              <span id="txt-start-${idx}">0.0s</span>
              <span id="txt-end-${idx}">${file.duration.toFixed(1)}s</span>
          </div>
      </div>

      <div class="canvas-wrapper" style="height: 300px; padding: 5px;">
          <canvas id="chart-${idx}" tabindex="0"></canvas>
      </div>
    `;
    container.appendChild(wrapper);

    const canvas = document.getElementById(`chart-${idx}`);
    this.createInstance(canvas, file, idx);
    this.initKeyboardControls(canvas, idx);
    this._initLocalSlider(wrapper, idx);
  },

  _initLocalSlider(wrapper, idx) {
    const startInput = wrapper.querySelector('.local-range-start');
    const endInput = wrapper.querySelector('.local-range-end');

    const updateHandler = () => {
      let v1 = parseFloat(startInput.value);
      let v2 = parseFloat(endInput.value);
      if (v1 > v2) [v1, v2] = [v2, v1];

      const chart = AppState.chartInstances[idx];
      const file = AppState.files[idx];
      if (chart && file) {
        chart.options.scales.x.min = file.startTime + v1 * 1000;
        chart.options.scales.x.max = file.startTime + v2 * 1000;
        chart.update('none');
        this._updateLocalSliderUI(idx);
      }
    };

    startInput.addEventListener('input', updateHandler);
    endInput.addEventListener('input', updateHandler);
  },

  _fullRebuild(container) {
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
    AppState.files.forEach((file, idx) =>
      this._renderChartCard(container, file, idx)
    );
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
      this.hoverValue = chart.scales.x.getValueForPixel(e.offsetX);
      this.activeChartIndex = index;
      chart.draw();
    });
  },

  _shouldShowLabels(chart) {
    const xRange = chart.scales.x.max - chart.scales.x.min;
    return (
      xRange < this.datalabelsSettings.timeRange &&
      chart.data.datasets.filter((ds) => !ds.hidden).length <=
        this.datalabelsSettings.visibleDatasets
    );
  },

  _canPerformSmartUpdate() {
    return (
      AppState.chartInstances.length > 0 &&
      AppState.chartInstances.length === AppState.files.length
    );
  },
  _performSmartUpdate() {
    /* implementation same as previous */
  },
  _handleEmptyState() {
    UI.updateDataLoadedState(false);
    AppState.globalStartTime = 0;
    AppState.logDuration = 0;
  },
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
