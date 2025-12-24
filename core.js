const DataProcessor = {
   // In core.js, replace handleLocalFile with this:
    handleLocalFile: (event) => {
        const file = event.target.files[0];
        if (!file) return;
        
        // 1. Show Loading Screen
        UI.setLoading(true, "Parsing File...");

        // 2. Use setTimeout to let the UI render the overlay before freezing
        setTimeout(() => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const json = JSON.parse(e.target.result);
                    DataProcessor.process(json);
                } catch (err) { 
                    alert("Invalid JSON file"); 
                } finally {
                    // 3. Hide Loading Screen
                    UI.setLoading(false);
                    // Reset file input so same file can be selected again if needed
                    DOM.get('fileInput').value = ''; 
                }
            };
            reader.readAsText(file);
        }, 50); // 50ms delay to allow DOM repaint
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
        Templates.initUI(); // This uses ANOMALY_TEMPLATES, so they must be loaded by now
        Sliders.init(AppState.logDuration);
        UI.renderSignalList();
        ChartManager.render();
    }
};

// --- CONFIG LOADER ---
async function loadConfiguration() {
    try {
        const response = await fetch('templates.json');
        if (!response.ok) throw new Error("Failed to load templates.json");
        ANOMALY_TEMPLATES = await response.json();
        console.log("Templates loaded:", Object.keys(ANOMALY_TEMPLATES));
    } catch (error) {
        console.error("Error loading config:", error);
        alert("Warning: Could not load anomaly templates. Scanner may not work.");
    }
}

window.onload = async function() {
    await loadConfiguration();

    Auth.init();
    UI.init();
    
    // WIRE THE DEPENDENCY HERE:
    Auth.onAuthSuccess = Drive.listFiles;

    // Bind Events
    DOM.get('fileInput').addEventListener('change', DataProcessor.handleLocalFile);
    DOM.get('rangeStart').addEventListener('input', Sliders.updateFromInput);
    DOM.get('rangeEnd').addEventListener('input', Sliders.updateFromInput);
};

window.toggleConfig = Auth.toggleConfig;
window.saveConfig = Auth.saveConfig;
window.handleAuth = Auth.handleAuth;
window.loadDriveFile = Drive.loadFile;
window.toggleSidebar = UI.toggleSidebar;
window.toggleFullScreen = UI.toggleFullScreen;
window.toggleAllSignals = UI.toggleAllSignals;
window.applyTemplate = Templates.apply;
window.scanAnomalies =  Scanner.scan;
window.resetZoom = Sliders.reset;