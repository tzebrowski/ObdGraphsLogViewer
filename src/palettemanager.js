import { ChartManager } from './chartmanager.js';
import { Preferences } from './preferences.js';
import { UI } from './ui.js';
import { AppState } from './config.js';

class PaletteManagerClass {
  #DARK_PALETTE;
  #LIGHT_PALETTE;
  #DEFAULT_COLOR;

  // Performance: Cache results to avoid re-calculation and DOM access
  #colorCache;
  #cachedPalette;

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
    this.#colorCache = new Map();
    this.#cachedPalette = null;
  }

  init() {
    const customToggle = document.getElementById('pref-custom-palette');
    customToggle?.addEventListener('change', () => {
      Preferences.savePreferences();
      this.resetCache();
      UI.renderSignalList();
      if (typeof ChartManager !== 'undefined') {
        ChartManager.render();
      }
    });

    // Performance: Observe DOM for theme changes instead of checking classList on every render
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'class') {
          this.resetCache();
          break;
        }
      }
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  resetCache() {
    this.#colorCache.clear();
    this.#cachedPalette = null;
  }

  getSignalKey(fileName, signalName) {
    return `${fileName}_${signalName}`;
  }

  getColorForSignal(fileIdx, sigIdx) {
    const fIdx = parseInt(fileIdx) || 0;
    const sIdx = parseInt(sigIdx) || 0;

    // 1. Check Cache (Fastest Path)
    const cacheKey = `${fIdx}:${sIdx}`;
    if (this.#colorCache.has(cacheKey)) {
      return this.#colorCache.get(cacheKey);
    }

    const file = AppState.files[fIdx];
    if (!file) return this.#DEFAULT_COLOR;

    const signalName = file.availableSignals[sIdx] || `Signal_${sIdx}`;
    const color = this.#resolveColor(file.name, signalName, fIdx, sIdx);

    // 2. Update Cache
    this.#colorCache.set(cacheKey, color);

    return color;
  }

  #resolveColor(fileName, signalName, fIdx, sIdx) {
    const key = this.getSignalKey(fileName, signalName);
    const { useCustomPalette } = Preferences.prefs;

    if (useCustomPalette) {
      const custom = Preferences.customPalette[key];
      if (custom) return custom;
    }

    if (signalName.startsWith('Math:')) {
      return this.#generateHashColor(signalName);
    }

    const palette = this.#getDefaultChartColors();

    // Handle overflow or unknown signals gracefully
    if (sIdx === 999) {
      return this.#generateHashColor(signalName, palette);
    }

    const colorIndex = (fIdx * 10 + sIdx) % palette.length;
    return palette[colorIndex];
  }

  #getDefaultChartColors() {
    // Return cached palette reference if valid
    if (this.#cachedPalette) return this.#cachedPalette;

    // DOM access happens only once per theme change
    const isDarkMode = document.body.classList.contains('pref-theme-dark');
    this.#cachedPalette = isDarkMode ? this.#DARK_PALETTE : this.#LIGHT_PALETTE;
    return this.#cachedPalette;
  }

  #generateHashColor(str, palette = null) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    if (palette) {
      return palette[Math.abs(hash) % palette.length];
    }

    const c = (hash & 0x00ffffff).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
  }
}

export const PaletteManager = new PaletteManagerClass();
