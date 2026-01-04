import { DOM } from './config.js';
import { Auth } from './auth.js';
import { Analysis } from './analysis.js';
import { ChartManager, Sliders } from './chartmanager.js';
import { UI, InfoPage } from './ui.js';
import { Drive } from './drive.js';
import { DragnDrop } from './dragndrop.js';
import { DataProcessor } from './dataprocesssor.js';
import { Preferences } from './preferences.js';
import { Navigation } from './navigation.js';
import { Alert } from './alert.js';

window.onload = async function () {
  await DataProcessor.loadConfiguration();

  Auth.init();
  UI.init();
  Analysis.init();
  Auth.onAuthSuccess = Drive.listFiles.bind(Drive);
  ChartManager.init();
  InfoPage.init();
  DragnDrop.init();
  Preferences.init();
  Navigation.init();

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

window.saveDriveConfig = () => Auth.saveConfig();
window.toggleDriveConfig = () => UI.toggleItem('configPanel');
window.toggleSidebar = () => UI.toggleSidebar();
window.toggleFullScreen = () => UI.toggleFullScreen();
window.toggleAllSignals = (check) => UI.toggleAllSignals(check);
window.handleAuth = () => Auth.handleAuth();
window.applyTemplate = () => Analysis.applyTemplate();
window.scanAnomalies = () => Analysis.runScan();
window.addFilterRow = () => Analysis.addFilterRow();
window.resetZoom = () => Sliders.reset();
window.toggleInfo = () => InfoPage.toggleInfo();
window.loadSampleData = (i) => UI.loadSampleData(i);
window.removeFile = (f) => ChartManager.removeFile(f);
window.manualZoom = (e, f) => ChartManager.manualZoom(e, f);
window.loadFile = (a, b, c) => Drive.loadFile(a, b, c);
window.toggleFileSignals = (a, b) => UI.toggleFileSignals(a, b);
window.clearSignalFilter = () => UI.clearSignalFilter();
window.showAlert = (a, b, c) => Alert.showAlert(a, b, c);
window.hideAlert = () => Alert.hideAlert();
