import { DOM } from './config.js';
import { Auth } from './auth.js';
import { Analysis } from './analysis.js';
import { ChartManager, Sliders } from './chartmanager.js';
import { UI, InfoPage } from './ui.js';
import { Drive } from './drive.js';
import { DragnDrop } from './dragndrop.js';
import { DataProcessor } from './dataprocesssor.js';

window.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('preferred-theme') || 'dark';
    UI.setTheme(savedTheme);
});

window.onload = async function () {
    await DataProcessor.loadConfiguration();
    Auth.init();
    UI.init();
    Analysis.init();
    Auth.onAuthSuccess = Drive.listFiles.bind(Drive);
    ChartManager.init();
    InfoPage.init();
    DragnDrop.init();
    UI.renderVersionInfo();
    
    const fileInput = DOM.get('fileInput');
    if (fileInput) {
        fileInput.setAttribute('multiple', 'multiple'); // Enable multiple selection
        fileInput.addEventListener('change', DataProcessor.handleLocalFile);
    }
};

window.onclick = (event) => {
    const modal = document.getElementById('infoModal');
    if (event.target === modal) {
        UI.toggleInfo();
    }
};

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
window.toggleInfo = () => InfoPage.toggleInfo();
window.loadSampleData = () => UI.loadSampleData();
window.setTheme = (theme) => UI.setTheme(theme);
window.removeFile = (f) => ChartManager.removeFile(f);
window.loadFile = (a, b, c) => Drive.loadFile(a, b, c);