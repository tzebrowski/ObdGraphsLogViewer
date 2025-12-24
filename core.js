const DataProcessor = {

    handleLocalFile: (event) => {
        const file = event.target.files[0];
        if (!file) return;
        
        UI.setLoading(true, "Parsing File...");

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

        // Update File Info display
        DOM.get('fileInfo').innerText = `${AppState.logDuration.toFixed(1)}s | ${AppState.availableSignals.length} signals`;
        
        // UI Logic
        UI.resetScannerUI(); 
        UI.renderSignalList();
        
        // Analysis Logic
        Analysis.initTemplates(); 
        
        // Component Logic
        Sliders.init(AppState.logDuration);
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
    await loadConfiguration(); //

    Auth.init(); //
    UI.init(); //
    
   Auth.onAuthSuccess = Drive.listFiles.bind(Drive);

    // Use DOM helper to ensure listeners are bound correctly
    const fileInput = DOM.get('fileInput');
    if (fileInput) fileInput.addEventListener('change', DataProcessor.handleLocalFile); //
    
    const rangeStart = DOM.get('rangeStart');
    if (rangeStart) rangeStart.addEventListener('input', Sliders.updateFromInput); //
    
    const rangeEnd = DOM.get('rangeEnd');
    if (rangeEnd) rangeEnd.addEventListener('input', Sliders.updateFromInput); //
};

// Global bindings for HTML onclick attributes
window.saveConfig = () => Auth.saveConfig();
window.handleAuth = () => Auth.handleAuth();
window.loadDriveFile = () => Drive.loadFile();

window.toggleConfig = () => UI.toggleConfig();
window.toggleSidebar = () => UI.toggleSidebar();
window.toggleFullScreen = () => UI.toggleFullScreen();
window.toggleAllSignals = (check) => UI.toggleAllSignals(check);

window.applyTemplate = () => Analysis.applyTemplate();
window.scanAnomalies = () => Analysis.runScan();
window.addFilterRow = () => Analysis.addFilterRow();

window.resetZoom = () => Sliders.reset();