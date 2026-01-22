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
    if (modal) modal.style.display = 'flex';

    const splitView = document.getElementById('xySplitView');
    const timelineView = document.getElementById('xyTimelineView');

    if (splitView && timelineView) {
      splitView.style.flex = '3';
      timelineView.style.flex = '1';
    }

    this.populateGlobalFileSelector();
  },

  closeXYModal() {
    const modal = document.getElementById('xyModal');
    if (modal) modal.style.display = 'none';
  },

  populateGlobalFileSelector() {
    const fileNames = AppState.files.map((f) => f.name);

    this.createSearchableSelect(
      'xyGlobalFile',
      fileNames,
      fileNames[this.currentFileIndex || 0] || '',
      (selectedName) => {
        const idx = AppState.files.findIndex((f) => f.name === selectedName);
        this.currentFileIndex = idx;
        this.onFileChange();
      }
    );

    if (AppState.files.length > 0 && this.currentFileIndex === undefined) {
      this.currentFileIndex = 0;
      this.onFileChange();
    }
  },

  onFileChange() {
    const fileIdx =
      this.currentFileIndex !== undefined ? this.currentFileIndex : 0;
    const file = AppState.files[fileIdx];
    if (!file) return;

    const signals = file.availableSignals.sort();

    ['0', '1'].forEach((panelIdx) => {
      let defX = 'Engine Rpm';
      let defY =
        panelIdx === '0'
          ? 'Intake Manifold Pressure'
          : 'Air Mass Flow Measured';
      let defZ = panelIdx === '0' ? 'Air Mass' : 'Intake Manifold Pressure';

      const matchSignal = (search) =>
        signals.find((s) => s.toLowerCase().includes(search.toLowerCase())) ||
        signals[0];

      this.createSearchableSelect(
        `xyX-${panelIdx}`,
        signals,
        matchSignal(defX),
        () => this.plot(panelIdx)
      );
      this.createSearchableSelect(
        `xyY-${panelIdx}`,
        signals,
        matchSignal(defY),
        () => this.plot(panelIdx)
      );
      this.createSearchableSelect(
        `xyZ-${panelIdx}`,
        signals,
        matchSignal(defZ),
        () => this.plot(panelIdx)
      );
    });

    this.plot('0');
    this.plot('1');
    this.updateTimeline();
  },

  createSearchableSelect(elementId, options, defaultValue, onChangeCallback) {
    let container = document.getElementById(elementId);
    if (!container) return;

    if (container.tagName === 'SELECT') {
      const div = document.createElement('div');
      div.id = elementId;
      div.className = container.className;
      div.style.cssText = container.style.cssText;
      div.classList.add('searchable-select-wrapper');
      container.parentNode.replaceChild(div, container);
      container = div;
    }

    container.innerHTML = '';
    if (!container.classList.contains('searchable-select-wrapper')) {
      container.classList.add('searchable-select-wrapper');
    }
    container.style.marginBottom = '5px';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'searchable-input';
    input.value = defaultValue || '';
    input.placeholder = 'Search...';
    input.setAttribute('data-selected-value', defaultValue || '');

    const list = document.createElement('div');
    list.className = 'search-results-list';

    const renderList = (filter = '') => {
      list.innerHTML = '';
      const lower = filter.toLowerCase();
      const filtered = options.filter((o) => o.toLowerCase().includes(lower));

      if (filtered.length === 0) {
        const noRes = document.createElement('div');
        noRes.className = 'search-option';
        noRes.style.color = '#999';
        noRes.innerText = 'No signals found';
        list.appendChild(noRes);
      } else {
        filtered.forEach((opt) => {
          const item = document.createElement('div');
          item.className = 'search-option';
          item.innerText = opt;
          item.onclick = () => {
            input.value = opt;
            input.setAttribute('data-selected-value', opt);
            list.style.display = 'none';
            if (onChangeCallback) onChangeCallback(opt);
          };
          list.appendChild(item);
        });
      }
    };

    input.onfocus = () => {
      renderList(input.value);
      list.style.display = 'block';
    };

    input.oninput = (e) => {
      renderList(e.target.value);
      list.style.display = 'block';
    };

    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) {
        list.style.display = 'none';
      }
    });

    container.appendChild(input);
    container.appendChild(list);
  },

  getInputValue(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return '';
    if (container.tagName === 'SELECT') return container.value;
    const input = container.querySelector('input');
    return input ? input.value : '';
  },

  plot(panelIdx) {
    const fileIdx =
      this.currentFileIndex !== undefined ? this.currentFileIndex : 0;

    const xSig = this.getInputValue(`xyX-${panelIdx}`);
    const ySig = this.getInputValue(`xyY-${panelIdx}`);
    const zSig = this.getInputValue(`xyZ-${panelIdx}`);

    if (!xSig || !ySig || !zSig) return;

    this.renderChart(panelIdx, fileIdx, xSig, ySig, zSig);
    this.updateTimeline();
  },

  resetAllZooms() {
    this.charts.forEach((c) => c?.resetZoom());
    if (this.timelineChart) this.timelineChart.resetZoom();
  },

  updateTimeline() {
    const fileIdx =
      this.currentFileIndex !== undefined ? this.currentFileIndex : 0;

    const signals = new Set();
    ['0', '1'].forEach((idx) => {
      const x = this.getInputValue(`xyX-${idx}`);
      const y = this.getInputValue(`xyY-${idx}`);
      const z = this.getInputValue(`xyZ-${idx}`);
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

        const color = PaletteManager.getColorForSignal(
          fileIdx,
          file.availableSignals.indexOf(sigName)
        );

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
          const isDark = document.body.classList.contains('pref-theme-dark');
          ctx.strokeStyle = isDark
            ? 'rgba(255, 255, 255, 0.5)'
            : 'rgba(0, 0, 0, 0.5)';
          ctx.stroke();
          ctx.restore();
        }
      },
    };

    const isDark = document.body.classList.contains('pref-theme-dark');
    const textColor = isDark ? '#eee' : '#333';
    const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

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
            grid: { color: gridColor },
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
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

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

    const isDark = document.body.classList.contains('pref-theme-dark');
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
            enabled: false,
            position: 'nearest',
            external: (context) => {
              const { chart, tooltip } = context;
              const tooltipEl = this.getOrCreateTooltip(chart);

              if (tooltip.opacity === 0) {
                tooltipEl.style.opacity = 0;
                return;
              }

              if (tooltip.body) {
                const file = AppState.files[fileIdx];
                const idxX = file.availableSignals.indexOf(signalX);
                const idxY = file.availableSignals.indexOf(signalY);
                const idxZ = file.availableSignals.indexOf(signalZ);

                const colorX = PaletteManager.getColorForSignal(fileIdx, idxX);
                const colorY = PaletteManager.getColorForSignal(fileIdx, idxY);
                const colorZ = PaletteManager.getColorForSignal(fileIdx, idxZ);

                const rawPoint = tooltip.dataPoints[0].raw;

                const tableHead = document.createElement('thead');
                const tableBody = document.createElement('tbody');

                const makeRow = (color, label, value) => {
                  const tr = document.createElement('tr');
                  tr.style.backgroundColor = 'inherit';
                  tr.style.borderWidth = 0;

                  const tdColor = document.createElement('td');
                  tdColor.style.borderWidth = 0;

                  const span = document.createElement('span');
                  span.style.background = color;
                  span.style.borderColor = color;
                  span.style.borderWidth = '2px';
                  span.style.marginRight = '10px';
                  span.style.height = '10px';
                  span.style.width = '10px';
                  span.style.display = 'inline-block';
                  span.style.borderRadius = '50%';

                  tdColor.appendChild(span);

                  const tdText = document.createElement('td');
                  tdText.style.borderWidth = 0;
                  tdText.style.color = '#fff';
                  tdText.innerText = `${label}: ${value.toFixed(2)}`;

                  tr.appendChild(tdColor);
                  tr.appendChild(tdText);
                  return tr;
                };

                tableBody.appendChild(makeRow(colorX, signalX, rawPoint.x));
                tableBody.appendChild(makeRow(colorY, signalY, rawPoint.y));
                tableBody.appendChild(makeRow(colorZ, signalZ, rawPoint.z));

                const tableRoot = tooltipEl.querySelector('table');
                tableRoot.innerHTML = '';
                tableRoot.appendChild(tableHead);
                tableRoot.appendChild(tableBody);
              }

              const { offsetLeft: positionX, offsetTop: positionY } =
                chart.canvas;

              tooltipEl.style.opacity = 1;
              tooltipEl.style.left = positionX + tooltip.caretX + 'px';
              tooltipEl.style.top = positionY + tooltip.caretY + 'px';
              tooltipEl.style.font = tooltip.options.bodyFont.string;
              tooltipEl.style.padding =
                tooltip.options.padding +
                'px ' +
                tooltip.options.padding +
                'px';
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

  getOrCreateTooltip(chart) {
    let tooltipEl = chart.canvas.parentNode.querySelector(
      'div.chartjs-tooltip'
    );

    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'chartjs-tooltip';
      tooltipEl.style.background = 'rgba(0, 0, 0, 0.8)';
      tooltipEl.style.borderRadius = '3px';
      tooltipEl.style.color = 'white';
      tooltipEl.style.opacity = 1;
      tooltipEl.style.pointerEvents = 'none';
      tooltipEl.style.position = 'absolute';
      tooltipEl.style.transform = 'translate(-50%, 0)';
      tooltipEl.style.transition = 'all .1s ease';
      tooltipEl.style.zIndex = 100;

      const table = document.createElement('table');
      table.style.margin = '0px';

      tooltipEl.appendChild(table);
      chart.canvas.parentNode.appendChild(tooltipEl);
    }

    return tooltipEl;
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
