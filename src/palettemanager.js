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
    const customToggle = document.getElementById('pref-custom-palette');

    if (customToggle) {
      customToggle?.addEventListener('change', () => {
        Preferences.savePreferences();
        UI.renderSignalList();
        if (typeof ChartManager !== 'undefined') ChartManager.render();
      });
    }
  },

  getSignalKey(fileName, signalName) {
    return `${fileName}_${signalName}`;
  },

  getColorForSignal(fileIdx, sigIdx) {
    const fIdx = parseInt(fileIdx) || 0;
    const sIdx = parseInt(sigIdx) || 0;

    const file = AppState.files[fIdx];
    if (!file) return '#888888';

    const signalName = file.availableSignals[sIdx];
    const key = this.getSignalKey(file.name, signalName);

    const prefs = Preferences.prefs;
    const customMap = Preferences.customPalette;
    if (prefs.useCustomPalette && customMap[key]) {
      return customMap[key];
    }

    const themePalette = this.getDefaultChartColors();
    return themePalette[(fIdx * 10 + sIdx) % themePalette.length];
  },

  getDefaultChartColors() {
    const isDarkMode = document.body.classList.contains('pref-theme-dark');
    return isDarkMode ? this.CHART_COLORS : this.CHART_COLORS_LIGHT;
  },
};
