export const Preferences = {
  PREFS_KEY: 'giulia_user_prefs',

  defaultPrefs: {
    persistence: true,
    performance: false,
  },

  init: () => {
    const currentPrefs = Preferences.loadPreferences();

    document.querySelectorAll('.preferences-list input').forEach((input) => {
      input.addEventListener('change', Preferences.savePreferences);
    });

    document.getElementById('sidebar').addEventListener('click', (e) => {
      const header = e.target.closest('h3');
      if (header && !e.target.classList.contains('config-link')) {
        const group = header.closest('.control-group');
        group.classList.toggle('collapsed');

        const prefs =
          JSON.parse(localStorage.getItem(Preferences.PREFS_KEY)) ||
          Preferences.defaultPrefs;
        if (prefs.persistence) {
          console.error(`!!!!!!!!!!!!!!!!!!!! ${prefs}`);
          //saveSidebarState(); // Your existing function
        }
      }
    });
  },

  // Load and Apply Preferences
  loadPreferences: () => {
    const saved = localStorage.getItem(Preferences.PREFS_KEY);
    const prefs = saved ? JSON.parse(saved) : Preferences.defaultPrefs;

    // Update UI Toggles
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
