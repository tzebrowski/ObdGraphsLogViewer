import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';

import { PaletteManager } from '../src/palettemanager.js';
import { Preferences } from '../src/preferences.js';
import { UI } from '../src/ui.js';
import { ChartManager } from '../src/chartmanager.js';
import { AppState } from '../src/config.js';

// --- Expected Palettes (Private in class, replicated here for assertions) ---
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

// --- Mocks ---
UI.setLoading = jest.fn();
UI.renderSignalList = jest.fn();
UI.updateDataLoadedState = jest.fn();
ChartManager.render = jest.fn();
AppState.files = jest.fn();
Preferences.savePreferences = jest.fn();

// Mock MutationObserver globally
const mockObserverInstance = {
  observe: jest.fn(),
  disconnect: jest.fn(),
  trigger: null, // Custom helper to trigger callback manually
};

global.MutationObserver = class {
  constructor(callback) {
    this.callback = callback;
    mockObserverInstance.trigger = (mutations) => callback(mutations);
  }
  observe(element, options) {
    mockObserverInstance.observe(element, options);
  }
  disconnect() {
    mockObserverInstance.disconnect();
  }
};

describe('PaletteManager', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<input type="checkbox" id="pref-custom-palette" />';
    document.body.className = ''; // Reset theme
    jest.clearAllMocks();
    PaletteManager.resetCache(); // Ensure clean state for singleton

    // Default AppState
    AppState.files = [
      {
        name: 'log.csv',
        availableSignals: ['RPM', 'Speed', 'Math: Boost'],
      },
    ];

    // Default Preferences
    Object.defineProperty(Preferences, 'prefs', {
      get: jest.fn(() => ({ useCustomPalette: false })),
      configurable: true,
    });
    Preferences.customPalette = {};
  });

  describe('Basic Color Resolution', () => {
    test('returns default color if file does not exist', () => {
      AppState.files = [];
      const color = PaletteManager.getColorForSignal(0, 0);
      expect(color).toBe('#888888');
    });

    test('returns correct Light Mode color by default', () => {
      const color = PaletteManager.getColorForSignal(0, 0);
      expect(color).toBe(EXPECTED_LIGHT_PALETTE[0]);
    });

    test('returns correct Dark Mode color', () => {
      document.body.classList.add('pref-theme-dark');
      // Reset cache because we changed theme manually before first call logic test
      PaletteManager.resetCache();

      const color = PaletteManager.getColorForSignal(0, 0);
      expect(color).toBe(EXPECTED_DARK_PALETTE[0]);
    });

    test('cycles through palette when index exceeds length', () => {
      const len = EXPECTED_LIGHT_PALETTE.length;
      // Request index equal to length (should wrap to 0)
      const color = PaletteManager.getColorForSignal(0, len);
      expect(color).toBe(EXPECTED_LIGHT_PALETTE[0]);

      // Request index equal to length + 1 (should be 1)
      const color2 = PaletteManager.getColorForSignal(0, len + 1);
      expect(color2).toBe(EXPECTED_LIGHT_PALETTE[1]);
    });
  });

  describe('Performance & Caching', () => {
    test('caches color result and returns cached value on subsequent calls', () => {
      // 1. First call - Light Mode
      const color1 = PaletteManager.getColorForSignal(0, 0);
      expect(color1).toBe(EXPECTED_LIGHT_PALETTE[0]);

      // 2. Change DOM to Dark Mode MANUALLY (bypassing observer)
      document.body.classList.add('pref-theme-dark');

      // 3. Second call - Should still return Light color because it's cached
      const color2 = PaletteManager.getColorForSignal(0, 0);
      expect(color2).toBe(EXPECTED_LIGHT_PALETTE[0]); // Cache Hit!

      // 4. Force reset
      PaletteManager.resetCache();

      // 5. Third call - Should now calculate Dark color
      const color3 = PaletteManager.getColorForSignal(0, 0);
      expect(color3).toBe(EXPECTED_DARK_PALETTE[0]);
    });
  });

  describe('Theme Observer', () => {
    test('init sets up MutationObserver', () => {
      PaletteManager.init();
      expect(mockObserverInstance.observe).toHaveBeenCalledWith(document.body, {
        attributes: true,
        attributeFilter: ['class'],
      });
    });

    test('observer callback clears cache on class change', () => {
      PaletteManager.init();

      // 1. Populate cache (Light mode)
      const col1 = PaletteManager.getColorForSignal(0, 0);
      expect(col1).toBe(EXPECTED_LIGHT_PALETTE[0]);

      // 2. Simulate Theme Change
      document.body.classList.add('pref-theme-dark');

      // 3. Trigger Observer Callback
      mockObserverInstance.trigger([{ attributeName: 'class' }]);

      // 4. Next call should return Dark color (proving cache was cleared)
      const col2 = PaletteManager.getColorForSignal(0, 0);
      expect(col2).toBe(EXPECTED_DARK_PALETTE[0]);
    });

    test('observer ignores non-class attribute changes', () => {
      PaletteManager.init();
      const col1 = PaletteManager.getColorForSignal(0, 0);

      // Trigger irrelevant mutation
      mockObserverInstance.trigger([{ attributeName: 'style' }]);

      // Even if we changed theme in DOM, cache shouldn't clear if observer ignores it
      document.body.classList.add('pref-theme-dark');

      const col2 = PaletteManager.getColorForSignal(0, 0);
      expect(col2).toBe(EXPECTED_LIGHT_PALETTE[0]); // Cache persists
    });
  });

  describe('Special Signal Types', () => {
    test('Math channels generate consistent hash colors', () => {
      const mathSignalIdx = 2; // defined in beforeEach as 'Math: Boost'

      const color1 = PaletteManager.getColorForSignal(0, mathSignalIdx);
      const color2 = PaletteManager.getColorForSignal(0, mathSignalIdx);

      expect(color1).toMatch(/^#[0-9A-F]{6}$/i); // Hex format
      expect(color1).toBe(color2); // Deterministic

      // Ensure it doesn't just pick from the standard index-based logic
      // Standard index 2 is #C2185B in Light Palette.
      // Hash likely differs.
      // (This assertion depends on hash implementation, mainly checking it runs separate logic)
    });

    test('Index 999 (Overflow/Unknown) generates hash from palette', () => {
      const color = PaletteManager.getColorForSignal(0, 999);
      // Logic: hash string -> modulo palette length -> pick from palette
      expect(EXPECTED_LIGHT_PALETTE).toContain(color);
    });
  });

  describe('Custom Palette', () => {
    test('returns custom color when preference enabled', () => {
      // Mock Preference ON
      Object.defineProperty(Preferences, 'prefs', {
        get: jest.fn(() => ({ useCustomPalette: true })),
        configurable: true,
      });

      // Set custom color
      const key = PaletteManager.getSignalKey('log.csv', 'RPM');
      Preferences.customPalette = { [key]: '#123456' };

      const color = PaletteManager.getColorForSignal(0, 0); // RPM is index 0
      expect(color).toBe('#123456');
    });

    test('listener updates UI on toggle', () => {
      PaletteManager.init();
      const toggle = document.getElementById('pref-custom-palette');

      toggle.dispatchEvent(new Event('change'));

      expect(Preferences.savePreferences).toHaveBeenCalled();
      expect(UI.renderSignalList).toHaveBeenCalled();
      expect(ChartManager.render).toHaveBeenCalled();
    });
  });

  describe('Utils', () => {
    test('getSignalKey formats correctly', () => {
      expect(PaletteManager.getSignalKey('file1', 'sig1')).toBe('file1_sig1');
    });

    test('init safe when ChartManager missing', () => {
      const originalCM = global.ChartManager;
      delete global.ChartManager;

      PaletteManager.init();
      const toggle = document.getElementById('pref-custom-palette');
      expect(() => toggle.dispatchEvent(new Event('change'))).not.toThrow();

      global.ChartManager = originalCM;
    });
  });
});
