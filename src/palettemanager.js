import { ChartManager } from './chartmanager.js';
import { Preferences } from './preferences.js';
import { UI } from './ui.js';
import { AppState } from './config.js';

class PaletteManagerClass {
  #DARK_PALETTE;
  #LIGHT_PALETTE;
  #DEFAULT_COLOR;
  #colorCache;
  #cachedPalette;
  #mathColorMap;
  #mathColorIndex;

  constructor() {
    this.#DARK_PALETTE = [
      '#FF3366',
      '#00E5FF',
      '#FFCC00',
      '#39FF14',
      '#B026FF',
      '#FF6600',
      '#0066FF',
      '#FF0099',
      '#00FF99',
      '#9900FF',
      '#FFD700',
      '#00BFFF',
      '#FF33CC',
      '#33CC33',
      '#FF5050',
      '#00CC99',
      '#CC33FF',
      '#FFFF33',
      '#3399FF',
      '#FF9933',
      '#66FF66',
      '#CC0066',
      '#00FFFF',
      '#FF99CC',
      '#99FF33',
    ];

    this.#LIGHT_PALETTE = [
      '#D32F2F',
      '#1976D2',
      '#388E3C',
      '#F57C00',
      '#7B1FA2',
      '#0097A7',
      '#C2185B',
      '#689F38',
      '#E64A19',
      '#303F9F',
      '#00796B',
      '#AFB42B',
      '#5D4037',
      '#455A64',
      '#C0CA33',
      '#FBC02D',
      '#FFA000',
      '#F51720',
      '#0288D1',
      '#004D40',
      '#8E24AA',
      '#D81B60',
      '#558B2F',
      '#1565C0',
      '#EF6C00',
    ];

    this.#DEFAULT_COLOR = '#888888';
    this.#colorCache = new Map();
    this.#cachedPalette = null;
    this.#mathColorMap = new Map();
    this.#mathColorIndex = 0;
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
    this.#mathColorMap.clear();
    this.#mathColorIndex = 0;
  }

  getSignalKey(fileName, signalName) {
    return `${fileName}_${signalName}`;
  }

  getColorForSignal(fileIdx, sigIdx) {
    const fIdx = parseInt(fileIdx) || 0;
    const sIdx = parseInt(sigIdx) || 0;

    const cacheKey = `${fIdx}:${sIdx}`;
    if (this.#colorCache.has(cacheKey)) {
      return this.#colorCache.get(cacheKey);
    }

    const file = AppState.files[fIdx];
    if (!file) return this.#DEFAULT_COLOR;

    const signalName = file.availableSignals[sIdx] || `Signal_${sIdx}`;
    const color = this.#resolveColor(file.name, signalName, fIdx, sIdx);

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

    const palette = this.#getDefaultChartColors();

    if (
      sIdx === 999 ||
      signalName.startsWith('Math:') ||
      signalName.includes('Filtered:')
    ) {
      if (!this.#mathColorMap.has(key)) {
        const nextColor = palette[this.#mathColorIndex % palette.length];
        this.#mathColorMap.set(key, nextColor);
        this.#mathColorIndex++;
      }
      return this.#mathColorMap.get(key);
    }

    const colorIndex = (fIdx * 10 + sIdx) % palette.length;
    return palette[colorIndex];
  }

  #getDefaultChartColors() {
    if (this.#cachedPalette) return this.#cachedPalette;

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
