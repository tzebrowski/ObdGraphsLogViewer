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
        const file = event.target.files[0];
        if (!file) return;
        
        UI.setLoading(true, "Parsing File...");
        setTimeout(() => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    DataProcessor.process(JSON.parse(e.target.result));
                } catch (err) { 
                    alert("Invalid JSON file");
                } finally {
                    UI.setLoading(false);
                    DOM.get('fileInput').value = '';
                }
            };
            reader.readAsText(file);
        }, 50);
    },

    process: (data) => {
        AppState.rawData = data.sort((a, b) => a.t - b.t);
        AppState.signals = {};
        let minT = Infinity, maxT = -Infinity;

        AppState.rawData.forEach(p => {
            if (!AppState.signals[p.s]) AppState.signals[p.s] = [];
            AppState.signals[p.s].push({ x: p.t, y: p.v });
            if (p.t < minT) minT = p.t;
            if (p.t > maxT) maxT = p.t;
        });

        AppState.globalStartTime = minT;
        AppState.logDuration = (maxT - minT) / 1000;
        AppState.availableSignals = Object.keys(AppState.signals).sort();

        DOM.get('fileInfo').innerText = `${AppState.logDuration.toFixed(1)}s | ${AppState.availableSignals.length} signals`;
        
        UI.resetScannerUI();
        UI.renderSignalList();
        Analysis.initTemplates();
        Sliders.init(AppState.logDuration);
        ChartManager.render();
    }
};

window.onload = async function() {
    await loadConfiguration();
    Auth.init();
    UI.init();
    
    Auth.onAuthSuccess = Drive.listFiles.bind(Drive);

    DOM.get('fileInput')?.addEventListener('change', DataProcessor.handleLocalFile);
    DOM.get('rangeStart')?.addEventListener('input', Sliders.updateFromInput);
    DOM.get('rangeEnd')?.addEventListener('input', Sliders.updateFromInput);
};

// Global onclick bindings
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