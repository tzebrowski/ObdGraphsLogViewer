// ui.js

const UI = {
    init: () => {
        if (DOM.sidebar) {
            DOM.sidebar.style.overflowY = 'auto';
            DOM.sidebar.style.height = '100vh';
            DOM.sidebar.style.paddingBottom = '50px';
        }
    },

    reset: () => {
        AppState.activeHighlight = null;
        DOM.get('scanResults').innerHTML = '';
        DOM.get('scanResults').style.display = 'none';
        DOM.get('scanCount').innerText = '';
    },

    toggleSidebar: () => {
        DOM.sidebar.classList.toggle('collapsed');
        setTimeout(() => AppState.chartInstance?.resize(), 350);
    },

    toggleFullScreen: () => {
        const el = DOM.get('mainContent');
        !document.fullscreenElement ? el.requestFullscreen() : document.exitFullscreen();
    },

    renderSignalList: () => {
        const list = DOM.get('signalList');
        list.innerHTML = '';
        let cIdx = 0;

        AppState.availableSignals.forEach(key => {
            const isImportant = ["Boost", "RPM", "Pedal", "Trim", "Advance"].some(k => key.includes(k));
            const color = CHART_COLORS[cIdx++ % CHART_COLORS.length];
            
            const label = document.createElement('label');
            label.innerHTML = `
                <input type="checkbox" data-key="${key}" ${isImportant ? 'checked' : ''}>
                <span style="display:inline-block;width:10px;height:10px;background:${color};margin-right:8px;"></span>
                ${key}
            `;
            label.querySelector('input').addEventListener('change', function() {
                const ds = AppState.chartInstance.data.datasets.find(d => d.label === key);
                if (ds) { ds.hidden = !this.checked; AppState.chartInstance.update(); }
            });
            list.appendChild(label);
        });
    },

    toggleAllSignals: (shouldCheck) => {
        document.querySelectorAll('#signalList input').forEach(i => i.checked = shouldCheck);
        if (AppState.chartInstance) {
            AppState.chartInstance.data.datasets.forEach(ds => ds.hidden = !shouldCheck);
            AppState.chartInstance.update();
        }
    }
};

const Templates = {
    initUI: () => {
        const sel = DOM.get('anomalyTemplate');
        sel.innerHTML = '<option value="">-- Load a Template --</option>';
        Object.keys(ANOMALY_TEMPLATES).forEach(key => {
            sel.innerHTML += `<option value="${key}">${ANOMALY_TEMPLATES[key].name}</option>`;
        });
        DOM.get('filtersContainer').innerHTML = '';
        Templates.addFilterRow();
    },

    apply: () => {
        const key = DOM.get('anomalyTemplate').value;
        if (!key) return;
        const template = ANOMALY_TEMPLATES[key];
        DOM.get('filtersContainer').innerHTML = '';

        template.rules.forEach(rule => {
            let bestSig = "";
            if (AppState.availableSignals.includes(rule.sig)) {
                bestSig = rule.sig;
            } else {
                const aliases = SIGNAL_MAPPINGS[rule.sig] || [];
                for (let alias of aliases) {
                    const found = AppState.availableSignals.find(s => 
                        s.toLowerCase().includes(alias.toLowerCase())
                    );
                    if (found) { bestSig = found; break; }
                }
            }
            Templates.addFilterRow(bestSig, rule.op, rule.val);
        });
        setTimeout(Scanner.scan, 100);
    },

    addFilterRow: (sigName = "", operator = ">", value = "") => {
        const container = DOM.get('filtersContainer');
        const div = document.createElement('div');
        div.className = 'filter-row';
        const options = AppState.availableSignals.map(k => 
            `<option value="${k}" ${k === sigName ? 'selected' : ''}>${k}</option>`
        ).join('');

        div.innerHTML = `
            <select class="sig-select"><option value="">Signal...</option>${options}</select>
            <select class="op">
                <option value=">" ${operator === '>' ? 'selected' : ''}>></option>
                <option value="<" ${operator === '<' ? 'selected' : ''}><</option>
            </select>
            <input type="number" placeholder="Val" value="${value}">
            <span class="remove-row" onclick="this.parentElement.remove()">×</span>
        `;
        container.appendChild(div);
    }
};

const Scanner = {
    scan: () => {
        AppState.activeHighlight = null;
        const criteria = [];
        document.querySelectorAll('.filter-row').forEach(row => {
            const sig = row.querySelector('.sig-select').value;
            const op = row.querySelector('.op').value;
            const val = parseFloat(row.querySelector('input').value);
            if (sig && !isNaN(val)) criteria.push({ sig, op, val });
        });

        if (criteria.length === 0) { alert("Please define conditions."); return; }

        const foundRanges = [];
        let currentState = {}, inEvent = false, eventStart = 0;

        AppState.rawData.forEach(p => {
            currentState[p.s] = p.v;
            let allMatch = true;
            for (let c of criteria) {
                const currentVal = currentState[c.sig];
                if (currentVal === undefined) { allMatch = false; break; }
                const isMatch = (c.op === '>') ? (currentVal > c.val) : (currentVal < c.val);
                if (!isMatch) { allMatch = false; break; }
            }

            if (allMatch) {
                if (!inEvent) { inEvent = true; eventStart = p.t; }
            } else {
                if (inEvent) {
                    inEvent = false;
                    if (p.t - eventStart > 100) foundRanges.push({ start: eventStart, end: p.t });
                }
            }
        });
        Scanner.displayResults(foundRanges);
    },

    displayResults: (ranges) => {
        const resDiv = DOM.get('scanResults');
        const countDiv = DOM.get('scanCount');
        resDiv.innerHTML = ''; resDiv.style.display = 'block';
        countDiv.innerText = `${ranges.length} anomalies found`;

        if (ranges.length === 0) { resDiv.innerHTML = '<div style="padding:10px;">None found.</div>'; return; }

        ranges.forEach((range, idx) => {
            const s = (range.start - AppState.globalStartTime) / 1000;
            const e = (range.end - AppState.globalStartTime) / 1000;
            const item = document.createElement('div');
            item.className = 'result-item';
            item.innerHTML = `<span>Event ${idx + 1}</span> <b>${s.toFixed(1)}s - ${e.toFixed(1)}s</b>`;
            item.onclick = () => {
                document.querySelectorAll('.result-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                Sliders.zoomTo(s, e);
            };
            resDiv.appendChild(item);
        });
    }
};