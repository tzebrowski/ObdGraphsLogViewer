async function loadConfiguration() {
    try {
        const response = await fetch('templates.json');
        if (!response.ok) throw new Error("Missing templates.json");
        ANOMALY_TEMPLATES = await response.json();
    } catch (error) {
        console.error("Config Loader:", error);
        ANOMALY_TEMPLATES = {};
    }
}

const DataProcessor = {
    handleLocalFile: (event) => {
        const files = Array.from(event.target.files);
        if (files.length === 0) return;

        UI.setLoading(true, `Parsing ${files.length} Files...`);
        let loaded = 0;
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    DataProcessor.process(JSON.parse(e.target.result), file.name);
                } catch (err) {
                    console.error(`Invalid JSON: ${file.name} Error: ${err.message}`);
                }
                loaded++;
                if (loaded === files.length) {
                    UI.setLoading(false);
                    DOM.get('fileInput').value = '';
                }
            };
            reader.readAsText(file);
        });
    },

    process: (data, fileName) => {
        const sorted = data.sort((a, b) => a.t - b.t);
        const signals = {};
        let minT = Infinity, maxT = -Infinity;

        sorted.forEach(p => {
            if (!signals[p.s]) signals[p.s] = [];
            signals[p.s].push({ x: p.t, y: p.v });
            if (p.t < minT) minT = p.t;
            if (p.t > maxT) maxT = p.t;
        });

        const fileEntry = {
            name: fileName,
            rawData: sorted,
            signals: signals,
            startTime: minT,
            duration: (maxT - minT) / 1000,
            availableSignals: Object.keys(signals).sort()
        };

        AppState.files.push(fileEntry);

        if (AppState.files.length === 1) {
            AppState.globalStartTime = minT;
            AppState.logDuration = fileEntry.duration;
            AppState.availableSignals = fileEntry.availableSignals;
            UI.renderSignalList();
            Analysis.init();
            if (typeof Sliders !== 'undefined') Sliders.init(AppState.logDuration);
        }

        DOM.get('fileInfo').innerText = `${AppState.files.length} logs loaded`;
        UI.renderSignalList();
        ChartManager.render();
    }
};


window.onload = async function () {
    await loadConfiguration();
    Auth.init();
    UI.init();
    Analysis.init();

    Auth.onAuthSuccess = Drive.listFiles.bind(Drive);

    const fileInput = DOM.get('fileInput');
    if (fileInput) {
        fileInput.setAttribute('multiple', 'multiple'); // Enable multiple selection
        fileInput.addEventListener('change', DataProcessor.handleLocalFile);
    }
};

// Global onclick bindings
window.ChartManager = ChartManager; 
window.toggleConfig = () => UI.toggleConfig();
window.toggleSidebar = () => UI.toggleSidebar();
window.toggleFullScreen = () => UI.toggleFullScreen();
window.toggleAllSignals = (check) => UI.toggleAllSignals(check);

window.saveConfig = () => Auth.saveConfig();
window.handleAuth = () => Auth.handleAuth();
window.applyTemplate = () => Analysis.applyTemplate();
window.scanAnomalies = () => Analysis.runScan();
window.addFilterRow = () => Analysis.addFilterRow();
window.resetZoom = () => Sliders.reset();