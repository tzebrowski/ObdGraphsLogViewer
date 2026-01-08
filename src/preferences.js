import { UI } from './ui.js';

/**
 * Preferences Module
 * Manages user settings, persistence logic, and theme synchronization.
 */
export const Preferences = {
  PREFS_KEY: 'giulia_user_prefs',
  PALETTE_KEY: 'giulia_chart_palette',
  SIDEBAR_STATE_KEY: 'sidebar_collapsed_states',

  PREF_MAP: {
    'pref-persistence': 'persistence',
    'pref-performance': 'performance',
    'pref-theme-dark': 'darkTheme',
    'pref-custom-palette': 'useCustomPalette',
  },

  defaultPrefs: {
    persistence: true,
    performance: false,
    darkTheme: false,
    useCustomPalette: false,
  },

  get prefs() {
    const saved = localStorage.getItem(this.PREFS_KEY);
    return this._safeJsonParse(saved, this.defaultPrefs);
  },

  set prefs(newPrefs) {
    localStorage.setItem(this.PREFS_KEY, JSON.stringify(newPrefs));
    if (!newPrefs.persistence) {
      localStorage.removeItem(this.SIDEBAR_STATE_KEY);
    }
  },

  get customPalette() {
    const saved = localStorage.getItem(this.PALETTE_KEY);
    return this._safeJsonParse(saved, {});
  },

  set customPalette(colors) {
    if (colors && Object.keys(colors).length > 0) {
      localStorage.setItem(this.PALETTE_KEY, JSON.stringify(colors));
    } else {
      localStorage.removeItem(this.PALETTE_KEY);
    }
  },

  init() {
    const currentPrefs = this.loadPreferences();
    this._setupEventListeners();
    this._syncTheme(currentPrefs.darkTheme);
  },

  /**
   * Reads from storage and updates the DOM elements.
   */
  loadPreferences() {
    const prefs = this.prefs;
    Object.entries(this.PREF_MAP).forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el) el.checked = prefs[key];
    });
    return prefs;
  },

  /**
   * Scans DOM elements and updates storage.
   */
  savePreferences() {
    const newPrefs = {};
    Object.entries(this.PREF_MAP).forEach(([id, key]) => {
      const el = document.getElementById(id);
      newPrefs[key] = el ? el.checked : this.defaultPrefs[key];
    });

    this.prefs = newPrefs; // Triggers the setter and persistence logic
    this._syncTheme(newPrefs.darkTheme);
  },

  // --- Internal Helpers ---

  _setupEventListeners() {
    // Listen for changes on all registered preference inputs
    Object.keys(this.PREF_MAP).forEach((id) => {
      const el = document.getElementById(id);
      el?.addEventListener('change', () => this.savePreferences());
    });
  },

  _syncTheme(isDark) {
    UI.setTheme(isDark ? 'dark' : 'light');
  },

  _safeJsonParse(str, fallback) {
    try {
      return str ? JSON.parse(str) : fallback;
    } catch (e) {
      console.error('Preferences: Failed to parse storage data', e);
      return fallback;
    }
  },
};
