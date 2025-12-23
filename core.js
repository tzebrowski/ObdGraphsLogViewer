// main.js

const DataProcessor = {
    handleLocalFile: (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const json = JSON.parse(e.target.result);
                DataProcessor.process(json);
            } catch (err) { alert("Invalid JSON file"); }
        };
        reader.readAsText(file);
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
        
        UI.reset();
        Templates.initUI();
        Sliders.init(AppState.logDuration);
        UI.renderSignalList();
        ChartManager.render();
    }
};

// --- INITIALIZATION ---
window.onload = function() {
    Auth.init();
    UI.init();
    
    // Bind Events
    DOM.get('fileInput').addEventListener('change', DataProcessor.handleLocalFile);
    DOM.get('rangeStart').addEventListener('input', Sliders.updateFromInput);
    DOM.get('rangeEnd').addEventListener('input', Sliders.updateFromInput);
};

// --- EXPOSE GLOBAL HELPERS FOR HTML CLICK HANDLERS ---
window.toggleConfig = Auth.toggleConfig;
window.saveConfig = Auth.saveConfig;
window.handleAuth = Auth.handleAuth;
window.loadDriveFile = Drive.loadFile;
window.toggleSidebar = UI.toggleSidebar;
window.toggleFullScreen = UI.toggleFullScreen;
window.toggleAllSignals = UI.toggleAllSignals;
window.applyTemplate = Templates.apply;
window.resetZoom = Sliders.reset;