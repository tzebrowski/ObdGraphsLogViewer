import { Config, AppState, DOM, SIGNAL_MAPPINGS } from './config.js';
import { UI } from './ui.js';
import { Sliders } from './chartmanager.js';

export const Analysis = {
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

  init: () => {
    Analysis.initTemplates();
    const scanBtn = DOM.get('btnRunScan');
    if (scanBtn) scanBtn.onclick = () => Analysis.runScan();
  },

  addFilterRow(sigName = '', operator = '>', value = '') {
    const container = DOM.get('filtersContainer');
    if (!container) return;

    const div = document.createElement('div');
    div.className = 'filter-row';

    // Aggregate unique signals from all loaded files
    const allAvailableSignals = [
      ...new Set(AppState.files.flatMap((f) => f.availableSignals)),
    ].sort();

    const options = allAvailableSignals
      .map(
        (k) =>
          `<option value="${k}" ${k === sigName ? 'selected' : ''}>${k}</option>`
      )
      .join('');

    div.innerHTML = `
          <select class="sig-select"><option value="">Signal...</option>${options}</select>
          <select class="op">
              <option value=">" ${operator === '>' ? 'selected' : ''}>&gt;</option>
              <option value="<" ${operator === '<' ? 'selected' : ''}>&lt;</option>
          </select>
          <input type="number" placeholder="Val" value="${value}">
          <span class="remove-row" style="cursor:pointer; margin-left:5px;">×</span>
      `;

    div.querySelector('.remove-row').onclick = () => div.remove();
    container.appendChild(div);
  },

  applyTemplate() {
    const templateSelect = DOM.get('anomalyTemplate');
    if (!templateSelect) return;

    const key = templateSelect.value;
    if (!key) return;

    const template = Config.ANOMALY_TEMPLATES[key];
    const container = DOM.get('filtersContainer');
    if (container) container.innerHTML = '';

    // Consolidate all unique signals from all loaded files
    const allUniqueSignals = [
      ...new Set(AppState.files.flatMap((f) => f.availableSignals)),
    ];

    template.rules.forEach((rule) => {
      let bestSig = '';

      // 1. Direct match check
      if (allUniqueSignals.includes(rule.sig)) {
        bestSig = rule.sig;
      } else {
        // 2. Alias match check using SIGNAL_MAPPINGS
        const aliases = (SIGNAL_MAPPINGS[rule.sig] || []).map((a) =>
          a.toLowerCase()
        );
        bestSig =
          allUniqueSignals.find((s) =>
            aliases.some((alias) => s.toLowerCase().includes(alias))
          ) || '';
      }

      this.addFilterRow(bestSig, rule.op, rule.val);
    });

    // Short delay ensures DOM updates before triggering scan
    setTimeout(() => this.runScan(), 100);
  },

  runScan() {
    UI.resetScannerUI();
    const criteria = Array.from(document.querySelectorAll('.filter-row'))
      .map((row) => ({
        sig: row.querySelector('.sig-select').value,
        op: row.querySelector('.op').value,
        val: parseFloat(row.querySelector('input').value),
      }))
      .filter((c) => c.sig && !isNaN(c.val));

    if (criteria.length === 0) {
      const countDiv = DOM.get('scanCount');
      if (countDiv) countDiv.innerText = 'No criteria defined';
      return;
    }
    const aggregatedResults = [];

    AppState.files.forEach((file, fileIdx) => {
      let state = {},
        inEvent = false,
        startT = 0;
      const ranges = [];

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
          ranges.push({
            start: startT,
            end: p.t,
            fileName: file.name,
            fileIdx: fileIdx,
          });
        }
      });
      aggregatedResults.push(...ranges);
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
        Sliders.zoomTo(s, e, range.fileIdx);
      };
      resDiv.appendChild(item);
    });
  },
};
