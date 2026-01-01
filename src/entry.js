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

  const fileInput = DOM.get('fileInput');
  if (fileInput) {
    fileInput.setAttribute('multiple', 'multiple'); // Enable multiple selection
    fileInput.addEventListener('change', DataProcessor.handleLocalFile);
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Select the sidebar to listen for clicks on headers
    const sidebar = document.getElementById('sidebar');

    if (sidebar) {
      sidebar.addEventListener('click', (e) => {
        // Check if the clicked element is an h3 or inside a group-header
        const header =
          e.target.closest('.control-group h3') ||
          e.target.closest('.group-header');

        if (header) {
          // Prevent toggling if a specific action link like (Drive Config) is clicked
          if (e.target.classList.contains('config-link')) return;

          const group = header.closest('.control-group');
          group.classList.toggle('collapsed');
        }
      });
    }
  });
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
