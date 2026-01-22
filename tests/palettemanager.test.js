import { jest, describe, test, expect, beforeEach } from '@jest/globals';

import { PaletteManager } from '../src/palettemanager.js';
import { Preferences } from '../src/preferences.js';
import { UI } from '../src/ui.js';
import { ChartManager } from '../src/chartmanager.js';
import { AppState } from '../src/config.js';

// --- Replicate the palettes here for testing comparison ---
// We cannot access them from the instance anymore because they are private (#)
const EXPECTED_DARK_PALETTE = [
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

const EXPECTED_LIGHT_PALETTE = [
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

  test('returns correct color from active palette based on body theme', () => {
    // Setup AppState so we can get a color
    AppState.files = [{ name: 'log.csv', availableSignals: ['SignalA'] }];

    Object.defineProperty(Preferences, 'prefs', {
      get: jest.fn(() => ({ useCustomPalette: false })),
      configurable: true,
    });

    // 1. Test Light Mode (Default)
    document.body.classList.remove('pref-theme-dark');
    const lightColor = PaletteManager.getColorForSignal(0, 0);
    // Should match the first color of the Light Palette
    expect(lightColor).toBe(EXPECTED_LIGHT_PALETTE[0]);

    // 2. Test Dark Mode
    document.body.classList.add('pref-theme-dark');
    const darkColor = PaletteManager.getColorForSignal(0, 0);
    // Should match the first color of the Dark Palette
    expect(darkColor).toBe(EXPECTED_DARK_PALETTE[0]);
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
    // Compare against our local constant instead of the private class field
    expect(color).toBe(EXPECTED_LIGHT_PALETTE[0]);
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
