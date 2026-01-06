import { ChartManager } from './chartmanager.js';
import { Preferences } from './preferences.js';
import { UI } from './ui.js';
import { AppState } from './config.js';

export const PaletteManager = {
  CHART_COLORS: [
    '#e31837',
    '#0051ba',
    '#2dcc70',
    '#f1c40f',
    '#8e44ad',
    '#e67e22',
    '#00F2FF',
    '#39FF14',
    '#FF007F',
    '#FFFF00',
    '#BC13FE',
    '#FF4D00',
    '#00FF9F',
    '#FFD700',
    '#FF0000',
  ],

  CHART_COLORS_LIGHT: [
    '#1A73E8',
    '#2E7D32',
    '#C2185B',
    '#F57C00',
    '#7B1FA2',
    '#D32F2F',
    '#0097A7',
    '#607D8B',
    '#AFB42B',
  ],

  init() {
    this.render();

    const customToggle = document.getElementById('pref-custom-palette');
    const settingsRow = document.getElementById('palette-settings-row');

    if (customToggle && settingsRow) {
      settingsRow.style.display = customToggle.checked ? 'block' : 'none';

      customToggle?.addEventListener('change', () => {
        Preferences.savePreferences();
        const row = document.getElementById('palette-settings-row');
        if (row) row.style.display = customToggle.checked ? 'block' : 'none';

        this.render();
        if (typeof ChartManager !== 'undefined') ChartManager.render();

        UI.renderSignalList();
      });
    }
  },

  getColorForSignal(fileIdx, sigIdx) {
    const colors = this.getChartColors();
    return colors[(fileIdx * 10 + sigIdx) % colors.length];
  },

  getChartColors() {
    const prefs = Preferences.prefs;

    if (prefs.useCustomPalette) {
      const savedPalette = Preferences.customPalette;
      if (savedPalette) return savedPalette;
    }

    const isDarkMode = document.body.classList.contains('pref-theme-dark');
    return isDarkMode ? this.CHART_COLORS : this.CHART_COLORS_LIGHT;
  },

  render() {
    const container = document.getElementById('palette-container');
    if (!container) return;

    const currentColors = this.getChartColors();
    container.innerHTML = '';

    // Create pickers based on the actual number of signals available in AppState
    let globalSigIdx = 0;
    AppState.files.forEach((file, fileIdx) => {
      file.availableSignals.forEach((signal, sigIdx) => {
        const color = this.getColorForSignal(fileIdx, sigIdx);

        const picker = document.createElement('input');
        picker.type = 'color';
        picker.value = color;
        picker.className = 'palette-picker';
        picker.title = `${file.name}: ${signal}`;

        picker.onchange = (e) => {
          const newPalette = [...currentColors];
          const paletteIdx = (fileIdx * 10 + sigIdx) % currentColors.length;
          newPalette[paletteIdx] = e.target.value;

          Preferences.customPalette = newPalette;
          ChartManager.render();
          UI.renderSignalList();
        };

        container.appendChild(picker);
        globalSigIdx++;
      });
    });

    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn-icon';
    resetBtn.innerHTML = '<i class="fas fa-undo"></i>';
    resetBtn.onclick = () => {
      Preferences.customPalette = null;
      this.render();
      ChartManager.render();
      UI.renderSignalList();
    };
    container.appendChild(resetBtn);
  },
};
