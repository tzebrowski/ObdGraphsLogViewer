const Analysis = {
    initTemplates() {
        const sel = DOM.get('anomalyTemplate');
        if (!sel) return;

        const options = Object.keys(ANOMALY_TEMPLATES)
            .map(k => `<option value="${k}">${ANOMALY_TEMPLATES[k].name}</option>`);

        sel.innerHTML = '<option value="">-- Load a Template --</option>' + options.join('');

        const filtersContainer = DOM.get('filtersContainer');
        if (filtersContainer) {
            filtersContainer.innerHTML = '';
            this.addFilterRow();
        }
    },


    init: () => {
        Analysis.initTemplates();
        // Set up the button listener if not already in HTML
        const scanBtn = DOM.get('btnRunScan');
        if (scanBtn) scanBtn.onclick = () => Analysis.runScan();
    },

    addFilterRow(sigName = "", operator = ">", value = "") {
        const container = DOM.get('filtersContainer');
        if (!container) return;

        const div = document.createElement('div');
        div.className = 'filter-row';

        const options = AppState.availableSignals.map(k =>
            `<option value="${k}" ${k === sigName ? 'selected' : ''}>${k}</option>`
        ).join('');

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

        const template = ANOMALY_TEMPLATES[key];
        const container = DOM.get('filtersContainer');
        if (container) container.innerHTML = '';

        template.rules.forEach(rule => {
            let bestSig = AppState.availableSignals.includes(rule.sig) ? rule.sig : "";

            if (!bestSig) {
                const aliases = (SIGNAL_MAPPINGS[rule.sig] || []).map(a => a.toLowerCase());
                bestSig = AppState.availableSignals.find(s =>
                    aliases.some(alias => s.toLowerCase().includes(alias))
                ) || "";
            }
            this.addFilterRow(bestSig, rule.op, rule.val);
        });

        setTimeout(() => this.runScan(), 100);
    },

    runScan() {
        UI.resetScannerUI();
        const criteria = Array.from(document.querySelectorAll('.filter-row')).map(row => ({
            sig: row.querySelector('.sig-select').value,
            op: row.querySelector('.op').value,
            val: parseFloat(row.querySelector('input').value)
        })).filter(c => c.sig && !isNaN(c.val));

       if (criteria.length === 0) {
            const countDiv = DOM.get('scanCount');
            if (countDiv) countDiv.innerText = 'No criteria defined';
            return;
        }
        const aggregatedResults = [];

        AppState.files.forEach((file, fileIdx) => {
            let state = {}, inEvent = false, startT = 0;
            const ranges = [];

            file.rawData.forEach(p => {
                state[p.s] = p.v;
                const match = criteria.every(c =>
                    state[c.sig] !== undefined && (c.op === '>' ? state[c.sig] > c.val : state[c.sig] < c.val)
                );

                if (match && !inEvent) {
                    inEvent = true;
                    startT = p.t;
                } else if (!match && inEvent) {
                    inEvent = false;
                    ranges.push({ start: startT, end: p.t, fileName: file.name, fileIdx: fileIdx });
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
                document.querySelectorAll('.result-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                Sliders.zoomTo(s, e, range.fileIdx);
            };
            resDiv.appendChild(item);
        });
    }
};