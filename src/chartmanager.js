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
import { messenger } from './bus.js';

export const ChartManager = {
  hoverValue: null,
  activeChartIndex: null,
  datalabelsSettings: { timeRange: 5000, visibleDatasets: 5 },
  viewMode: 'stack',
  _rafId: null,

  init() {
    window.Hammer = Hammer;

    Tooltip.positioners.topRightCorner = function (_elements, _eventPosition) {
      if (!this.chart) return;
      const { chartArea } = this.chart;
      return { x: chartArea.right - 10, y: chartArea.top };
    };

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

    messenger.on('dataprocessor:batch-load-completed', (_event) => {
      ChartManager.render();
    });
  },

  _syncTooltip(chart, timeValue) {
    if (!chart || timeValue === null) return;

    const activeElements = [];
    const xTarget = chart.scales.x.getPixelForValue(timeValue);

    chart.data.datasets.forEach((ds, dsIdx) => {
      if (!chart.isDatasetVisible(dsIdx)) return;

      const index = this._findNearestIndex(ds.data, timeValue);

      if (index !== -1) {
        const pointTime = ds.data[index].x;
        if (Math.abs(pointTime - timeValue) < 5000) {
          activeElements.push({ datasetIndex: dsIdx, index: index });
        }
      }
    });

    if (activeElements.length > 0) {
      chart.setActiveElements(activeElements);
      chart.tooltip.setActiveElements(activeElements, {
        x: xTarget,
        y: (chart.chartArea.top + chart.chartArea.bottom) / 2,
      });
      chart.update();
    }
  },

  _findNearestIndex(data, targetTime) {
    if (!data || data.length === 0) return -1;

    if (targetTime <= data[0].x) return 0;
    if (targetTime >= data[data.length - 1].x) return data.length - 1;

    let start = 0;
    let end = data.length - 1;
    let mid;

    while (start <= end) {
      mid = Math.floor((start + end) / 2);
      if (data[mid].x === targetTime) return mid;
      else if (data[mid].x < targetTime) start = mid + 1;
      else end = mid - 1;
    }

    const p1 = data[end];
    const p2 = data[start];

    if (!p1) return start;
    if (!p2) return end;

    return Math.abs(targetTime - p1.x) < Math.abs(targetTime - p2.x)
      ? end
      : start;
  },

  stepCursor(index, stepCount) {
    const chart = AppState.chartInstances[index];
    const file =
      this.viewMode === 'overlay' ? AppState.files[0] : AppState.files[index];

    if (!chart || !file) return;

    let currentVal = this.hoverValue;
    if (currentVal === null) {
      currentVal = (chart.scales.x.min + chart.scales.x.max) / 2;
    }

    const stepSize = 100; // 0.1s
    let newVal = currentVal + stepCount * stepSize;

    const maxTime = file.startTime + file.duration * 1000;
    if (newVal < file.startTime) newVal = file.startTime;
    if (newVal > maxTime) newVal = maxTime;

    this.hoverValue = newVal;
    this.activeChartIndex = index;

    let viewChanged = false;
    const currentMin = chart.scales.x.min;
    const currentMax = chart.scales.x.max;
    const viewDuration = currentMax - currentMin;

    if (newVal >= currentMax) {
      const newMin = newVal - viewDuration * 0.2;
      chart.options.scales.x.min = newMin;
      chart.options.scales.x.max = newMin + viewDuration;
      viewChanged = true;
    } else if (newVal <= currentMin) {
      const newMin = newVal - viewDuration * 0.8;
      chart.options.scales.x.min = newMin;
      chart.options.scales.x.max = newMin + viewDuration;
      viewChanged = true;
    }

    if (viewChanged) {
      chart.update('none');
    }

    this._syncTooltip(chart, newVal);

    if (this.viewMode !== 'overlay') this._updateLocalSliderUI(index);
  },

  exportDataRange(index) {
    const file = AppState.files[index];
    const chart = AppState.chartInstances[index];
    if (!file || !chart) return;

    const minTime = chart.scales.x.min;
    const maxTime = chart.scales.x.max;

    let csvContent = 'data:text/csv;charset=utf-8,';

    const visibleSignals = file.availableSignals.filter((sig) => {
      const checkbox = document.querySelector(
        `#signalList input[data-key="${sig}"][data-file-idx="${index}"]`
      );
      return checkbox && checkbox.checked;
    });

    csvContent += 'Time (s),' + visibleSignals.join(',') + '\n';

    if (visibleSignals.length === 0) {
      alert('No signals visible to export.');
      return;
    }

    const masterSignal = file.signals[visibleSignals[0]];

    masterSignal.forEach((point) => {
      if (point.x >= minTime && point.x <= maxTime) {
        const relTime = (point.x - file.startTime) / 1000;
        let row = [relTime.toFixed(3)];

        visibleSignals.forEach((sigKey) => {
          const sigData = file.signals[sigKey];
          const valPoint = sigData.find((p) => Math.abs(p.x - point.x) < 100);
          row.push(valPoint ? parseFloat(valPoint.y).toFixed(3) : '');
        });

        csvContent += row.join(',') + '\n';
      }
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `${file.name}_export_${Math.round(minTime)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  showChartInfo(index) {
    const file = AppState.files[index];
    if (!file) return;

    const existing = document.getElementById('metadataModal');
    if (existing) existing.remove();

    const createRow = (label, value) => `
        <div style="display:flex; justify-content:space-between; padding: 6px 0; border-bottom: 1px solid #eee;">
            <strong style="color: #555;">${label}</strong>
            <span style="font-family: monospace; color: #333;">${value || 'N/A'}</span>
        </div>`;

    const meta = file.metadata || {};
    const durationFormatted = this.formatDuration(file.duration);

    const modalHtml = `
      <div id="metadataModal" class="modal-overlay" style="display: flex;">
        <div class="modal-content" style="max-width: 500px;">
          <div class="modal-header">
            <h2>Log Details</h2>
            <button class="btn-close" onclick="document.getElementById('metadataModal').remove()">×</button>
          </div>
          <div class="modal-body">
            <h4 style="margin-top:0; color:#c22636;">${file.name}</h4>
            ${createRow('Start Time', new Date(file.startTime).toLocaleString())}
            ${createRow('Duration', durationFormatted)}
            ${createRow('Signals Count', file.availableSignals.length)}
            ${createRow('Profile Name', meta.profileName || 'Unknown')}
            ${createRow('ECU ID', meta.ecuId || 'N/A')}
            ${createRow('App Version', meta.appVersion || 'N/A')}
            <div style="margin-top: 20px; text-align: right;">
               <button class="btn btn-primary" onclick="document.getElementById('metadataModal').remove()">Close</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
  },

  toggleViewMode(mode) {
    if (this.viewMode === mode) return;
    this.viewMode = mode;

    document
      .querySelectorAll('.view-mode-btn')
      .forEach((btn) => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`btn-mode-${mode}`);
    if (activeBtn) activeBtn.classList.add('active');

    this.render();
  },

  render() {
    const container = DOM.get('chartContainer');
    if (!container) return;

    AppState.chartInstances.forEach((c) => c?.destroy());
    AppState.chartInstances = [];

    let emptyState = document.getElementById('empty-state');
    if (emptyState && container.contains(emptyState)) {
      container.removeChild(emptyState);
    } else if (!emptyState) {
      emptyState = document.createElement('div');
      emptyState.id = 'empty-state';
      emptyState.className = 'empty-state-container';
      emptyState.innerHTML = `
          <div class="empty-state-content">
            <i class="fas fa-chart-area empty-icon"></i>
            <h3>No Telemetry Loaded</h3>
            <p>Start by scanning your Google Drive or uploading a local JSON trip log.</p>
            <div class="empty-state-actions">
              <button class="btn btn-primary mobile-only-btn" onclick="toggleSidebar()"><i class="fas fa-folder-open"></i> Open Log Source</button>
              <button class="btn" onclick="loadSampleData(false)"><i class="fas fa-vial"></i> Load Sample Trip</button>
            </div>
          </div>
        `;
    }

    container.innerHTML = '';
    container.appendChild(emptyState);

    if (AppState.files.length === 0) {
      this._handleEmptyState();
      return;
    }

    UI.updateDataLoadedState(true);

    if (this.viewMode === 'overlay') {
      this._renderOverlayMode(container);
    } else {
      AppState.files.forEach((file, idx) =>
        this._renderChartCard(container, file, idx)
      );
    }
  },

  _renderOverlayMode(container) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-card-compact';
    wrapper.style.flex = '1';
    wrapper.style.height = '100%';

    const maxDuration = Math.max(...AppState.files.map((f) => f.duration));
    const baseStartTime = AppState.files[0].startTime;
    const shortcuts = this._getShortcutsText();

    wrapper.innerHTML = `
      <div class="chart-header-sm">
          <span class="chart-name">Overlay Comparison (${AppState.files.length} logs)</span>
          <div class="chart-actions" style="display: flex; gap: 4px; align-items: center;">
               <span style="font-size:0.8em; color:#666; margin-right:10px;">X-Axis: Relative Time (s)</span>
               <div style="display: flex; gap: 1px; margin-right: 8px; border: 1px solid #ddd; border-radius: 4px; background: #fff;">
                  <button class="btn-icon" onclick="stepCursor(0, -10)" title="-1s" style="border:none;"><i class="fas fa-backward"></i></button>
                  <button class="btn-icon" onclick="stepCursor(0, -1)" title="-0.1s" style="border:none;"><i class="fas fa-caret-left" style="font-size: 1.2em;"></i></button>
                  <button class="btn-icon" onclick="stepCursor(0, 1)" title="+0.1s" style="border:none;"><i class="fas fa-caret-right" style="font-size: 1.2em;"></i></button>
                  <button class="btn-icon" onclick="stepCursor(0, 10)" title="+1s" style="border:none;"><i class="fas fa-forward"></i></button>
              </div>
               <button class="btn-icon" style="cursor: help;" title="${shortcuts}"><i class="fas fa-keyboard"></i></button>
               <button class="btn-icon" onclick="resetChart(0)" title="Reset Zoom"><i class="fas fa-sync-alt"></i></button>
          </div>
      </div>
      <div class="canvas-wrapper" style="height: calc(100vh - 200px); padding: 5px;">
          <canvas id="chart-overlay" tabindex="0"></canvas>
      </div>
    `;
    container.appendChild(wrapper);

    const canvas = document.getElementById('chart-overlay');
    const ctx = canvas.getContext('2d');
    const datasets = [];

    AppState.files.forEach((file, fileIdx) => {
      file.availableSignals.forEach((key, sigIdx) => {
        const ds = this._buildDataset(file, key, fileIdx, sigIdx);
        ds._fileIdx = fileIdx;
        ds._signalKey = key;
        const fileStart = file.startTime;
        ds.data = ds.data.map((p) => ({
          x: baseStartTime + (p.x - fileStart),
          y: p.y,
        }));
        ds.label = `${file.name.substring(0, 15)}... - ${key}`;
        if (fileIdx > 0) {
          ds.borderDash = [5, 5];
          ds.pointRadius = 0;
        }
        datasets.push(ds);
      });
    });

    const options = this._getChartOptions(AppState.files[0]);
    options.scales.x.min = baseStartTime;
    options.scales.x.max = baseStartTime + maxDuration * 1000;

    const chart = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      plugins: [this.highlighterPlugin],
      options: options,
    });

    AppState.chartInstances.push(chart);
    this.initKeyboardControls(canvas, 0);
  },

  formatDuration(totalSeconds) {
    if (typeof totalSeconds !== 'number' || isNaN(totalSeconds)) return '0s';
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  },

  _renderChartCard(container, file, idx) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-card-compact';

    const dateObj = new Date(file.startTime);
    const dateStr =
      dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString();
    const durationStr = this.formatDuration(file.duration);
    const shortcuts = this._getShortcutsText();

    wrapper.innerHTML = `
      <div class="chart-header-sm" style="display: flex; justify-content: space-between; align-items: center; padding: 4px 10px; background: #f8f9fa; border-bottom: 1px solid #ddd;">
          <div style="display: flex; flex-direction: column; min-width: 0;">
             <span class="chart-name" style="font-weight: bold; font-size: 0.85em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${file.name}</span>
             <span class="chart-meta-info" style="font-size: 0.75em; color: #666;">
                <i class="far fa-clock"></i> ${dateStr} &nbsp;|&nbsp; <i class="fas fa-stopwatch"></i> ${durationStr}
             </span>
          </div>
          <div class="chart-actions" style="display: flex; gap: 4px; align-items: center;">
              <div style="display: flex; gap: 1px; margin-right: 8px; border: 1px solid #ddd; border-radius: 4px; background: #fff;">
                  <button class="btn-icon" onclick="stepCursor(${idx}, -10)" title="-1s" style="border:none;"><i class="fas fa-backward"></i></button>
                  <button class="btn-icon" onclick="stepCursor(${idx}, -1)" title="-0.1s" style="border:none;"><i class="fas fa-caret-left" style="font-size: 1.2em;"></i></button>
                  <button class="btn-icon" onclick="stepCursor(${idx}, 1)" title="+0.1s" style="border:none;"><i class="fas fa-caret-right" style="font-size: 1.2em;"></i></button>
                  <button class="btn-icon" onclick="stepCursor(${idx}, 10)" title="+1s" style="border:none;"><i class="fas fa-forward"></i></button>
              </div>  
              <button class="btn-icon" onclick="exportDataRange(${idx})" title="Export Visible CSV"><i class="fas fa-file-csv"></i></button>
              <button class="btn-icon" style="cursor: help;" title="${shortcuts}"><i class="fas fa-keyboard"></i></button>
              <button class="btn-icon" onclick="showChartInfo(${idx})" title="Log Details"><i class="fas fa-info-circle"></i></button>
              <div style="width: 1px; height: 16px; background: #ddd; margin: 0 4px;"></div>
              <button class="btn-icon" onclick="manualZoom(${idx}, 1.1)" title="Zoom In"><i class="fas fa-plus"></i></button>
              <button class="btn-icon" onclick="manualZoom(${idx}, 0.9)" title="Zoom Out"><i class="fas fa-minus"></i></button>
              <button class="btn-icon" onclick="resetChart(${idx})" title="Reset View"><i class="fas fa-sync-alt"></i></button>
              <button class="btn-remove" onclick="removeChart(${idx})" title="Remove Chart">×</button>
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
    this._updateLocalSliderUI(idx);
  },

  _initLocalSlider(wrapper, idx) {
    const startInput = wrapper.querySelector('.local-range-start');
    const endInput = wrapper.querySelector('.local-range-end');
    if (!startInput) return;

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

  _updateLocalSliderUI(idx) {
    const chart = AppState.chartInstances[idx];
    const file =
      this.viewMode === 'overlay' ? AppState.files[0] : AppState.files[idx];
    if (!chart || !file) return;
    if (this.viewMode === 'overlay') return;

    const card = document
      .getElementById(`chart-${idx}`)
      ?.closest('.chart-card-compact');
    if (!card) return;

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

  resetChart(idx) {
    AppState.activeHighlight = null;
    const chart = AppState.chartInstances[idx];
    const file =
      this.viewMode === 'overlay' ? AppState.files[0] : AppState.files[idx];

    if (file && chart) {
      chart.options.scales.x.min = file.startTime;
      chart.options.scales.x.max =
        file.startTime +
        (this.viewMode === 'overlay'
          ? Math.max(...AppState.files.map((f) => f.duration)) * 1000
          : file.duration * 1000);
      chart.resetZoom();
      chart.update('none');
      if (this.viewMode !== 'overlay') this._updateLocalSliderUI(idx);
    }
  },

  manualZoom(index, zoomLevel) {
    const chart = AppState.chartInstances[index];
    if (!chart) return;
    chart.zoom(zoomLevel);
    if (this.viewMode !== 'overlay') this._updateLocalSliderUI(index);
  },

  reset() {
    AppState.chartInstances.forEach((_, idx) => this.resetChart(idx));
  },

  updateAreaFills() {
    const { showAreaFills } = Preferences.prefs;
    AppState.chartInstances.forEach((chart) => {
      chart.data.datasets.forEach((dataset) => {
        dataset.fill = showAreaFills ? 'origin' : false;
        dataset.backgroundColor = showAreaFills
          ? this.getAlphaColor(dataset.borderColor, 0.1)
          : 'transparent';
      });
      chart.update('none');
    });
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

  removeChart(index) {
    if (this.viewMode === 'overlay') return;
    this.hoverValue = null;
    this.activeChartIndex = null;
    AppState.files.splice(index, 1);
    this.render();
    UI.renderSignalList();
  },

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

  _buildDataset(file, key, fileIdx, sigIdx) {
    const rawData = file.signals[key];
    const yValues = rawData.map((d) => parseFloat(d.y) || 0);

    const min = Math.min(...yValues);
    const max = Math.max(...yValues);
    const range = max - min;

    const normalizedData = rawData.map((d) => {
      let yVal = 0;
      if (range === 0) {
        yVal = max > 0 ? 0.8 : 0;
      } else {
        yVal = (parseFloat(d.y) - min) / range;
      }
      return { x: d.x, y: yVal };
    });

    const color = PaletteManager.getColorForSignal(fileIdx, sigIdx);
    const { showAreaFills } = Preferences.prefs;

    const checkbox = document.querySelector(
      `#signalList input[data-key="${key}"][data-file-idx="${fileIdx}"]`
    );
    let isVisible = false;
    if (checkbox) {
      isVisible = checkbox.checked;
    } else {
      isVisible = DEFAULT_SIGNALS.some((k) => key.includes(k));
    }

    return {
      label: key,
      originalMin: min,
      originalMax: max,
      data: normalizedData,
      borderColor: color,
      borderWidth: isVisible ? 3 : 1.5,
      pointRadius: 0,
      backgroundColor: showAreaFills
        ? this.getAlphaColor(color, 0.1)
        : 'transparent',
      fill: showAreaFills ? 'origin' : false,
      hidden: !isVisible,
    };
  },

  _getChartOptions(file) {
    const isOverlay = this.viewMode === 'overlay';
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,

      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false,
      },

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
          display: (ctx) => this._shouldShowLabels(ctx.chart),
          anchor: 'end',
          align: 'top',
          backgroundColor: (ctx) => ctx.dataset.borderColor,
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
          events: [], 
          mode: 'index',
          position: 'topRightCorner',
          yAlign: 'top',
          xAlign: 'right',
          caretSize: 0,
          intersect: false,
          itemSort: (a, b) => b.parsed.y - a.parsed.y,
          callbacks: {
            title: (items) => {
              if (!items.length) return '';
              const xVal = items[0].parsed.x;
              if (isOverlay) {
                const seconds = (xVal - items[0].chart.scales.x.min) / 1000;
                return `T + ${Math.max(0, seconds).toFixed(2)}s`;
              }
              return new Date(xVal).toISOString().substring(14, 19);
            },
            label: (context) => {
              const ds = context.dataset;
              const realY =
                context.parsed.y * (ds.originalMax - ds.originalMin) +
                ds.originalMin;
              let label = ds.label || '';
              if (label) {
                label += ': ';
              }
              return label + realY.toFixed(2);
            },
          },
        },
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            font: { size: 11 },
            filter: (item, chartData) => {
              if (isOverlay) {
                return !chartData.datasets[item.datasetIndex].hidden;
              }
              const checkbox = document.querySelector(
                `#signalList input[data-key="${item.text}"]`
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
              if (this.viewMode !== 'overlay') this._updateLocalSliderUI(idx);
            },
          },
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: 'x',
            onZoom: ({ chart }) => {
              const idx = AppState.chartInstances.indexOf(chart);
              if (this.viewMode !== 'overlay') this._updateLocalSliderUI(idx);
              this.updateLabelVisibility(chart);
            },
          },
        },
      },
    };
  },

  _attachMouseListeners(canvas, index) {
    canvas.addEventListener('mousemove', (e) => {
      const chart = AppState.chartInstances[index];
      if (!chart) return;

      const newValue = chart.scales.x.getValueForPixel(e.offsetX);
      this.hoverValue = newValue;
      this.activeChartIndex = index;

      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
      }
      this._rafId = requestAnimationFrame(() => {
        chart.draw();
        this._syncTooltip(chart, newValue);
        this._rafId = null;
      });
    });

    canvas.addEventListener('mouseleave', () => {
      const chart = AppState.chartInstances[index];
      if (!chart) return;
      this.hoverValue = null;
      this.activeChartIndex = null;
      requestAnimationFrame(() => chart.draw());
    });

    canvas.addEventListener('dblclick', (e) => {
      const chart = AppState.chartInstances[index];
      const file = AppState.files[index];

      const clickVal = chart.scales.x.getValueForPixel(e.offsetX);
      const relTime = (clickVal - file.startTime) / 1000;

      const text = prompt(`Add annotation at ${relTime.toFixed(1)}s:`, '');
      if (text) {
        if (!file.annotations) file.annotations = [];
        file.annotations.push({
          time: relTime,
          text: text,
        });
        chart.draw();
      }
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
      this.viewMode !== 'overlay' &&
      AppState.chartInstances.length > 0 &&
      AppState.chartInstances.length === AppState.files.length
    );
  },

  _performSmartUpdate() {
    AppState.chartInstances.forEach((chart, fIdx) => {
      chart.data.datasets.forEach((ds, sIdx) => {
        ds.borderColor = PaletteManager.getColorForSignal(fIdx, sIdx);
      });
      chart.update('none');
    });
  },

  _handleEmptyState() {
    UI.updateDataLoadedState(false);
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
        case 'a':
          this._addAnnotationViaKeyboard(index);
          break;
        case 'e':
          this.exportDataRange(index);
          break;
        case 'r':
        case 'R':
          this.resetChart(index);
          return;
        default:
          return;
      }

      if (this.viewMode !== 'overlay') this._updateLocalSliderUI(index);

      this.hoverValue = (chart.scales.x.min + chart.scales.x.max) / 2;
      this.activeChartIndex = index;

      chart.draw();
      this._syncTooltip(chart, this.hoverValue);
    });
  },

  getAlphaColor: (hex, alpha = 0.1) => {
    if (!hex || typeof hex !== 'string') return `rgba(128,128,128, ${alpha})`;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

      const file = AppState.files[chartIdx];

      if (file && AppState.activeHighlight?.targetIndex === chartIdx) {
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

      if (file && file.annotations && file.annotations.length > 0) {
        ctx.save();
        ctx.font = '11px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';

        file.annotations.forEach((note) => {
          const absTime = file.startTime + note.time * 1000;
          if (absTime >= x.min && absTime <= x.max) {
            const xPix = x.getPixelForValue(absTime);
            ctx.beginPath();
            ctx.strokeStyle = '#FFA500';
            ctx.lineWidth = 2;
            ctx.moveTo(xPix, top);
            ctx.lineTo(xPix, bottom);
            ctx.stroke();

            const textWidth = ctx.measureText(note.text).width;
            ctx.fillStyle = 'rgba(255, 165, 0, 0.8)';
            ctx.fillRect(xPix + 2, top + 25, textWidth + 6, 20);
            ctx.fillStyle = 'white';
            ctx.fillText(note.text, xPix + 5, top + 39);
          }
        });
        ctx.restore();
      }

      if (
        ChartManager.activeChartIndex === chartIdx &&
        ChartManager.hoverValue !== null
      ) {
        const xPixel = x.getPixelForValue(ChartManager.hoverValue);
        if (xPixel >= left && xPixel <= right) {
          ctx.save();
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(227, 24, 55, 0.6)';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.moveTo(xPixel, top);
          ctx.lineTo(xPixel, bottom);
          ctx.stroke();
          ctx.restore();
        }
      }
    },
  },
  _getShortcutsText() {
    return `Keyboard Shortcuts:
    \u2190 / \u2192 : Pan Left/Right (Shift for faster)
    + / - : Zoom In / Out
    R : Reset View
    A : Add Annotation (at cursor position)
    E : Export Visible Data (CSV)
    L : Toggle Legend Visibility`;
  },

  _addAnnotationViaKeyboard(index) {
    if (this.hoverValue === null || this.activeChartIndex !== index) {
      alert(
        'Move your mouse over the chart to select a time for the annotation.'
      );
      return;
    }
    const file = AppState.files[index];
    const relTime = (this.hoverValue - file.startTime) / 1000;
    const text = prompt(`Add annotation at ${relTime.toFixed(2)}s:`, '');
    if (text) {
      if (!file.annotations) file.annotations = [];
      file.annotations.push({ time: relTime, text: text });
      AppState.chartInstances[index].draw();
    }
  },
};
