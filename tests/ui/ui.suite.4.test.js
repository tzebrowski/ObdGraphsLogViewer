import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { UI } from '../../src/ui.js';
import { AppState, DOM } from '../../src/config.js';

describe('UI Module - Toggle tests', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="sidebar"></div>
      <div id="mainContent"></div>
      <div id="signalList"></div>
      <div id="chartContainer"></div>
      <div id="loadingOverlay">
        <span id="loadingText"></span>
        <button id="cancelLoadBtn"></button>
      </div>
      <div class="sidebar-backdrop"></div>
    `;
    AppState.chartInstances = [];
    DOM.get = jest.fn((id) => document.getElementById(id));
    jest.clearAllMocks();
  });

  test('toggleSidebar handles desktop collapse and mobile active states', () => {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.querySelector('.sidebar-backdrop');

    // Desktop mode (> 768px)
    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      writable: true,
    });
    UI.toggleSidebar();
    expect(sidebar.classList.contains('collapsed')).toBe(true);

    // Mobile mode (<= 768px)
    Object.defineProperty(window, 'innerWidth', { value: 375, writable: true });
    UI.toggleSidebar();
    expect(sidebar.classList.contains('active')).toBe(true);
    expect(backdrop.classList.contains('active')).toBe(true);
  });

  test('toggleFullScreen logs error on rejection', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const content = document.getElementById('mainContent');

    // Force a rejection to trigger the .catch() block
    content.requestFullscreen = jest
      .fn()
      .mockRejectedValue(new Error('Permission Denied'));

    UI.toggleFullScreen();

    // Use a small delay for the promise catch block to execute
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error attempting to enable full-screen mode')
    );
    consoleSpy.mockRestore();
  });

  test('toggleFileSignals updates inputs and chart visibility', () => {
    const signalList = document.getElementById('signalList');
    signalList.innerHTML = `
      <input type="checkbox" data-file-idx="0" checked>
      <input type="checkbox" data-file-idx="0" checked>
    `;

    const mockChart = {
      data: { datasets: [{ hidden: false }, { hidden: false }] },
      update: jest.fn(),
    };
    AppState.chartInstances[0] = mockChart;

    UI.toggleFileSignals(0, false);

    const inputs = signalList.querySelectorAll('input');
    expect(inputs[0].checked).toBe(false);
    expect(mockChart.data.datasets[0].hidden).toBe(true);
    expect(mockChart.update).toHaveBeenCalled();
  });

  test('toggleAllSignals updates all charts', () => {
    const signalList = document.getElementById('signalList');
    signalList.innerHTML = `<input type="checkbox" checked>`;

    const mockChart = {
      data: { datasets: [{ hidden: false }] },
      update: jest.fn(),
    };
    AppState.chartInstances = [mockChart];

    UI.toggleAllSignals(false);

    expect(signalList.querySelector('input').checked).toBe(false);
    expect(mockChart.data.datasets[0].hidden).toBe(true);
    expect(mockChart.update).toHaveBeenCalled();
  });

  test('UI methods handle missing elements gracefully', () => {
    document.body.innerHTML = ''; // Empty DOM

    // These should not throw even if elements are missing
    expect(() => UI.updateDataLoadedState(true)).not.toThrow();
    expect(() => UI.toggleItem('nonexistent')).not.toThrow();
    expect(() => UI.setLoading(true)).not.toThrow();
    expect(() => UI.resetScannerUI()).not.toThrow();
  });
});
