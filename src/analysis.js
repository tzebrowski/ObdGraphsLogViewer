import { Config, AppState, DOM, SIGNAL_MAPPINGS } from './config.js';
import { UI } from './ui.js';
import { ChartManager } from './chartmanager.js';
import { messenger } from './bus.js';

/**
 * Analysis Module
 * Handles anomaly detection, filter management, and result rendering.
 */
export const Analysis = {
  init() {
    this.initTemplates();
    const scanBtn = DOM.get('btnRunScan');
    if (scanBtn) scanBtn.onclick = () => this.runScan();

    messenger.on('dataprocessor:batch-load-completed', (event) => {
      console.error(
        `Analysis: received dataprocessor:batch-load-completed event ${event}`
      );
      Analysis.refreshFilterOptions();
    });
  },

  initTemplates() {
    const sel = DOM.get('anomalyTemplate');
    if (!sel) return;

    const options = Object.keys(Config.ANOMALY_TEMPLATES).map(
      (k) => `<option value="${k}">${Config.ANOMALY_TEMPLATES[k].name}</option>`
    );

    sel.innerHTML =
      '<option value="">-- Load a Template --</option>' + options.join('');

    const filtersContainer = DOM.get('filtersContainer');
    if (filtersContainer) {
      filtersContainer.innerHTML = '';
      this.addFilterRow();
    }
  },

  addFilterRow(sigName = '', operator = '>', value = '', fileIdx = -1) {
    const container = DOM.get('filtersContainer');
    if (!container) return;

    const div = document.createElement('div');
    div.className = 'filter-row';
    div.innerHTML = this._generateFilterRowHTML(
      sigName,
      operator,
      value,
      fileIdx
    );

    const fileSelect = div.querySelector('.file-select');
    const sigSelect = div.querySelector('.sig-select');

    fileSelect.onchange = () => {
      sigSelect.innerHTML =
        '<option value="">Signal...</option>' +
        this._getSignalOptionsHTML(fileSelect.value, sigName);
    };

    div.querySelector('.remove-row').onclick = () => div.remove();
    container.appendChild(div);
  },

  refreshFilterOptions() {
    const rows = document.querySelectorAll('.filter-row');
    const fileOptionsHTML = this._getFileOptionsHTML();

    rows.forEach((row) => {
      const fileSelect = row.querySelector('.file-select');
      const sigSelect = row.querySelector('.sig-select');
      const currentFile = fileSelect.value;
      const currentSig = sigSelect.value;

      fileSelect.innerHTML = fileOptionsHTML;
      fileSelect.value = currentFile;
      fileSelect.dispatchEvent(new Event('change'));
      sigSelect.value = currentSig;
    });
  },

  applyTemplate() {
    const templateSelect = DOM.get('anomalyTemplate');
    if (!templateSelect || !templateSelect.value) return;

    const template = Config.ANOMALY_TEMPLATES[templateSelect.value];
    const container = DOM.get('filtersContainer');
    if (container) container.innerHTML = '';

    const allSignals = [
      ...new Set(AppState.files.flatMap((f) => f.availableSignals)),
    ];

    template.rules.forEach((rule) => {
      const bestSig = this._findBestSignalMatch(rule.sig, allSignals);
      this.addFilterRow(bestSig, rule.op, rule.val);
    });

    setTimeout(() => this.runScan(), 100);
  },

  runScan() {
    UI.resetScannerUI();
    const criteria = this._getCriteriaFromDOM();

    if (criteria.length === 0) {
      const countDiv = DOM.get('scanCount');
      if (countDiv) countDiv.innerText = 'No criteria defined';
      return;
    }

    const aggregatedResults = [];
    AppState.files.forEach((file, fileIdx) => {
      const relevantCriteria = criteria.filter(
        (c) => c.fileIdx === -1 || c.fileIdx === fileIdx
      );
      if (relevantCriteria.length > 0) {
        aggregatedResults.push(
          ...this._scanFileData(file, fileIdx, relevantCriteria)
        );
      }
    });

    this.renderResults(aggregatedResults);
  },

  renderResults(ranges) {
    const resDiv = DOM.get('scanResults');
    const countDiv = DOM.get('scanCount');
    if (!resDiv || !countDiv) return;

    resDiv.innerHTML = '';
    resDiv.style.display = 'block';
    countDiv.innerText = `${ranges.length} events found`;

    ranges.forEach((range, idx) => {
      const file = AppState.files[range.fileIdx];
      const s = (range.start - file.startTime) / 1000;
      const e = (range.end - file.startTime) / 1000;

      const item = document.createElement('div');
      item.className = 'result-item';
      item.innerHTML = `<div><b>${range.fileName}</b></div> Event ${idx + 1}: ${s.toFixed(1)}s - ${e.toFixed(1)}s`;

      item.onclick = () => {
        document
          .querySelectorAll('.result-item')
          .forEach((el) => el.classList.remove('selected'));
        item.classList.add('selected');
        ChartManager.zoomTo(s, e, range.fileIdx);
      };
      resDiv.appendChild(item);
    });
  },

  // --- Private Helpers (Internal Logic) ---

  _getCriteriaFromDOM() {
    return Array.from(document.querySelectorAll('.filter-row'))
      .map((row) => ({
        fileIdx: parseInt(row.querySelector('.file-select').value),
        sig: row.querySelector('.sig-select').value,
        op: row.querySelector('.op').value,
        val: parseFloat(row.querySelector('input').value),
      }))
      .filter((c) => c.sig && !isNaN(c.val));
  },

  _scanFileData(file, fileIdx, criteria) {
    const results = [];
    let state = {},
      inEvent = false,
      startT = 0;

    file.rawData.forEach((p) => {
      state[p.s] = p.v;
      const match = criteria.every(
        (c) =>
          state[c.sig] !== undefined &&
          (c.op === '>' ? state[c.sig] > c.val : state[c.sig] < c.val)
      );

      if (match && !inEvent) {
        inEvent = true;
        startT = p.t;
      } else if (!match && inEvent) {
        inEvent = false;
        results.push({ start: startT, end: p.t, fileName: file.name, fileIdx });
      }
    });
    return results;
  },

  _findBestSignalMatch(targetSig, allSignals) {
    if (allSignals.includes(targetSig)) return targetSig;
    const aliases = (SIGNAL_MAPPINGS[targetSig] || []).map((a) =>
      a.toLowerCase()
    );
    return (
      allSignals.find((s) =>
        aliases.some((alias) => s.toLowerCase().includes(alias))
      ) || ''
    );
  },

  _generateFilterRowHTML(sigName, operator, value, fileIdx) {
    return `
        <select class="file-select">
            ${this._getFileOptionsHTML(fileIdx)} 
        </select>
        <select class="sig-select">
            <option value="">Signal...</option>
            ${this._getSignalOptionsHTML(fileIdx, sigName)}
        </select>
        <select class="op">
            <option value=">" ${operator === '>' ? 'selected' : ''}>&gt;</option>
            <option value="<" ${operator === '<' ? 'selected' : ''}>&lt;</option>
        </select>
        <input type="number" placeholder="Val" style="width: 60px" value="${value}">
        <span class="remove-row" style="cursor:pointer; margin-left:5px;">×</span>
    `;
  },

  _getSignalOptionsHTML(idx, sigName) {
    const targetIdx = parseInt(idx);
    const signals =
      targetIdx === -1
        ? [...new Set(AppState.files.flatMap((f) => f.availableSignals))]
        : AppState.files[targetIdx]?.availableSignals || [];

    return signals
      .sort()
      .map(
        (k) =>
          `<option value="${k}" ${k === sigName ? 'selected' : ''}>${k}</option>`
      )
      .join('');
  },

  _getFileOptionsHTML(selectedIdx) {
    const allFilesOption = `<option value="-1" ${selectedIdx === -1 || selectedIdx === '-1' ? 'selected' : ''}>All Files</option>`;

    const fileOptions = AppState.files
      .map(
        (file, idx) =>
          `<option value="${idx}" ${idx == selectedIdx ? 'selected' : ''}>${file.name}</option>`
      )
      .join('');

    return allFilesOption + fileOptions;
  },
};
