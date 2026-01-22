import { ChartManager } from './chartmanager.js';
import { Preferences } from './preferences.js';
import { UI } from './ui.js';
import { AppState } from './config.js';

class PaletteManagerClass {
  #DARK_PALETTE;
  #LIGHT_PALETTE;
  #DEFAULT_COLOR;

  constructor() {
    this.#DARK_PALETTE = [
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
    ];

    this.#LIGHT_PALETTE = [
      '#1A73E8',
      '#2E7D32',
      '#C2185B',
      '#F57C00',
      '#7B1FA2',
      '#D32F2F',
      '#0097A7',
      '#607D8B',
      '#AFB42B',
    ];

    this.#DEFAULT_COLOR = '#888888';
  }

  init() {
    const customToggle = document.getElementById('pref-custom-palette');
    customToggle?.addEventListener('change', () => {
      Preferences.savePreferences();
      UI.renderSignalList();
      if (typeof ChartManager !== 'undefined') {
        ChartManager.render();
      }
    });
  }

  getSignalKey(fileName, signalName) {
    return `${fileName}_${signalName}`;
  }

  hasColor(signalName, fileIdx = 0) {
    return !!signalName;
  }

  getColorForSignal(fileIdx, sigIdx) {
    const fIdx = parseInt(fileIdx) || 0;
    const sIdx = parseInt(sigIdx) || 0;

    const file = AppState.files[fIdx];
    if (!file) return this.#DEFAULT_COLOR;

    const signalName = file.availableSignals[sIdx] || `Signal_${sIdx}`;

    return this.#resolveColor(file.name, signalName, fIdx, sIdx);
  }

  getColor(signalName, fileIdx = 0) {
    const file = AppState.files[fileIdx];
    if (!file) return this.#DEFAULT_COLOR;

    const idx = file.availableSignals.indexOf(signalName);

    if (idx !== -1) {
      return this.getColorForSignal(fileIdx, idx);
    }

    return this.#resolveColor(file.name, signalName, fileIdx, 999);
  }

  #resolveColor(fileName, signalName, fIdx, sIdx) {
    const key = this.getSignalKey(fileName, signalName);
    const { useCustomPalette } = Preferences.prefs;
    const customMap = Preferences.customPalette;

    if (useCustomPalette && customMap[key]) {
      return customMap[key];
    }

    if (signalName.startsWith('Math:')) {
      return this.#generateHashColor(signalName);
    }

    const palette = this.#getDefaultChartColors();
    if (sIdx === 999) {
      let hash = 0;
      for (let i = 0; i < signalName.length; i++)
        hash = signalName.charCodeAt(i) + ((hash << 5) - hash);
      return palette[Math.abs(hash) % palette.length];
    }

    const colorIndex = (fIdx * 10 + sIdx) % palette.length;
    return palette[colorIndex];
  }

  #getDefaultChartColors() {
    const isDarkMode = document.body.classList.contains('pref-theme-dark');
    return isDarkMode ? this.#DARK_PALETTE : this.#LIGHT_PALETTE;
  }

  #generateHashColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00ffffff).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
  }
}

export const PaletteManager = new PaletteManagerClass();
