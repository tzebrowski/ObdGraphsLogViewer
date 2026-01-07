import { jest, describe, test, expect, beforeEach } from '@jest/globals';

import { PaletteManager } from '../src/palettemanager.js';
import { Preferences } from '../src/preferences.js';
import { UI } from '../src/ui.js';
import { ChartManager } from '../src/chartmanager.js';
import { AppState } from '../src/config.js';

UI.setLoading = jest.fn();
UI.renderSignalList = jest.fn();
UI.updateDataLoadedState = jest.fn();
UI.setTheme = jest.fn();
ChartManager.render = jest.fn();
AppState.files = jest.fn();
Preferences.savePreferences = jest.fn();

describe('PaletteManager', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<input type="checkbox" id="pref-custom-palette" />';
    document.body.classList.remove('pref-theme-dark');
    jest.clearAllMocks();
  });

  test('getColorForSignal returns default gray if file does not exist', () => {
    AppState.files = []; // Ensure empty
    const color = PaletteManager.getColorForSignal(0, 0);
    expect(color).toBe('#888888');
  });

  test('getColorForSignal returns custom color when enabled and exists', () => {
    // Setup AppState
    AppState.files = [
      {
        name: 'log.csv',
        availableSignals: ['RPM'],
      },
    ];

    // Mock Preferences to return "useCustomPalette: true"
    const key = PaletteManager.getSignalKey('log.csv', 'RPM');

    Object.defineProperty(Preferences, 'prefs', {
      get: jest.fn(() => ({ useCustomPalette: true })),
      configurable: true, // allows us to change it again in other tests
    });

    Preferences.customPalette = { [key]: '#FF00FF' };

    const color = PaletteManager.getColorForSignal(0, 0);
    expect(color).toBe('#FF00FF');
  });

  test('getDefaultChartColors switches based on body class', () => {
    // Test Light Mode (Default)
    expect(PaletteManager.getDefaultChartColors()).toEqual(
      PaletteManager.CHART_COLORS_LIGHT
    );

    // Test Dark Mode
    document.body.classList.add('pref-theme-dark');
    expect(PaletteManager.getDefaultChartColors()).toEqual(
      PaletteManager.CHART_COLORS
    );
  });

  test('getColorForSignal uses theme palette when custom is disabled', () => {
    AppState.files = [
      {
        name: 'log.csv',
        availableSignals: ['RPM'],
      },
    ];

    // Use defineProperty to mock the return value of the getter
    Object.defineProperty(Preferences, 'prefs', {
      get: jest.fn(() => ({ useCustomPalette: false })),
      configurable: true, // allows us to change it again in other tests
    });

    const color = PaletteManager.getColorForSignal(0, 0);
    expect(color).toBe(PaletteManager.CHART_COLORS_LIGHT[0]);
  });

  test('init attaches change listener to custom palette toggle', () => {
    PaletteManager.init();
    const toggle = document.getElementById('pref-custom-palette');

    // Simulate changing the toggle
    toggle.dispatchEvent(new Event('change'));

    // These will now work because they are explicitly defined as jest.fn()
    expect(Preferences.savePreferences).toHaveBeenCalled();
    expect(UI.renderSignalList).toHaveBeenCalled();
    expect(ChartManager.render).toHaveBeenCalled();
  });

  test('init does not crash if ChartManager is undefined', () => {
    const originalChartManager = global.ChartManager;
    delete global.ChartManager; // Simulate it being missing

    PaletteManager.init();
    const toggle = document.getElementById('pref-custom-palette');

    expect(() => {
      toggle.dispatchEvent(new Event('change'));
    }).not.toThrow();

    global.ChartManager = originalChartManager; // Restore it
  });
});
