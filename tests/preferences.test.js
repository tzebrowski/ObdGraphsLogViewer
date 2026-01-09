import { jest, describe, test, expect, beforeEach } from '@jest/globals';

import { Preferences } from '../src/preferences.js';
import { UI } from '../src/ui.js';

UI.setTheme = jest.fn();

describe('Preferences Module', () => {
  beforeEach(() => {
    // 2. Set up the DOM structure expected by Preferences
    document.body.innerHTML = `
      <div class="preferences-list">
        <input type="checkbox" id="pref-persistence" />
        <input type="checkbox" id="pref-performance" />
        <input type="checkbox" id="pref-theme-dark" />
        <input type="checkbox" id="pref-custom-palette" />
      </div>
    `;
    localStorage.clear();
    jest.clearAllMocks();
  });

  test('get prefs returns defaults when localStorage is empty', () => {
    expect(Preferences.prefs).toEqual(Preferences.defaultPrefs);
  });

  test('customPalette handles invalid JSON gracefully (line 30)', () => {
    localStorage.setItem(Preferences.PALETTE_KEY, 'invalid-json');
    expect(Preferences.customPalette).toEqual({});
  });

  test('set customPalette saves or removes data', () => {
    const colors = { brand: '#ff0000' };
    Preferences.customPalette = colors;
    expect(JSON.parse(localStorage.getItem(Preferences.PALETTE_KEY))).toEqual(
      colors
    );

    Preferences.customPalette = null;
    expect(localStorage.getItem(Preferences.PALETTE_KEY)).toBeNull();
  });

  test('init sets theme and attaches listeners', () => {
    // 1. Setup localStorage so loadPreferences() sees the dark theme as active
    localStorage.setItem(
      Preferences.PREFS_KEY,
      JSON.stringify({
        ...Preferences.defaultPrefs,
        darkTheme: true,
      })
    );

    const themeToggle = document.getElementById('pref-theme-dark');

    // 2. Run init
    Preferences.init();

    // Now it should be checked because loadPreferences() set it
    expect(themeToggle.checked).toBe(true);
    // And UI.setTheme should be called with 'dark'
    expect(UI.setTheme).toHaveBeenCalledWith('dark');

    // 3. Test the toggle listener
    themeToggle.checked = false;
    themeToggle.dispatchEvent(new Event('change'));

    expect(UI.setTheme).toHaveBeenCalledWith('light');
  });

  test('loadPreferences updates DOM elements correctly', () => {
    const savedData = {
      persistence: false,
      performance: true,
      darkTheme: true,
      useCustomPalette: true,
    };
    localStorage.setItem(Preferences.PREFS_KEY, JSON.stringify(savedData));

    Preferences.loadPreferences();

    expect(document.getElementById('pref-performance').checked).toBe(true);
    expect(document.getElementById('pref-persistence').checked).toBe(false);
  });

  test('savePreferences stores correct state and handles persistence logic', () => {
    document.getElementById('pref-persistence').checked = false;
    document.getElementById('pref-performance').checked = true;

    localStorage.setItem('sidebar_collapsed_states', 'some-state');

    Preferences.savePreferences();

    const stored = JSON.parse(localStorage.getItem(Preferences.PREFS_KEY));
    expect(stored.performance).toBe(true);
    expect(localStorage.getItem('sidebar_collapsed_states')).toBeNull();
  });
});
