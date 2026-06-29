import { AppState, DOM, VIEW_MODES, EVENTS } from './config.js';
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
import { projectManager } from './projectmanager.js';
import { mapManager } from './mapmanager.js';
import { signalRegistry } from './signalregistry.js';

export const ChartManager = {
  hoverValue: null,
  activeChartIndex: null,
  datalabelsSettings: { timeRange: 5000, visibleDatasets: 5 },
  viewMode: VIEW_MODES.STACK,
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

    window.promptChartTag = (idx) => this._promptForTag(idx);

    messenger.on(EVENTS.BATCH_LOADED, (_event) => {
      ChartManager.render();
    });

    messenger.on('drive:tag-added', (data) => {
      const { fileId, tag } = data;
      AppState.files.forEach((file, index) => {
        if (file.id === fileId || file.name === fileId) {
          if (!file.tags) file.tags = [];
          if (!file.tags.includes(tag)) {
            file.tags.push(tag);
            this._updateChartHeaderTags(index);
          }
        }
      });
    });

    messenger.on(EVENTS.MAP_SELECTED, (data) => {
      const { time, fileIndex } = data;

      this.hoverValue = time;
      this.activeChartIndex = fileIndex;

      if (this.viewMode === VIEW_MODES.OVERLAY) {
        const file = AppState.files[fileIndex];
        const baseStart = AppState.files[0].startTime;
        const relativeTime = baseStart + (time - file.startTime);

        const chart = AppState.chartInstances[0];
        if (chart) {
          this._syncTooltip(chart, relativeTime);
          if (
            relativeTime < chart.scales.x.min ||
            relativeTime > chart.scales.x.max
          ) {
            const range = chart.scales.x.max - chart.scales.x.min;
            chart.options.scales.x.min = relativeTime - range / 2;
            chart.options.scales.x.max = relativeTime + range / 2;
            chart.update('none');
          }
        }
        return;
      }

      const chart = AppState.chartInstances[fileIndex];
      if (chart) {
        this._syncTooltip(chart, time);
        if (time < chart.scales.x.min || time > chart.scales.x.max) {
          const range = chart.scales.x.max - chart.scales.x.min;
          chart.options.scales.x.min = time - range / 2;
          chart.options.scales.x.max = time + range / 2;
          chart.update('none');
        }
      }
    });
  },

  _syncTooltip(chart, timeValue) {
    if (!chart || timeValue === null) return;

    const activeElements = [];
    const xTarget = chart.scales.x.getPixelForValue(timeValue);

    if (this.viewMode === VIEW_MODES.OVERLAY) {
      mapManager.syncOverlayPosition(timeValue);
    } else {
      mapManager.syncPosition(timeValue);
    }

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
      this.viewMode === VIEW_MODES.OVERLAY
        ? AppState.files[0]
        : AppState.files[index];

    if (!chart || !file) return;

    let currentVal = this.hoverValue;
    if (currentVal === null) {
      currentVal = (chart.scales.x.min + chart.scales.x.max) / 2;
    }

    const stepSize = 100;
    let newVal = currentVal + stepCount * stepSize;

    if (this.viewMode === VIEW_MODES.OVERLAY) {
      const maxDuration = Math.max(...AppState.files.map((f) => f.duration));
      const baseStart = AppState.files[0].startTime;
      if (newVal < baseStart) newVal = baseStart;
      if (newVal > baseStart + maxDuration * 1000)
        newVal = baseStart + maxDuration * 1000;
    } else {
      const maxTime = file.startTime + file.duration * 1000;
      if (newVal < file.startTime) newVal = file.startTime;
      if (newVal > maxTime) newVal = maxTime;
    }

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

    if (this.viewMode !== VIEW_MODES.OVERLAY) this._updateLocalSliderUI(index);
  },

  exportDataRange(index) {
    const file = AppState.files[index];
    const chart = AppState.chartInstances[index];
    if (!file || !chart) return;

    const minTime = chart.scales.x.min;
    const maxTime = chart.scales.x.max;

    const visibleSignals = file.availableSignals.filter((sig) => {
      const checkbox = document.querySelector(
        `#signalList input[data-key="${sig}"][data-file-idx="${index}"]`
      );
      return checkbox && checkbox.checked;
    });

    if (visibleSignals.length === 0) {
      alert('No signals visible to export.');
      return;
    }

    const timeSet = new Set();
    const dataBySignal = {};

    visibleSignals.forEach((sigKey) => {
      dataBySignal[sigKey] = file.signals[sigKey].filter(
        (p) => p.x >= minTime && p.x <= maxTime
      );
      dataBySignal[sigKey].forEach((p) => timeSet.add(p.x));
    });

    if (timeSet.size === 0) {
      alert('Brak danych w zaznaczonym przedziale czasu.');
      return;
    }

    const sortedTimes = Array.from(timeSet).sort((a, b) => a - b);
    const csvRows = [];
    csvRows.push('Time (s),' + visibleSignals.join(','));

    const currentIndices = {};
    visibleSignals.forEach((sig) => {
      currentIndices[sig] = 0;
    });

    sortedTimes.forEach((time) => {
      const relTime = (time - file.startTime) / 1000;
      const row = [relTime.toFixed(3)];

      visibleSignals.forEach((sigKey) => {
        const sigData = dataBySignal[sigKey];

        if (sigData.length === 0) {
          row.push('');
          return;
        }

        let idx = currentIndices[sigKey];

        while (idx < sigData.length - 1 && sigData[idx].x < time) {
          idx++;
        }
        currentIndices[sigKey] = idx;

        let interpolatedValue;

        if (sigData[idx].x === time) {
          interpolatedValue = parseFloat(sigData[idx].y);
        } else if (time <= sigData[0].x) {
          interpolatedValue = parseFloat(sigData[0].y);
        } else if (time >= sigData[sigData.length - 1].x) {
          interpolatedValue = parseFloat(sigData[sigData.length - 1].y);
        } else {
          const p0 = sigData[idx - 1];
          const p1 = sigData[idx];

          const timeRange = p1.x - p0.x;
          const valueRange = parseFloat(p1.y) - parseFloat(p0.y);
          const fraction = (time - p0.x) / timeRange;

          interpolatedValue = parseFloat(p0.y) + valueRange * fraction;
        }

        row.push(interpolatedValue.toFixed(3));
      });

      csvRows.push(row.join(','));
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `${file.name}_export_${Math.round(minTime)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  showChartInfo(index) {
    const file = AppState.files[index];
    if (!file) return;

    const existing = document.getElementById('metadataModal');
    if (existing) existing.remove();

    const createRow = (label, value) => `
        <div class="chm-meta-row">
            <strong class="chm-meta-label">${label}</strong>
            <span class="chm-meta-value">${value || 'N/A'}</span>
        </div>`;

    const meta = file.metadata || {};
    const durationFormatted = this.formatDuration(file.duration);

    let totalRealSamples = 0;
    let realSignalCount = 0;

    if (file.signals) {
      Object.keys(file.signals).forEach((key) => {
        if (!key.startsWith('Math:')) {
          totalRealSamples += file.signals[key].length;
          realSignalCount++;
        }
      });
    }

    let collectionRateString = 'N/A';
    if (file.duration > 0 && totalRealSamples > 0) {
      const totalHz = totalRealSamples / file.duration;
      const perSignalHz = totalHz / realSignalCount;
      collectionRateString = `${totalHz.toFixed(1)} req/sec (~${perSignalHz.toFixed(1)} Hz per signal)`;
    }

    let dynamicMetaRows = '';
    if (Object.keys(meta).length > 0) {
      const ignoredKeys = [
        'duration',
        'trip.duration',
        'starttime',
        'trip.starttime',
      ];
      let addedRows = 0;

      Object.entries(meta).forEach(([key, value]) => {
        if (ignoredKeys.includes(key.toLowerCase())) return;

        const label = key
          .replace('trip.', '')
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, (str) => str.toUpperCase());

        let displayValue = value;

        if (typeof value === 'object' && value !== null) {
          if (value.min !== undefined && value.max !== undefined) {
            const unitStr =
              value.unit && value.unit !== 'Math' ? ` [${value.unit}]` : '';
            displayValue = `Min: ${value.min.toFixed(2)}, Max: ${value.max.toFixed(2)}${unitStr}`;
          } else {
            displayValue = JSON.stringify(value)
              .replace(/["{}]/g, '')
              .replace(/:/g, ': ');
          }
        } else if (
          key.toLowerCase().includes('time') &&
          !isNaN(value) &&
          value > 1000000000
        ) {
          displayValue = new Date(parseInt(value)).toLocaleString();
        }

        dynamicMetaRows += createRow(label, displayValue);
        addedRows++;
      });

      if (addedRows > 0) {
        dynamicMetaRows =
          `<h5 class="chm-meta-header" style="margin-top:20px; margin-bottom:10px; color:#1c3d72; border-bottom:1px solid #eee; padding-bottom:5px;">Extended Metadata</h5>` +
          dynamicMetaRows;
      }
    }

    const modalHtml = `
      <div id="metadataModal" class="modal-overlay chm-modal-overlay">
        <div class="modal-content chm-modal-content">
          <div class="modal-header">
            <h2>Log Details</h2>
            <button class="btn-close" onclick="document.getElementById('metadataModal').remove()">×</button>
          </div>
          <div class="modal-body">
            <h4 class="chm-modal-title chm-truncate" title="${file.name}" style="margin-bottom: 20px;">${file.name}</h4>
            
            ${createRow('Start Time', new Date(file.startTime).toLocaleString())}
            ${createRow('Duration', durationFormatted)}
            ${createRow('Signals Count', file.availableSignals.length)}
            ${createRow('Collection Rate', collectionRateString)}
            
            ${dynamicMetaRows}
            
            <div class="chm-modal-footer">
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

    mapManager.clearAllMaps();

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

    if (this.hoverValue === null && AppState.files[0]) {
      this.hoverValue = AppState.files[0].startTime;
    }

    if (this.viewMode === VIEW_MODES.OVERLAY) {
      this._renderOverlayMode(container);

      AppState.files.forEach((file, idx) => {
        messenger.emit('chart:request-tags', {
          fileName: file.name,
          index: idx,
        });
      });
    } else {
      AppState.files.forEach((file, idx) => {
        this._renderChartCard(container, file, idx);
        mapManager.loadRoute(idx);

        messenger.emit('chart:request-tags', {
          fileName: file.name,
          index: idx,
        });
      });
    }
  },

  _renderOverlayMode(container) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-card-compact chm-overlay-wrapper';

    const maxDuration = Math.max(...AppState.files.map((f) => f.duration));
    const baseStartTime = AppState.files[0].startTime;
    const shortcuts = this._getShortcutsText();

    wrapper.innerHTML = `
      <div class="chart-header-sm">
          <span class="chart-name">Overlay Comparison (${AppState.files.length} logs)</span>
          <div class="chart-actions chm-flex-center">
               <span class="chm-axis-label">X-Axis: Relative Time (s)</span>
               <div class="chm-step-controls">
                  <button class="btn-icon chm-border-none" onclick="stepCursor(0, -10)" title="-1s"><i class="fas fa-backward"></i></button>
                  <button class="btn-icon chm-border-none" onclick="stepCursor(0, -1)" title="-0.1s"><i class="fas fa-caret-left chm-caret"></i></button>
                  <button class="btn-icon chm-border-none" onclick="stepCursor(0, 1)" title="+0.1s"><i class="fas fa-caret-right chm-caret"></i></button>
                  <button class="btn-icon chm-border-none" onclick="stepCursor(0, 10)" title="+1s"><i class="fas fa-forward"></i></button>
              </div>
               <button class="btn-icon chm-cursor-help" title="${shortcuts}"><i class="fas fa-keyboard"></i></button>
               <button class="btn-icon" onclick="resetChart(0)" title="Reset Zoom"><i class="fas fa-sync-alt"></i></button>
          </div>
      </div>
      <div class="chm-overlay-body">
          <div class="canvas-wrapper chm-overlay-canvas-wrapper">
              <canvas id="chart-overlay" tabindex="0"></canvas>
          </div>
          <div id="overlay-map-container" class="chm-overlay-map"></div>
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
    this._attachMouseListeners(canvas, 0);

    mapManager.loadOverlayMap();
  },

  formatDuration(totalSeconds) {
    if (typeof totalSeconds !== 'number' || isNaN(totalSeconds)) return '0s';
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  },

  _getTagStyle(tag) {
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
      hash = tag.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `background: hsla(${hue}, 70%, 50%, 0.15); color: var(--text-color); border: 1px solid hsla(${hue}, 70%, 50%, 0.3);`;
  },

  _generateTagsHtml(file) {
    if (!file.tags || file.tags.length === 0) return '';
    return file.tags
      .map(
        (t) =>
          `<span style="${this._getTagStyle(t)} padding: 1px 6px; border-radius: 10px; font-size: 0.65em; text-transform: capitalize;">${t}</span>`
      )
      .join('');
  },

  _updateChartHeaderTags(index) {
    const container = document.getElementById(`chart-tags-${index}`);
    const file = AppState.files[index];
    if (container && file) {
      container.innerHTML = this._generateTagsHtml(file);
    }
  },

  _promptForTag(index) {
    const file = AppState.files[index];
    if (!file) return;

    const newTag = prompt(
      `Enter a new tag for ${file.name}\n(e.g., Track, Commute, Rain):`
    );
    if (!newTag || !newTag.trim()) return;

    const tagClean = newTag.trim().toLowerCase();
    if (!file.tags) file.tags = [];

    if (file.tags.includes(tagClean)) {
      alert('This tag is already applied to this log.');
      return;
    }

    file.tags.push(tagClean);
    this._updateChartHeaderTags(index);

    messenger.emit('file:tag-added', {
      fileId: file.id || file.name,
      tag: tagClean,
      index,
    });
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
      <div class="chart-header-sm chm-card-header">
          <div class="chm-flex-column chm-min-width-0">
             <span class="chart-name chm-bold-text chm-truncate">${file.name}</span>
             <span class="chart-meta-info chm-meta-text">
                <i class="far fa-clock"></i> ${dateStr} &nbsp;|&nbsp; <i class="fas fa-stopwatch"></i> ${durationStr}
             </span>
             <div id="chart-tags-${idx}" style="margin-top: 4px; display: flex; gap: 4px; flex-wrap: wrap;">
                ${this._generateTagsHtml(file)}
             </div>
          </div>
          <div class="chart-actions chm-flex-center">
              <div class="chm-step-controls">
                  <button class="btn-icon chm-border-none" onclick="stepCursor(${idx}, -10)" title="-1s"><i class="fas fa-backward"></i></button>
                  <button class="btn-icon chm-border-none" onclick="stepCursor(${idx}, -1)" title="-0.1s"><i class="fas fa-caret-left chm-caret"></i></button>
                  <button class="btn-icon chm-border-none" onclick="stepCursor(${idx}, 1)" title="+0.1s"><i class="fas fa-caret-right chm-caret"></i></button>
                  <button class="btn-icon chm-border-none" onclick="stepCursor(${idx}, 10)" title="+1s"><i class="fas fa-forward"></i></button>
              </div>  
              <button class="btn-icon" onclick="exportDataRange(${idx})" title="Export Visible CSV"><i class="fas fa-file-csv"></i></button>
              <button class="btn-icon" onclick="promptChartTag(${idx})" title="Add Tag (Shortcut: T)"><i class="fas fa-tags"></i></button>
              <button class="btn-icon chm-cursor-help" title="${shortcuts}"><i class="fas fa-keyboard"></i></button>
              <button class="btn-icon" onclick="showChartInfo(${idx})" title="Log Details"><i class="fas fa-info-circle"></i></button>
              <div class="chm-vertical-divider"></div>
              <button class="btn-icon" onclick="manualZoom(${idx}, 1.1)" title="Zoom In"><i class="fas fa-plus"></i></button>
              <button class="btn-icon" onclick="manualZoom(${idx}, 0.9)" title="Zoom Out"><i class="fas fa-minus"></i></button>
              <button class="btn-icon" onclick="resetChart(${idx})" title="Reset View"><i class="fas fa-sync-alt"></i></button>
              <button class="btn-remove" onclick="removeChart(${idx})" title="Remove Chart">×</button>
          </div>
      </div>
      
      <div class="local-slider-ui chm-slider-container">
          <div class="chm-slider-relative-box">
              <input type="range" class="local-range-start chm-range-input" data-index="${idx}" min="0" max="${file.duration}" step="0.1" value="0">
              <input type="range" class="local-range-end chm-range-input" data-index="${idx}" min="0" max="${file.duration}" step="0.1" value="${file.duration}">
              <div class="local-slider-track chm-slider-track-bg"></div>
              <div id="highlight-${idx}" class="local-slider-selection chm-slider-highlight"></div>
          </div>
          <div class="chm-slider-labels">
              <span id="txt-start-${idx}">0.0s</span>
              <span id="txt-end-${idx}">${file.duration.toFixed(1)}s</span>
          </div>
      </div>

      <div class="chart-body-row">
          <div class="chart-canvas-container">
              <canvas id="chart-${idx}" tabindex="0"></canvas>
          </div>
          <div id="embedded-map-${idx}" class="embedded-map-container"></div>
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
      this.viewMode === VIEW_MODES.OVERLAY
        ? AppState.files[0]
        : AppState.files[idx];
    if (!chart || !file) return;
    if (this.viewMode === VIEW_MODES.OVERLAY) return;

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

  _centerCursorOnView(chart) {
    if (!chart) return;
    const mid = (chart.scales.x.min + chart.scales.x.max) / 2;
    this.hoverValue = mid;
    this.activeChartIndex = AppState.chartInstances.indexOf(chart);
    this._syncTooltip(chart, mid);
  },

  resetChart(idx) {
    AppState.activeHighlight = null;
    const chart = AppState.chartInstances[idx];
    const file =
      this.viewMode === VIEW_MODES.OVERLAY
        ? AppState.files[0]
        : AppState.files[idx];

    if (file && chart) {
      const min = file.startTime;
      const max =
        file.startTime +
        (this.viewMode === VIEW_MODES.OVERLAY
          ? Math.max(...AppState.files.map((f) => f.duration)) * 1000
          : file.duration * 1000);

      chart.options.scales.x.min = min;
      chart.options.scales.x.max = max;

      chart.resetZoom();
      chart.update('none');

      if (this.viewMode !== VIEW_MODES.OVERLAY) this._updateLocalSliderUI(idx);

      mapManager.syncMapBounds(
        min,
        max,
        this.viewMode === VIEW_MODES.OVERLAY ? null : idx
      );

      this._centerCursorOnView(chart);
    }
  },

  manualZoom(index, zoomLevel) {
    const chart = AppState.chartInstances[index];
    if (!chart) return;

    chart.zoom(zoomLevel);

    const min = chart.scales.x.min;
    const max = chart.scales.x.max;

    if (this.viewMode !== VIEW_MODES.OVERLAY) this._updateLocalSliderUI(index);

    mapManager.syncMapBounds(
      min,
      max,
      this.viewMode === VIEW_MODES.OVERLAY ? null : index
    );

    this._centerCursorOnView(chart);
  },

  reset() {
    AppState.chartInstances.forEach((_, idx) => this.resetChart(idx));
  },

  updateSmoothing() {
    const { smoothLines } = Preferences.prefs;

    AppState.chartInstances.forEach((chart) => {
      chart.data.datasets.forEach((dataset) => {
        dataset.tension = smoothLines ? 0.8 : 0;
        dataset.cubicInterpolationMode = smoothLines ? 'monotone' : 'default';
      });
      chart.update('none');
    });
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
    if (this.viewMode === VIEW_MODES.OVERLAY) return;

    projectManager.onFileRemoved(index);

    this.hoverValue = null;
    this.activeChartIndex = null;
    AppState.files.splice(index, 1);

    messenger.emit(EVENTS.FILE_REMOVED, { index });

    this.render();
    UI.renderSignalList();
    UI.renderProjectHistory();
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
    const { showAreaFills, smoothLines } = Preferences.prefs;

    const checkbox = document.querySelector(
      `#signalList input[data-key="${key}"][data-file-idx="${fileIdx}"]`
    );

    let isVisible = false;
    if (checkbox) {
      isVisible = checkbox.checked;
    } else {
      isVisible = signalRegistry.isDefaultSignal(key);
    }

    return {
      label: key,
      originalMin: min,
      originalMax: max,
      data: normalizedData,
      borderColor: color,
      borderWidth: isVisible ? 3 : 1.5,
      pointRadius: 0,
      tension: smoothLines ? 0.4 : 0,
      cubicInterpolationMode: smoothLines ? 'monotone' : 'default',
      backgroundColor: showAreaFills
        ? this.getAlphaColor(color, 0.1)
        : 'transparent',
      fill: showAreaFills ? 'origin' : false,
      hidden: !isVisible,
    };
  },

  _getChartOptions(file) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false,
      },
      scales: this._getScalesConfig(file),
      plugins: this._getPluginsConfig(),
    };
  },

  _getScalesConfig(file) {
    return {
      y: { beginAtZero: true, max: 1.2, ticks: { display: false } },
      x: {
        type: 'linear',
        title: {
          display: true,
          text: 'Trip Duration (mm:ss)',
        },
        ticks: {
          callback: function (value) {
            const date = new Date(value);
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            const seconds = date.getSeconds().toString().padStart(2, '0');

            return `${month}-${day} ${hours}:${minutes}:${seconds}`;
          },
        },
      },
    };
  },

  _getPluginsConfig() {
    return {
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
        itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
        callbacks: {
          title: (items) => {
            if (!items.length) return '';
            const xVal = items[0].parsed.x;

            if (this.viewMode === VIEW_MODES.OVERLAY) {
              const seconds = (xVal - AppState.files[0].startTime) / 1000;
              return `T + ${Math.max(0, seconds).toFixed(2)}s`;
            }

            const date = new Date(xVal);
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            const seconds = date.getSeconds().toString().padStart(2, '0');
            const ms = date.getMilliseconds().toString().padStart(3, '0');

            return `${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
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
            if (this.viewMode === VIEW_MODES.OVERLAY) {
              return !chartData.datasets[item.datasetIndex].hidden;
            }
            const checkbox = document.querySelector(
              `#signalList input[data-key="${item.text}"]`
            );
            return checkbox ? checkbox.checked : false;
          },
        },
      },
      zoom: this._getZoomPluginConfig(),
    };
  },

  _getZoomPluginConfig() {
    const isOverlay = this.viewMode === VIEW_MODES.OVERLAY;
    return {
      pan: {
        enabled: true,
        mode: 'x',
        onPanStart: (ctx) => {
          const e = ctx.event;
          if (e && (e.shiftKey || (e.srcEvent && e.srcEvent.shiftKey))) {
            return false;
          }
        },
        onPan: ({ chart }) => {
          const idx = AppState.chartInstances.indexOf(chart);
          if (!isOverlay) this._updateLocalSliderUI(idx);
        },
        onPanComplete: ({ chart }) => {
          const idx = AppState.chartInstances.indexOf(chart);
          if (!isOverlay) this._updateLocalSliderUI(idx);
          mapManager.syncMapBounds(
            chart.scales.x.min,
            chart.scales.x.max,
            isOverlay ? null : idx
          );
          this._centerCursorOnView(chart);
        },
      },
      zoom: {
        wheel: { enabled: true },
        pinch: { enabled: true },
        mode: 'x',
        onZoomStart: (ctx) => {
          const e = ctx.event;
          if (e && (e.shiftKey || (e.srcEvent && e.srcEvent.shiftKey))) {
            return false;
          }
        },
        onZoom: ({ chart }) => {
          const idx = AppState.chartInstances.indexOf(chart);
          if (!isOverlay) this._updateLocalSliderUI(idx);
          this.updateLabelVisibility(chart);
        },
        onZoomComplete: ({ chart }) => {
          const idx = AppState.chartInstances.indexOf(chart);
          if (!isOverlay) this._updateLocalSliderUI(idx);
          mapManager.syncMapBounds(
            chart.scales.x.min,
            chart.scales.x.max,
            isOverlay ? null : idx
          );
          this._centerCursorOnView(chart);
        },
      },
    };
  },

  _attachMouseListeners(canvas, index) {
    let isSelecting = false;
    let selectionStartMs = null;
    let hasDragged = false;

    canvas.addEventListener('pointerdown', (e) => {
      if (e.shiftKey) {
        e.preventDefault();
        const chart = AppState.chartInstances[index];
        if (!chart) return;
        isSelecting = true;
        hasDragged = false;
        selectionStartMs = chart.scales.x.getValueForPixel(e.offsetX);
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      const chart = AppState.chartInstances[index];
      if (!chart) return;
      const newValue = chart.scales.x.getValueForPixel(e.offsetX);

      if (isSelecting) {
        hasDragged = true;
        const file = AppState.files[index];
        AppState.activeHighlight = {
          start: (Math.min(selectionStartMs, newValue) - file.startTime) / 1000,
          end: (Math.max(selectionStartMs, newValue) - file.startTime) / 1000,
          targetIndex: index,
        };

        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._rafId = requestAnimationFrame(() => {
          chart.draw();
          this._rafId = null;
        });
      } else {
        this.hoverValue = newValue;
        this.activeChartIndex = index;

        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._rafId = requestAnimationFrame(() => {
          chart.draw();
          this._syncTooltip(chart, newValue);
          this._rafId = null;
        });
      }
    });

    canvas.addEventListener('pointerup', (e) => {
      if (isSelecting) {
        isSelecting = false;

        if (!hasDragged) {
          AppState.activeHighlight = null;
          return;
        }

        const chart = AppState.chartInstances[index];
        const file = AppState.files[index];
        const selectionEndMs = chart.scales.x.getValueForPixel(e.offsetX);

        const startRel =
          (Math.min(selectionStartMs, selectionEndMs) - file.startTime) / 1000;
        const endRel =
          (Math.max(selectionStartMs, selectionEndMs) - file.startTime) / 1000;

        AppState.activeHighlight = null;

        if (endRel - startRel > 0.05) {
          let statsObj = {};
          const startAbs = file.startTime + startRel * 1000;
          const endAbs = file.startTime + endRel * 1000;
          let statsHtml = '';

          chart.data.datasets.forEach((ds) => {
            if (!ds.hidden) {
              const sigName = ds.label;
              const dataPoints = file.signals[sigName]?.filter(
                (p) => p.x >= startAbs && p.x <= endAbs
              );
              if (dataPoints && dataPoints.length > 0) {
                const vals = dataPoints.map((p) => parseFloat(p.y));
                const min = Math.min(...vals);
                const max = Math.max(...vals);
                statsHtml += `<li><b>${sigName}:</b> Min: ${min.toFixed(2)}, Max: ${max.toFixed(2)}</li>`;
                statsObj[sigName] = { min, max };
              }
            }
          });

          const modalId = 'customAnomalyModal';
          const existing = document.getElementById(modalId);
          if (existing) existing.remove();

          const durationStr = (endRel - startRel).toFixed(2);

          const modalHtml = `
            <div id="${modalId}" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); display:flex; justify-content:center; align-items:center; z-index:9999;">
              <div style="background:var(--card-bg, #fff); color:var(--text-color, #333); padding:20px; border-radius:8px; width:450px; max-width:90%; box-shadow:0 4px 20px rgba(0,0,0,0.3); font-family:sans-serif;">
                <h3 style="margin-top:0; border-bottom:1px solid #ddd; padding-bottom:10px;">Save Highlighted Area</h3>
                <p style="font-size:0.9em; margin-bottom:15px;">Time: <b>${startRel.toFixed(2)}s - ${endRel.toFixed(2)}s</b> (Duration: ${durationStr}s)</p>
                
                <div style="font-size: 0.85em; background: rgba(0,0,0,0.05); padding: 8px; border-radius: 4px; margin-bottom: 15px; max-height: 120px; overflow-y: auto;">
                   <p style="margin: 0 0 5px 0;"><b>Calculated Context (visible data):</b></p>
                   <ul style="margin: 0; padding-left: 20px;">${statsHtml || '<li>No visible data in this range</li>'}</ul>
                </div>

                <input type="text" id="anoTitle" placeholder="Area title (e.g. Voltage drop)" style="width:100%; margin-bottom:10px; padding:8px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;" />
                <textarea id="anoDesc" placeholder="Additional description..." style="width:100%; height:60px; padding:8px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box; resize:vertical;"></textarea>
                
                <div style="margin-top: 15px; display: flex; justify-content: flex-end; gap: 10px;">
                   <button id="btnAnoCancel" style="padding:8px 15px; border:none; background:#ccc; color:#333; border-radius:4px; cursor:pointer;">Cancel</button>
                   <button id="btnAnoSave" style="padding:8px 15px; border:none; background:#007bff; color:#fff; border-radius:4px; cursor:pointer;">Save Highlight</button>
                </div>
              </div>
            </div>
          `;

          document.body.insertAdjacentHTML('beforeend', modalHtml);

          document.getElementById('btnAnoCancel').onclick = () => {
            document.getElementById(modalId).remove();
            chart.draw();
          };

          document.getElementById('btnAnoSave').onclick = () => {
            const title =
              document.getElementById('anoTitle').value || 'Highlighted Area';
            const desc = document.getElementById('anoDesc').value;

            if (!file.highlights) file.highlights = [];
            file.highlights.push({
              start: startRel,
              end: endRel,
              label: title,
              description: desc,
              color: 'rgba(255, 165, 0, 0.15)',
            });

            document.getElementById(modalId).remove();
            chart.draw();
          };
        }

        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._rafId = requestAnimationFrame(() => {
          chart.draw();
          this._rafId = null;
        });
      }
    });

    canvas.addEventListener('pointerleave', () => {
      if (isSelecting) {
        isSelecting = false;
        hasDragged = false;
        AppState.activeHighlight = null;
        const chart = AppState.chartInstances[index];
        if (chart) {
          if (this._rafId) cancelAnimationFrame(this._rafId);
          this._rafId = requestAnimationFrame(() => {
            chart.draw();
            this._rafId = null;
          });
        }
      }
    });

    canvas.addEventListener('click', (e) => {
      if (e.shiftKey && !e.altKey && !hasDragged) {
        this._promptForTag(index);
        return;
      }

      if (e.altKey) {
        const chart = AppState.chartInstances[index];
        const file = AppState.files[index];

        const clickVal = chart.scales.x.getValueForPixel(e.offsetX);
        const relTime = (clickVal - file.startTime) / 1000;

        if (file.annotations && file.annotations.length > 0) {
          const clickX = e.offsetX;
          let clickedNoteIdx = -1;

          for (let i = 0; i < file.annotations.length; i++) {
            const note = file.annotations[i];
            const noteAbsTime = file.startTime + note.time * 1000;
            const notePix = chart.scales.x.getPixelForValue(noteAbsTime);
            if (Math.abs(clickX - notePix) < 15) {
              clickedNoteIdx = i;
              break;
            }
          }

          if (clickedNoteIdx !== -1) {
            if (confirm('Delete this point annotation?')) {
              file.annotations.splice(clickedNoteIdx, 1);
              chart.draw();
            }
            return;
          }
        }

        if (file.highlights && file.highlights.length > 0) {
          const clickedHlIdx = file.highlights.findIndex(
            (hl) => relTime >= hl.start && relTime <= hl.end
          );

          if (clickedHlIdx !== -1) {
            if (confirm('Delete this highlighted area?')) {
              file.highlights.splice(clickedHlIdx, 1);
              chart.draw();
            }
            return;
          }
        }

        const text = prompt(
          `Add point annotation (Alt+Click) at ${relTime.toFixed(2)}s:`,
          ''
        );
        if (text) {
          if (!file.annotations) file.annotations = [];
          file.annotations.push({
            time: relTime,
            text: text,
          });
          chart.draw();
        }
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
      this.viewMode !== VIEW_MODES.OVERLAY &&
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
        case 'A':
          this._addAnnotationViaKeyboard(index);
          break;
        case 't':
        case 'T':
          this._promptForTag(index);
          break;
        case 'e':
        case 'E':
          this.exportDataRange(index);
          break;
        case 'r':
        case 'R':
          this.resetChart(index);
          return;
        default:
          return;
      }

      if (this.viewMode !== VIEW_MODES.OVERLAY)
        this._updateLocalSliderUI(index);

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

      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, right - left, bottom - top);
      ctx.clip();

      if (file && AppState.activeHighlight?.targetIndex === chartIdx) {
        const pxStart = x.getPixelForValue(
          file.startTime + AppState.activeHighlight.start * 1000
        );
        const pxEnd = x.getPixelForValue(
          file.startTime + AppState.activeHighlight.end * 1000
        );
        if (!isNaN(pxStart) && !isNaN(pxEnd)) {
          ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
          ctx.fillRect(pxStart, top, pxEnd - pxStart, bottom - top);
        }
      }

      if (file && file.highlights && file.highlights.length > 0) {
        file.highlights.forEach((hl) => {
          const pxStart = x.getPixelForValue(file.startTime + hl.start * 1000);
          const pxEnd = x.getPixelForValue(file.startTime + hl.end * 1000);

          if (!isNaN(pxStart) && !isNaN(pxEnd)) {
            ctx.fillStyle = hl.color || 'rgba(255, 165, 0, 0.15)';
            ctx.fillRect(pxStart, top, pxEnd - pxStart, bottom - top);

            let statsObj = {};
            const startAbs = file.startTime + hl.start * 1000;
            const endAbs = file.startTime + hl.end * 1000;

            chart.data.datasets.forEach((ds) => {
              if (!ds.hidden) {
                const sigName = ds.label;
                const dataPoints = file.signals[sigName]?.filter(
                  (p) => p.x >= startAbs && p.x <= endAbs
                );
                if (dataPoints && dataPoints.length > 0) {
                  const vals = dataPoints.map((p) => parseFloat(p.y));
                  const min = Math.min(...vals);
                  const max = Math.max(...vals);
                  statsObj[sigName] = { min, max };
                }
              }
            });

            let texts = [];
            const displayLabel = hl.label || 'Highlighted Area';
            texts.push({ text: displayLabel, font: 'bold 11px Arial' });

            const duration = (hl.end - hl.start).toFixed(2);
            texts.push({
              text: `Duration: ${duration}s`,
              font: 'italic 10px Arial',
            });

            if (hl.description)
              texts.push({ text: hl.description, font: 'italic 10px Arial' });

            if (Object.keys(statsObj).length > 0) {
              for (const [sig, vals] of Object.entries(statsObj)) {
                texts.push({
                  text: `${sig}: min ${vals.min.toFixed(1)}, max ${vals.max.toFixed(1)}`,
                  font: '10px Arial',
                });
              }
            } else {
              texts.push({
                text: `No visible data in this range`,
                font: '10px Arial',
              });
            }

            if (texts.length > 0) {
              const padding = 5;
              const lineHeight = 14;
              const boxHeight = texts.length * lineHeight + padding * 2;
              let maxWidth = 0;

              texts.forEach((t) => {
                ctx.font = t.font;
                const w = ctx.measureText(t.text).width;
                if (w > maxWidth) maxWidth = w;
              });

              ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
              ctx.fillRect(
                pxStart + 5,
                top + 5,
                maxWidth + padding * 2,
                boxHeight
              );

              ctx.fillStyle = 'white';
              let currentY = top + 5 + padding + 9;
              texts.forEach((t) => {
                ctx.font = t.font;
                ctx.fillText(t.text, pxStart + 5 + padding, currentY);
                currentY += lineHeight;
              });
            }
          }
        });
      }
      ctx.restore();

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

      if (ChartManager.hoverValue !== null) {
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
    A : KEYBOARD: Add point annotation at cursor
    T : Add Tag to file
    E : Export Visible Data (CSV)
    L : Toggle Legend Visibility
    Shift + Drag : Highlight Area
    Shift + Click: Add Tag to file
    Alt + Click : Add / Delete Annotation or Highlight`;
  },

  _addAnnotationViaKeyboard(index) {
    if (this.hoverValue === null || this.activeChartIndex !== index) {
      alert('Hover over the chart to add an annotation.');
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
