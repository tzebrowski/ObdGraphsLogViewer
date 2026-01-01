import { UI } from './ui.js';

export const Preferences = {
  PREFS_KEY: 'giulia_user_prefs',

  defaultPrefs: {
    persistence: true,
    performance: false,
    darkTheme: false,
  },

  get prefs() {
    return (
      JSON.parse(localStorage.getItem(Preferences.PREFS_KEY)) ||
      Preferences.defaultPrefs
    );
  },

  init: () => {
    Preferences.loadPreferences();

    document.querySelectorAll('.preferences-list input').forEach((input) => {
      input.addEventListener('change', Preferences.savePreferences);
    });

    const themeToggle = document.getElementById('pref-theme-dark');
    if (themeToggle.checked) {
      UI.setTheme('dark');
    } else {
      UI.setTheme('light');
    }

    themeToggle?.addEventListener('change', () => {
      if (themeToggle.checked) {
        UI.setTheme('dark');
      } else {
        UI.setTheme('light');
      }
      Preferences.savePreferences();
    });
  },

  loadPreferences: () => {
    const saved = localStorage.getItem(Preferences.PREFS_KEY);
    const prefs = saved ? JSON.parse(saved) : Preferences.defaultPrefs;

    document.getElementById('pref-persistence').checked = prefs.persistence;
    document.getElementById('pref-performance').checked = prefs.performance;
    document.getElementById('pref-theme-dark').checked = prefs.darkTheme;
    return prefs;
  },

  savePreferences: () => {
    const prefs = {
      persistence: document.getElementById('pref-persistence').checked,
      performance: document.getElementById('pref-performance').checked,
      darkTheme: document.getElementById('pref-theme-dark').checked,
    };
    localStorage.setItem(Preferences.PREFS_KEY, JSON.stringify(prefs));

    if (!prefs.persistence) {
      localStorage.removeItem('sidebar_collapsed_states');
    }
  },
};
