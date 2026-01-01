export const Preferences = {
  PREFS_KEY: 'giulia_user_prefs',

  defaultPrefs: {
    persistence: true,
    performance: false,
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
  },

  loadPreferences: () => {
    const saved = localStorage.getItem(Preferences.PREFS_KEY);
    const prefs = saved ? JSON.parse(saved) : Preferences.defaultPrefs;

    document.getElementById('pref-persistence').checked = prefs.persistence;
    document.getElementById('pref-performance').checked = prefs.performance;

    return prefs;
  },

  savePreferences: () => {
    const prefs = {
      persistence: document.getElementById('pref-persistence').checked,
      performance: document.getElementById('pref-performance').checked,
    };
    localStorage.setItem(Preferences.PREFS_KEY, JSON.stringify(prefs));

    if (!prefs.persistence) {
      localStorage.removeItem('sidebar_collapsed_states');
    }
  },
};
