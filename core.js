// --- UTILITIES ---
const getEl = id => document.getElementById(id);

// --- PREDEFINED TEMPLATES ---
const ANOMALY_TEMPLATES = {
    "high_load_retard": {
        name: "High Load / Spark Retard",
        rules: [
            { sig: "Accelerator Pedal Position", op: ">", val: 50 },
            { sig: "Intake Manifold Pressure Measured", op: ">", val: 2200 },
            { sig: "Spark Advance", op: "<", val: 0 }
        ]
    },
    "lean_in_boost": {
        name: "Lean Mixture under Boost (Dangerous)",
        rules: [
            { sig: "Intake Manifold Pressure Measured", op: ">", val: 1500 },
            { sig: "Lambda Sensor 1", op: ">", val: 1.0 }
        ]
    },
    "boost_leak_rich": {
        name: "Potential Boost Leak (Rich Trim)",
        rules: [
            { sig: "Intake Manifold Pressure Measured", op: ">", val: 2000 },
            { sig: "Short Fuel Trim", op: "<", val: -15 }
        ]
    }
};

// --- SIGNAL ALIAS MAPPINGS (THE FIX) ---
// This prevents "Camshaft Overlap" from being selected for "Intake Manifold"
const SIGNAL_MAPPINGS = {
    "Intake Manifold Pressure": ["Manifold Abs", "MAP", "Intake Press", "Boost Pressure"],
    "Accelerator Pedal Position": ["Pedal Pos", "APP", "Throttle Pos", "TPS"],
    "Spark Advance": ["Ignition Timing", "Timing Adv", "Spark Angle"],
    "Lambda Sensor 1": ["O2 Sensor", "Equivalence Ratio", "AFR", "Lambda"],
    "Short Fuel Trim": ["SFT", "STFT", "Short Term"]
};

// --- GOOGLE DRIVE INTEGRATION ---
let tokenClient, gapiInited = false, gisInited = false;
const storedClientId = localStorage.getItem('alfa_clientId');
const storedApiKey = localStorage.getItem('alfa_apiKey');
if(storedClientId) getEl('gClientId').value = storedClientId;
if(storedApiKey) getEl('gApiKey').value = storedApiKey;

function toggleConfig() { 
    const p = getEl('configPanel'); 
    p.style.display = p.style.display === 'block' ? 'none' : 'block'; 
}

function saveConfig() { 
    localStorage.setItem('alfa_clientId', getEl('gClientId').value);
    localStorage.setItem('alfa_apiKey', getEl('gApiKey').value);
    alert("Keys Saved! Please refresh the page.");
}

window.onload = function() { 
    if(window.google) gisLoaded(); 
    if(window.gapi) gapiLoaded(); 
};

function gapiLoaded() { gapi.load('client', initGapi); }
async function initGapi() { 
    const k = getEl('gApiKey').value; if(!k) return;
    await gapi.client.init({ apiKey: k, discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"] });
    gapiInited = true; 
}
function gisLoaded() { 
    const c = getEl('gClientId').value; if(!c) return;
    tokenClient = google.accounts.oauth2.initTokenClient({ client_id: c, scope: 'https://www.googleapis.com/auth/drive.readonly', callback: '' });
    gisInited = true; 
}

function handleAuth() {
    if(!gapiInited || !gisInited) { alert("Please configure keys first (click Drive Config)"); return; }
    tokenClient.callback = async (r) => { if(r.error) throw r; await listFiles(); };
    gapi.client.getToken() === null ? tokenClient.requestAccessToken({prompt: 'consent'}) : tokenClient.requestAccessToken({prompt: ''});
}

async function listFiles() {
    getEl('driveList').style.display='block';
    getEl('driveList').innerHTML = '<div style="padding:5px;">Scanning...</div>';
    try {
        const res = await gapi.client.drive.files.list({ pageSize:10, fields:"files(id,name)", q:"mimeType='application/json' and trashed=false", orderBy:'createdTime desc' });
        let h = ''; 
        if(res.result.files) {
            res.result.files.forEach(f => {
                h += `<div style="padding:5px; border-bottom:1px solid #eee; cursor:pointer;" onclick="loadDriveFile('${f.id}')">${f.name}</div>`;
            });
        }
        getEl('driveList').innerHTML = h || 'No JSON files found.';
    } catch(e) { getEl('driveList').innerHTML = 'Error: '+e.message; }
}

async function loadDriveFile(id) {
    getEl('fileInfo').innerText = "Downloading...";
    const r = await gapi.client.drive.files.get({ fileId: id, alt: 'media' });
    processData(r.result);
}


// --- MAIN APP LOGIC ---
let chartInstance = null;
let rawData = [];
let globalStartTime = 0, logDuration = 0;
let availableSignals = [];
let activeHighlight = null; // Stores {start, end}

// Sliders
const rStart = getEl('rangeStart'), rEnd = getEl('rangeEnd');
const txtStart = getEl('txtStart'), txtEnd = getEl('txtEnd');

// UI Toggles
function toggleSidebar() { 
    getEl('sidebar').classList.toggle('collapsed'); 
    setTimeout(() => chartInstance?.resize(), 350); 
}
function toggleFullScreen() { 
    const e = getEl('mainContent'); 
    !document.fullscreenElement ? e.requestFullscreen() : document.exitFullscreen(); 
}

// Local File Loading
getEl('fileInput').addEventListener('change', e => {
    const f = e.target.files[0]; if(!f) return;
    const r = new FileReader();
    r.onload = ev => { 
        try { processData(JSON.parse(ev.target.result)); } 
        catch(err){ alert("Invalid JSON file"); } 
    };
    r.readAsText(f);
});

// Data Processing
function processData(data) {
    rawData = data.sort((a,b) => a.t - b.t); 
    const signals = {};
    let minT = Infinity, maxT = -Infinity;

    rawData.forEach(p => {
        if(!signals[p.s]) signals[p.s] = [];
        signals[p.s].push({x: p.t, y: p.v});
        if(p.t < minT) minT = p.t;
        if(p.t > maxT) maxT = p.t;
    });

    globalStartTime = minT;
    logDuration = (maxT - minT) / 1000;
    
    getEl('fileInfo').innerText = `${logDuration.toFixed(1)}s | ${Object.keys(signals).length} signals`;
    availableSignals = Object.keys(signals).sort();
    
    // Cleanup old data
    activeHighlight = null; 
    getEl('scanResults').innerHTML = '';
    getEl('scanResults').style.display = 'none';
    getEl('scanCount').innerText = '';

    initSliders(logDuration);
    initTemplatesUI();
    
    renderSignals(signals);
    renderChart(signals);
}


// --- ANOMALY SCANNER & TEMPLATES ---
function initTemplatesUI() {
    const sel = getEl('anomalyTemplate');
    sel.innerHTML = '<option value="">-- Load a Template --</option>';
    Object.keys(ANOMALY_TEMPLATES).forEach(key => {
        sel.innerHTML += `<option value="${key}">${ANOMALY_TEMPLATES[key].name}</option>`;
    });
    getEl('filtersContainer').innerHTML = '';
    addFilterRow(); 
}

// --- FIXED FUNCTION HERE ---
function applyTemplate() {
    const key = getEl('anomalyTemplate').value;
    if(!key) return;
    const template = ANOMALY_TEMPLATES[key];
    getEl('filtersContainer').innerHTML = '';

    template.rules.forEach(rule => {
        let bestSig = "";
        
        // 1. Check for Exact Match first
        if (availableSignals.includes(rule.sig)) {
            bestSig = rule.sig;
        } 
        // 2. Use Strict Aliases (Fixes the Camshaft/Intake mixup)
        else {
            const allowedAliases = SIGNAL_MAPPINGS[rule.sig] || [];
            
            // Loop through our allowed aliases for this specific signal
            for (let alias of allowedAliases) {
                // Find a signal in the file that contains this alias
                const found = availableSignals.find(s => 
                    s.toLowerCase().includes(alias.toLowerCase())
                );
                
                if (found) {
                    bestSig = found;
                    break; // Stop once we find a valid match
                }
            }
        }
        
        // If bestSig is still empty, it means the data is missing from the file.
        // The UI will show the "empty" dropdown so the user sees it's missing.
        addFilterRow(bestSig, rule.op, rule.val);
    });
    
    setTimeout(scanAnomalies, 100);
}

function addFilterRow(sigName = "", operator = ">", value = "") {
    const container = getEl('filtersContainer');
    const div = document.createElement('div'); div.className = 'filter-row';
    
    const selSig = document.createElement('select'); selSig.className = 'sig-select';
    selSig.innerHTML = '<option value="">Signal...</option>' + availableSignals.map(k=>`<option value="${k}" ${k===sigName?'selected':''}>${k}</option>`).join('');
    
    const selOp = document.createElement('select'); selOp.className = 'op'; 
    selOp.innerHTML = `<option value=">" ${operator==='>'?'selected':''}>></option><option value="<" ${operator==='<'?'selected':''}><</option>`;
    
    const inpVal = document.createElement('input'); inpVal.type = 'number'; inpVal.placeholder = 'Val';
    if(value !== "") inpVal.value = value;
    
    const rm = document.createElement('span'); rm.className = 'remove-row'; rm.innerHTML = '×'; 
    rm.onclick = () => container.removeChild(div);
    
    div.append(selSig, selOp, inpVal, rm); 
    container.append(div);
}

function scanAnomalies() {
    activeHighlight = null; 
    const rows = document.querySelectorAll('.filter-row');
    const criteria = [];
    
    rows.forEach(r => {
        const sig = r.querySelector('.sig-select').value;
        const op = r.querySelector('.op').value;
        const val = parseFloat(r.querySelector('input').value);
        if(sig && !isNaN(val)) criteria.push({sig, op, val});
    });

    if(criteria.length === 0) { alert("Please define conditions."); return; }

    const foundRanges = [];
    let currentState = {}, inEvent = false, eventStart = 0;

    rawData.forEach(p => {
        currentState[p.s] = p.v;
        let allMatch = true;
        for (let c of criteria) {
            const cv = currentState[c.sig];
            if (cv === undefined) { allMatch = false; break; }
            const isMatch = (c.op === '>') ? (cv > c.val) : (cv < c.val);
            if (!isMatch) { allMatch = false; break; }
        }

        if (allMatch) {
            if(!inEvent) { inEvent = true; eventStart = p.t; }
        } else {
            if(inEvent) {
                inEvent = false;
                if(p.t - eventStart > 100) foundRanges.push({start: eventStart, end: p.t});
            }
        }
    });

    const resDiv = getEl('scanResults'), cntDiv = getEl('scanCount');
    resDiv.innerHTML = ''; resDiv.style.display = 'block';
    cntDiv.innerText = `${foundRanges.length} anomalies found`;

    if (foundRanges.length === 0) { resDiv.innerHTML = '<div style="padding:10px;">None found.</div>'; return; }

    foundRanges.forEach((range, idx) => {
        const s = (range.start - globalStartTime) / 1000;
        const e = (range.end - globalStartTime) / 1000;
        const d = document.createElement('div'); d.className = 'result-item';
        d.innerHTML = `<span>Event ${idx+1}</span> <b>${s.toFixed(1)}s - ${e.toFixed(1)}s</b>`;
        d.onclick = function() {
            document.querySelectorAll('.result-item').forEach(el => el.classList.remove('selected'));
            d.classList.add('selected');
            zoomToRange(s, e);
        };
        resDiv.appendChild(d);
    });
}

function zoomToRange(startSec, endSec) {
    activeHighlight = { start: startSec, end: endSec }; 
    const buffer = 1.0; 
    let s = startSec - buffer; if(s < 0) s=0;
    let e = endSec + buffer; if(e > logDuration) e=logDuration;
    rStart.value = s; rEnd.value = e;
    updateSliderUI(true);
}


// --- CHART RENDERING ---
function renderSignals(signals) {
    const list = getEl('signalList'); list.innerHTML = '';
    const colors = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6'];
    let cIdx = 0;
    window.currentDatasets = [];

    Object.keys(signals).sort().forEach(key => {
        const isImp = key.includes("Boost") || key.includes("RPM") || key.includes("Pedal") || key.includes("Trim") || key.includes("Advance");
        const color = colors[cIdx++ % colors.length];
        window.currentDatasets.push({ label: key, data: signals[key], borderColor: color, borderWidth: 2, pointRadius:0, hidden: !isImp });

        const lbl = document.createElement('label');
        lbl.innerHTML = `<input type="checkbox" data-key="${key}" ${isImp?'checked':''}> <span style="display:inline-block;width:10px;height:10px;background:${color};margin-right:8px;"></span> ${key}`;
        lbl.querySelector('input').addEventListener('change', function() {
            const ds = chartInstance.data.datasets.find(d => d.label === key);
            if(ds) { ds.hidden = !this.checked; chartInstance.update(); }
        });
        list.appendChild(lbl);
    });
}

function renderChart() {
    const ctx = getEl('telemetryChart').getContext('2d');
    if(chartInstance) chartInstance.destroy();
    
    const startT = globalStartTime;
    const endT = globalStartTime + (logDuration * 1000);

    chartInstance = new Chart(ctx, {
        type: 'line', 
        data: { datasets: window.currentDatasets },
        plugins: [{
            id: 'anomalyHighlighter',
            beforeDatasetsDraw(chart) {
                if (!activeHighlight) return;
                const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
                const x1 = x.getPixelForValue(globalStartTime + (activeHighlight.start * 1000));
                const x2 = x.getPixelForValue(globalStartTime + (activeHighlight.end * 1000));
                ctx.save();
                ctx.fillStyle = 'rgba(255, 0, 0, 0.15)'; ctx.fillRect(x1, top, x2 - x1, bottom - top);
                ctx.strokeStyle = 'rgba(255, 0, 0, 0.6)'; ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
                ctx.beginPath(); ctx.moveTo(x1, top); ctx.lineTo(x1, bottom); ctx.moveTo(x2, top); ctx.lineTo(x2, bottom); ctx.stroke();
                ctx.restore();
            }
        }],
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { type: 'time', time: { unit: 'second', displayFormats: { second: 'mm:ss' } }, min: startT, max: endT, ticks: { maxRotation: 0 } },
                y: { position: 'left' }
            },
            plugins: { 
                legend: { display: false }, 
                tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${Number(c.parsed.y).toFixed(2)}` } },
                zoom: {
                    limits: { x: { min: startT, max: endT, minRange: 1000 } },
                    pan: { enabled: true, mode: 'x', onPan: syncSliderFromChart },
                    zoom: { wheel: { enabled: true }, mode: 'x', drag: { enabled: false }, onZoom: syncSliderFromChart }
                }
            }
        }
    });
}

function syncSliderFromChart({chart}) {
    const minVal = chart.scales.x.min, maxVal = chart.scales.x.max;
    const s = Math.max(0, (minVal - globalStartTime) / 1000);
    const e = Math.min(logDuration, (maxVal - globalStartTime) / 1000);
    rStart.value = s; rEnd.value = e;
    txtStart.innerText = s.toFixed(1)+'s'; txtEnd.innerText = e.toFixed(1)+'s';
    const ps = (s/logDuration)*100, pe = (e/logDuration)*100;
    getEl('sliderHighlight').style.left = ps+"%"; getEl('sliderHighlight').style.width = (pe-ps)+"%";
}

function initSliders(max) { 
    rStart.max = max; rEnd.max = max; rStart.value = 0; rEnd.value = max; updateSliderUI(false); 
}

function updateSliderUI(updateChart = true) {
    let v1 = parseFloat(rStart.value), v2 = parseFloat(rEnd.value);
    if (v1 > v2) { [v1, v2] = [v2, v1]; rStart.value = v1; rEnd.value = v2; }
    txtStart.innerText = v1.toFixed(1)+'s'; txtEnd.innerText = v2.toFixed(1)+'s';
    const ps = (v1/rStart.max)*100, pe = (v2/rEnd.max)*100;
    getEl('sliderHighlight').style.left = ps+"%"; getEl('sliderHighlight').style.width = (pe-ps)+"%";
    if(updateChart && chartInstance) {
        chartInstance.options.scales.x.min = globalStartTime + (v1*1000);
        chartInstance.options.scales.x.max = globalStartTime + (v2*1000);
        chartInstance.update('none');
    }
}

rStart.addEventListener('input', () => updateSliderUI(true)); 
rEnd.addEventListener('input', () => updateSliderUI(true));

function resetZoom() { 
    activeHighlight = null; 
    document.querySelectorAll('.result-item').forEach(el => el.classList.remove('selected'));
    initSliders(logDuration); updateSliderUI(true); 
}

function toggleAllSignals(s) {
    document.querySelectorAll('#signalList input').forEach(i => { i.checked = s; });
    if (chartInstance) { 
        chartInstance.data.datasets.forEach(ds => { ds.hidden = !s; }); 
        chartInstance.update(); 
    }
}