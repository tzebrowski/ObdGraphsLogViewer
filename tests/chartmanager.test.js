import { jest, describe, test, expect, beforeEach } from '@jest/globals';

import { ChartManager, Sliders } from '../src/chartmanager.js';
import { AppState, DOM } from '../src/config.js';
import { UI } from '../src/ui.js';
import { PaletteManager } from '../src/palettemanager.js';
import { Chart } from 'chart.js';

UI.updateDataLoadedState = jest.fn();
UI.renderSignalList = jest.fn();
PaletteManager.getColorForSignal = jest.fn(() => '#ff0000');

Chart.register = jest.fn();
const mockChartInstance = {
  destroy: jest.fn(),
  update: jest.fn(),
  draw: jest.fn(),
  zoom: jest.fn(),
  pan: jest.fn(),
  scales: { x: { min: 0, max: 1000, getValueForPixel: jest.fn() } },
  data: { datasets: [] },
  options: {
    plugins: { datalabels: {}, zoom: {} },
    scales: { x: { min: 0, max: 0 } },
  },
};

describe('ChartManager Module Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset AppState
    AppState.files = [];
    AppState.chartInstances = [];
    AppState.globalStartTime = 0;

    // Setup JSDOM
    document.body.innerHTML = `
      <div id="chartContainer"></div>
      <input type="range" id="rangeStart" />
      <input type="range" id="rangeEnd" />
      <span id="txtStart"></span>
      <span id="txtEnd"></span>
      <div id="sliderHighlight"></div>
    `;

    DOM.get = jest.fn((id) => document.getElementById(id));
  });

  test('render() handles empty file list correctly', () => {
    AppState.files = [];
    ChartManager.render();

    expect(UI.updateDataLoadedState).toHaveBeenCalledWith(false);
    expect(AppState.globalStartTime).toBe(0);
  });

  test('render() creates card and canvas for uploaded files', () => {
    AppState.files = [
      {
        name: 'test_log.json',
        startTime: 1000,
        duration: 10,
        availableSignals: ['RPM'],
        signals: { RPM: [] },
      },
    ];

    // Mock the Chart constructor locally for this test
    const chartSpy = jest
      .spyOn(Chart.prototype, 'constructor')
      .mockImplementation(() => mockChartInstance);

    ChartManager.render();

    const container = document.getElementById('chartContainer');
    expect(container.querySelector('.chart-card-compact')).not.toBeNull();
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  test('removeFile() clears indices and updates state', () => {
    AppState.files = [
      {
        name: 'file1',
        availableSignals: ['RPM'],
        signals: { RPM: [] },
        startTime: 1000,
        duration: 10,
      },
    ];

    const mockCanvas = document.createElement('canvas');
    mockCanvas.id = 'chart-0';

    jest.spyOn(Chart.prototype, 'constructor').mockImplementation(() => ({
      destroy: jest.fn(),
      update: jest.fn(),
      options: { scales: { x: {} }, plugins: { datalabels: {} } },
    }));

    ChartManager.removeFile(0);

    expect(AppState.files).toHaveLength(0);
    expect(UI.updateDataLoadedState).toHaveBeenCalledWith(false);
  });
});

describe('Sliders Module Tests', () => {
  test('updateVis() updates text and bar styles', () => {
    const startEl = document.getElementById('rangeStart');
    if (startEl) startEl.max = 100;

    Sliders.updateVis(20, 50);

    expect(document.getElementById('txtStart').innerText).toBe('20.0s');
    expect(document.getElementById('sliderHighlight').style.left).toBe('20%');
    expect(document.getElementById('sliderHighlight').style.width).toBe('30%');
  });
});
