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

test('afterDraw() renders red highlight for active anomaly', () => {
  const mockCtx = {
    save: jest.fn(),
    restore: jest.fn(),
    fillRect: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    setLineDash: jest.fn(),
  };

  const mockChart = {
    ctx: mockCtx,
    chartArea: { top: 10, bottom: 90, left: 10, right: 190 },
    scales: {
      x: {
        // Mock getPixelForValue to return a coordinate within the chartArea
        getPixelForValue: jest.fn((v) => v),
      },
    },
  };

  AppState.chartInstances = [mockChart];
  AppState.files = [{ startTime: 0 }];

  // file.startTime (0) + start (10) * 1000 = 10000.
  // Your current scale mock (v => v) will return 10000, which is OUTSIDE chartArea.right (190).
  // Let's adjust the highlight to fit the scale 1:1 for the test:
  AppState.activeHighlight = {
    start: 0.02, // (0 + 0.02 * 1000) = 20px
    end: 0.05, // (0 + 0.05 * 1000) = 50px
    targetIndex: 0,
  };

  ChartManager.highlighterPlugin.afterDraw(mockChart);

  expect(mockCtx.save).toHaveBeenCalled();
  expect(mockCtx.fillRect).toHaveBeenCalled();
  expect(mockCtx.restore).toHaveBeenCalled();
});

describe('ChartManager Keyboard  Tests', () => {
  test('initKeyboardControls handles ArrowRight to pan the chart', () => {
    const mockChart = {
      width: 1000,
      pan: jest.fn(),
      draw: jest.fn(),
      scales: { x: { min: 100, max: 200 } },
    };

    const canvas = document.createElement('canvas');
    AppState.chartInstances = [mockChart];

    ChartManager.initKeyboardControls(canvas, 0);

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight' });
    canvas.dispatchEvent(event);

    expect(mockChart.pan).toHaveBeenCalledWith({ x: -10 }, undefined, 'none');
  });

  test('initKeyboardControls handles ArrowLeft and zoom keys', () => {
    const canvas = document.createElement('canvas');
    ChartManager.initKeyboardControls(canvas, 0);
    AppState.chartInstances[0] = mockChartInstance;

    mockChartInstance.width = 1000;

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(mockChartInstance.pan).toHaveBeenCalled();

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }));
    expect(mockChartInstance.zoom).toHaveBeenCalledWith(1.1, undefined, 'none');
  });

  test('initKeyboardControls handles - key', () => {
    const canvas = document.createElement('canvas');
    ChartManager.initKeyboardControls(canvas, 0);
    AppState.chartInstances[0] = mockChartInstance;

    mockChartInstance.width = 1000;

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '-' }));
    expect(mockChartInstance.pan).toHaveBeenCalled();
  });

  test('initKeyboardControls handles R key', () => {
    const canvas = document.createElement('canvas');
    ChartManager.initKeyboardControls(canvas, 0);
    AppState.chartInstances[0] = mockChartInstance;

    mockChartInstance.width = 1000;

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    expect(mockChartInstance.pan).toHaveBeenCalled();

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'R' }));
    expect(mockChartInstance.pan).toHaveBeenCalled();
  });

  test('initKeyboardControls handles = key', () => {
    const canvas = document.createElement('canvas');
    ChartManager.initKeyboardControls(canvas, 0);
    AppState.chartInstances[0] = mockChartInstance;

    mockChartInstance.width = 1000;

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '=' }));
    expect(mockChartInstance.zoom).toHaveBeenCalled();
  });
});
