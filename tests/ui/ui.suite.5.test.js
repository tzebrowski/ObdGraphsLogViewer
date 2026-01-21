import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// 1. Mock Dependencies
const mockMessenger = {
  on: jest.fn(),
  emit: jest.fn()
};

const mockAppState = {
  files: [],
  chartInstances: [],
  version: { tag: 'v1.0', repoUrl: 'http://test.url' }
};

const mockPreferences = {
  prefs: { useCustomPalette: false, persistence: false },
  customPalette: {}
};

const mockPaletteManager = {
  getColorForSignal: jest.fn(() => '#ff0000'),
  getSignalKey: jest.fn((f, s) => `${f}:${s}`)
};

const mockChartManager = {
  viewMode: 'stack',
  render: jest.fn()
};

// 2. Register Mocks
await jest.unstable_mockModule('../../src/bus.js', () => ({
  messenger: mockMessenger
}));

await jest.unstable_mockModule('../../src/config.js', () => ({
  AppState: mockAppState,
  DOM: {
    get: jest.fn((id) => document.getElementById(id))
  },
  DEFAULT_SIGNALS: ['Rpm']
}));

await jest.unstable_mockModule('../../src/preferences.js', () => ({
  Preferences: mockPreferences
}));

await jest.unstable_mockModule('../../src/palettemanager.js', () => ({
  PaletteManager: mockPaletteManager
}));

await jest.unstable_mockModule('../../src/chartmanager.js', () => ({
  ChartManager: mockChartManager
}));

await jest.unstable_mockModule('../../src/dataprocessor.js', () => ({
  dataProcessor: {}
}));

await jest.unstable_mockModule('../../src/alert.js', () => ({
  Alert: { showAlert: jest.fn() }
}));

// 3. Import Module Under Test
const { UI } = await import('../../src/ui.js');

describe('UI: Button State & Data Loading', () => {
  let xyBtn, histBtn, container;

  beforeEach(() => {
    // Setup DOM
    document.body.innerHTML = `
      <div id="chartContainer"></div>
      <div id="fileInfo"></div>
      <div id="resizer"></div>
      <div id="sidebar"></div>
      <div id="appVersion"></div>
      
      <button class="xy-btn">XY</button>
      <button title="View Histogram">Hist</button>
    `;

    xyBtn = document.querySelector('.xy-btn');
    histBtn = document.querySelector('button[title="View Histogram"]');
    container = document.getElementById('chartContainer');

    jest.clearAllMocks();
  });

  test('init() should disable analysis buttons by default', () => {
    UI.init();

    expect(xyBtn.disabled).toBe(true);
    expect(xyBtn.style.opacity).toBe('0.5');
    expect(xyBtn.style.cursor).toBe('not-allowed');

    expect(histBtn.disabled).toBe(true);
  });

  test('updateDataLoadedState(true) enables buttons and adds class', () => {
    UI.updateDataLoadedState(true);

    expect(container.classList.contains('has-data')).toBe(true);

    expect(xyBtn.disabled).toBe(false);
    expect(xyBtn.style.opacity).toBe('1');
    expect(xyBtn.style.cursor).toBe('pointer');

    expect(histBtn.disabled).toBe(false);
  });

  test('updateDataLoadedState(false) disables buttons and removes class', () => {
    // First enable them
    UI.updateDataLoadedState(true);
    
    // Then disable
    UI.updateDataLoadedState(false);

    expect(container.classList.contains('has-data')).toBe(false);

    expect(xyBtn.disabled).toBe(true);
    expect(xyBtn.style.opacity).toBe('0.5');
    expect(histBtn.disabled).toBe(true);
  });

  test('Handles missing buttons gracefully', () => {
    // Remove buttons from DOM
    xyBtn.remove();
    histBtn.remove();

    // Should not throw error
    expect(() => UI.updateDataLoadedState(true)).not.toThrow();
  });

  test('Reacts to ui:updateDataLoadedState event', () => {
    UI.init();
    
    // Find the callback registered to the event
    const callback = mockMessenger.on.mock.calls.find(call => call[0] === 'ui:updateDataLoadedState')[1];
    
    // Trigger it with true
    callback({ status: true });
    expect(xyBtn.disabled).toBe(false);

    // Trigger it with false
    callback({ status: false });
    expect(xyBtn.disabled).toBe(true);
  });

  test('Reacts to dataprocessor:batch-load-completed event', () => {
    UI.init();

    // Simulate batch load completion
    mockAppState.files = [{}, {}]; // 2 files
    const callback = mockMessenger.on.mock.calls.find(call => call[0] === 'dataprocessor:batch-load-completed')[1];
    
    callback();

    // Should enable UI
    expect(xyBtn.disabled).toBe(false);
    // Should update file info text
    expect(document.getElementById('fileInfo').innerText).toBe('2 logs loaded');
  });
});