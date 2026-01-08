import { ChartManager } from './chartmanager.js';
import { Preferences } from './preferences.js';
import { UI } from './ui.js';
import { AppState } from './config.js';

/**
 * PaletteManager Module
 * Manages color assignment for chart signals, including custom palette overrides.
 */
export const PaletteManager = {
  // Brand and vibrant palettes for dark mode
  DARK_PALETTE: [
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

  // Muted, high-contrast palettes for light mode
  LIGHT_PALETTE: [
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

  DEFAULT_COLOR: '#888888', // Fallback for missing signals

  // --- Lifecycle ---

  init() {
    const customToggle = document.getElementById('pref-custom-palette');

    // Use optional chaining and cleaner listener logic
    customToggle?.addEventListener('change', () => {
      Preferences.savePreferences();
      UI.renderSignalList();
      if (typeof ChartManager !== 'undefined') {
        ChartManager.render();
      }
    });
  },

  // --- Color Logic ---

  /**
   * Generates a unique key for signal-specific color storage
   */
  getSignalKey(fileName, signalName) {
    return `${fileName}_${signalName}`;
  },

  /**
   * Resolves the color for a signal based on index, file, and custom preferences.
   */
  getColorForSignal(fileIdx, sigIdx) {
    const fIdx = parseInt(fileIdx) || 0;
    const sIdx = parseInt(sigIdx) || 0;

    const file = AppState.files[fIdx];
    if (!file) return this.DEFAULT_COLOR; //

    const signalName = file.availableSignals[sIdx];
    const key = this.getSignalKey(file.name, signalName);

    // 1. Check for custom palette overrides
    const { useCustomPalette } = Preferences.prefs;
    const customMap = Preferences.customPalette;

    if (useCustomPalette && customMap[key]) {
      return customMap[key];
    }

    // 2. Fallback to thematic rotation
    const palette = this.getDefaultChartColors();
    const colorIndex = (fIdx * 10 + sIdx) % palette.length;
    return palette[colorIndex];
  },

  /**
   * Returns the active color palette based on current theme state
   */
  getDefaultChartColors() {
    const isDarkMode = document.body.classList.contains('pref-theme-dark');
    return isDarkMode ? this.DARK_PALETTE : this.LIGHT_PALETTE;
  },
};
