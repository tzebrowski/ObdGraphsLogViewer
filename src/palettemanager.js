import { ChartManager } from './chartmanager.js';
import { Preferences } from './preferences.js';

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

  getChartColors() {
    const prefs = Preferences.prefs;

    if (prefs.useCustomPalette) {
      const savedPalette = Preferences.customPalette;
      if (savedPalette) return savedPalette;
    }

    const isDarkMode = document.body.classList.contains('pref-theme-dark');
    return isDarkMode ? this.CHART_COLORS : this.CHART_COLORS_LIGHT;
  },

  init() {
    this.render();

    const customToggle = document.getElementById('pref-custom-palette');
    customToggle?.addEventListener('change', () => {
      Preferences.savePreferences();
      const row = document.getElementById('palette-settings-row');
      if (row) row.style.display = customToggle.checked ? 'block' : 'none';

      this.render();
      if (typeof ChartManager !== 'undefined') ChartManager.render();
    });
  },

  render() {
    const container = document.getElementById('palette-container');
    if (!container) return;

    const currentColors = this.getChartColors();
    container.innerHTML = '';

    currentColors.forEach((color, idx) => {
      const picker = document.createElement('input');
      picker.type = 'color';
      picker.value = color;
      picker.className = 'palette-picker';

      picker.onchange = (e) => {
        const newPalette = [...currentColors];
        newPalette[idx] = e.target.value;
        Preferences.customPalette = newPalette; // Use Preference setter
        ChartManager.render();
      };

      container.appendChild(picker);
    });

    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn-icon';
    resetBtn.innerHTML = '<i class="fas fa-undo"></i>';
    resetBtn.title = 'Reset to Theme Defaults';
    resetBtn.onclick = () => {
      Preferences.customPalette = null; // Use Preference setter to remove
      this.render();
      ChartManager.render();
    };
    container.appendChild(resetBtn);
  },
};
