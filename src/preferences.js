import { UI } from './ui.js';

export const Preferences = {
  PREFS_KEY: 'giulia_user_prefs',
  PALETTE_KEY: 'giulia_chart_palette',

  defaultPrefs: {
    persistence: true,
    performance: false,
    darkTheme: false,
    useCustomPalette: false,
  },

  get prefs() {
    return (
      JSON.parse(localStorage.getItem(Preferences.PREFS_KEY)) ||
      Preferences.defaultPrefs
    );
  },

  get customPalette() {
    const saved = localStorage.getItem(Preferences.PALETTE_KEY);
    return saved ? JSON.parse(saved) : null;
  },

  set customPalette(colors) {
    if (colors) {
      localStorage.setItem(Preferences.PALETTE_KEY, JSON.stringify(colors));
    } else {
      localStorage.removeItem(Preferences.PALETTE_KEY);
    }
  },

  init: () => {
    Preferences.loadPreferences();

    document.querySelectorAll('.preferences-list input').forEach((input) => {
      input.addEventListener('change', Preferences.savePreferences);
    });

    const themeToggle = document.getElementById('pref-theme-dark');
    if (themeToggle?.checked) {
      UI.setTheme('dark');
    } else {
      UI.setTheme('light');
    }

    themeToggle?.addEventListener('change', () => {
      UI.setTheme(themeToggle.checked ? 'dark' : 'light');
      Preferences.savePreferences();
    });
  },

  loadPreferences: () => {
    const saved = localStorage.getItem(Preferences.PREFS_KEY);
    const prefs = saved ? JSON.parse(saved) : Preferences.defaultPrefs;

    const ids = {
      'pref-persistence': 'persistence',
      'pref-performance': 'performance',
      'pref-theme-dark': 'darkTheme',
      'pref-custom-palette': 'useCustomPalette',
    };

    Object.entries(ids).forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el) el.checked = prefs[key];
    });

    return prefs;
  },

  savePreferences: () => {
    const prefs = {
      persistence: document.getElementById('pref-persistence').checked,
      performance: document.getElementById('pref-performance').checked,
      darkTheme: document.getElementById('pref-theme-dark').checked,
      useCustomPalette: document.getElementById('pref-custom-palette').checked,
    };
    localStorage.setItem(Preferences.PREFS_KEY, JSON.stringify(prefs));

    if (!prefs.persistence) {
      localStorage.removeItem('sidebar_collapsed_states');
    }
  },
};
