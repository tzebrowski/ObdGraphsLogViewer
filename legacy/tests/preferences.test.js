import { jest, describe, test, expect, beforeEach } from '@jest/globals';

await jest.unstable_mockModule('../src/ui.js', () => ({
  UI: {
    setTheme: jest.fn(),
  },
}));

const { Preferences } = await import('../src/preferences.js');
const { UI } = await import('../src/ui.js');

describe('Preferences Module', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="preferences-list">
        <input type="checkbox" id="pref-persistence" />
        <input type="checkbox" id="pref-performance" />
        <input type="checkbox" id="pref-theme-dark" />
        <input type="checkbox" id="pref-custom-palette" />
        <input type="checkbox" id="pref-remember-files" />
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
    localStorage.setItem(
      Preferences.PREFS_KEY,
      JSON.stringify({
        ...Preferences.defaultPrefs,
        darkTheme: true,
      })
    );

    const themeToggle = document.getElementById('pref-theme-dark');

    Preferences.init();

    expect(themeToggle.checked).toBe(true);
    expect(UI.setTheme).toHaveBeenCalledWith('dark');

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
