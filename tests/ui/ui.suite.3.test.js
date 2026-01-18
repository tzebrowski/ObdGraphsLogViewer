import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { UI } from '../../src/ui.js';
import { AppState, DOM } from '../../src/config.js';
import { PaletteManager } from '../../src/palettemanager.js';

describe('UI Module Tests', () => {
  beforeEach(() => {
    // 1. Setup the minimal DOM required for ui.js elements
    document.body.innerHTML = `
      <div id="sidebar"></div>
      <div id="resizer"></div>
      <div id="loadingOverlay" style="display: none;">
        <span id="loadingText"></span>
        <button id="cancelLoadBtn"></button>
      </div>
      <div id="signalList"></div>
      <div id="chartContainer"></div>
      <div id="mainContent"></div>
    `;

    // 2. Mock external dependencies manually
    AppState.files = [];
    AppState.chartInstances = [];
    DOM.get = jest.fn((id) => document.getElementById(id));
    PaletteManager.getColorForSignal = jest.fn(() => '#ff0000');
    PaletteManager.getSignalKey = jest.fn((f, s) => `${f}-${s}`);
  });

  test('setLoading() updates visibility and text', () => {
    UI.setLoading(true, 'Parsing Logs...');

    const overlay = document.getElementById('loadingOverlay');
    const text = document.getElementById('loadingText');

    expect(overlay.style.display).toBe('flex');
    expect(text.innerText).toBe('Parsing Logs...');
  });

  test('updateDataLoadedState() toggles CSS class on chartContainer', () => {
    const container = document.getElementById('chartContainer');

    UI.updateDataLoadedState(true);
    expect(container.classList.contains('has-data')).toBe(true);

    UI.updateDataLoadedState(false);
    expect(container.classList.contains('has-data')).toBe(false);
  });

  test('renderSignalList() handles search filtering', () => {
    // Populate AppState with a dummy file and signal
    AppState.files = [
      {
        name: 'log1.json',
        availableSignals: ['RPM', 'Speed'],
      },
    ];

    UI.renderSignalList();

    const searchInput = document.getElementById('signalSearchInput');
    const signalItems = document.querySelectorAll('.signal-item');

    // Simulate searching for "RPM"
    searchInput.value = 'rpm';
    searchInput.dispatchEvent(new Event('input'));

    // Verify visibility logic (covers lines 320-335)
    expect(signalItems[0].style.display).toBe('flex'); // RPM matches
    expect(signalItems[1].style.display).toBe('none'); // Speed hidden
  });

  test('initResizer() sets up mouse listeners', () => {
    UI.initResizer();
    const resizer = document.getElementById('resizer');

    // Trigger mousedown to cover line 95
    resizer.dispatchEvent(new MouseEvent('mousedown'));
    expect(document.body.style.cursor).toBe('col-resize');

    // Trigger mousemove to cover lines 102-110
    const moveEvent = new MouseEvent('mousemove', { clientX: 300 });
    document.dispatchEvent(moveEvent);
    expect(document.getElementById('sidebar').style.width).toBe('300px');
  });
});
