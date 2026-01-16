import { DOM } from './config.js';
import { Auth } from './auth.js';
import { Analysis } from './analysis.js';
import { ChartManager } from './chartmanager.js';
import { UI, InfoPage } from './ui.js';
import { Drive } from './drive.js';
import { DragnDrop } from './dragndrop.js';
import { dataProcessor } from './dataprocessor.js';
import { Preferences } from './preferences.js';
import { Navigation } from './navigation.js';
import { Alert } from './alert.js';
import { PaletteManager } from './palettemanager.js';

window.onload = async function () {
  await dataProcessor.loadConfiguration();

  Auth.init();
  UI.init();
  Analysis.init();
  Auth.onAuthSuccess = Drive.listFiles.bind(Drive);
  ChartManager.init();
  InfoPage.init();
  DragnDrop.init();
  Preferences.init();
  Navigation.init();
  PaletteManager.init();

  const fileInput = DOM.get('fileInput');
  if (fileInput) {
    fileInput.setAttribute('multiple', 'multiple'); // Enable multiple selection
    fileInput.addEventListener('change', dataProcessor.handleLocalFile);
  }
};

window.onclick = (event) => {
  const modal = document.getElementById('infoModal');
  if (event.target === modal) {
    UI.toggleInfo();
  }
};

window.saveDriveConfig = () => Auth.saveConfig();
window.toggleDriveConfig = () => UI.toggleItem('configPanel');
window.toggleSidebar = () => UI.toggleSidebar();
window.toggleFullScreen = () => UI.toggleFullScreen();
window.toggleAllSignals = (check) => UI.toggleAllSignals(check);
window.handleAuth = () => Auth.handleAuth();
window.applyTemplate = () => Analysis.applyTemplate();
window.scanAnomalies = () => Analysis.runScan();
window.addFilterRow = () => Analysis.addFilterRow();
window.toggleInfo = () => InfoPage.toggleInfo();
window.loadSampleData = (i) => UI.loadSampleData(i);
window.loadFile = (a, b, c) => Drive.loadFile(a, b, c);
window.toggleFileSignals = (a, b) => UI.toggleFileSignals(a, b);
window.clearSignalFilter = () => UI.clearSignalFilter();
window.showAlert = (a, b, c) => Alert.showAlert(a, b, c);
window.hideAlert = () => Alert.hideAlert();
window.resetChart = (i) => ChartManager.resetChart(i);
window.removeChart = (f) => ChartManager.removeChart(f);
window.resetZoom = () => ChartManager.reset();
window.manualZoom = (e, f) => ChartManager.manualZoom(e, f);
