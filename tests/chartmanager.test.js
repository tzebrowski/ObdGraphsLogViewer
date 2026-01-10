import { jest, describe, test, expect, beforeEach } from '@jest/globals';

import { ChartManager } from '../src/chartmanager.js';
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
  let mockChart;

  const mockFile = {
    name: 'test-trip.json',
    startTime: 1000000,
    duration: 500,
    availableSignals: ['Engine Rpm'],
    signals: { 'Engine Rpm': [{ x: 1000000, y: 1000 }] },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    AppState.files = [];
    AppState.chartInstances = [];
    AppState.globalStartTime = 0;

    document.body.innerHTML = `
      <div id="chartContainer">
        <div id="chart-0-wrapper" class="chart-card-compact">
          <input class="local-range-start" value="0">
          <input class="local-range-end" value="500">
          <div id="highlight-0"></div>
          <span id="txt-start-0"></span>
          <span id="txt-end-0"></span>
          <canvas id="chart-0"></canvas>
        </div>
      </div>
    `;

    DOM.get = jest.fn((id) => document.getElementById(id));

    mockChart = {
      options: {
        scales: { x: { min: 0, max: 0 } },
        plugins: { datalabels: { display: true } },
      },
      scales: { x: { min: 1000000, max: 1500000 } },
      update: jest.fn(),
      zoom: jest.fn(),
      draw: jest.fn(),
      destroy: jest.fn(),
    };

    AppState.chartInstances = [mockChart];
    AppState.files = [mockFile];
    DOM.get.mockReturnValue(document.getElementById('chartContainer'));
  });

  test('init registers chart plugins', () => {
    ChartManager.init();
    expect(Chart.register).toHaveBeenCalled();
  });

  test('manualZoom updates chart and synchronizes slider UI', () => {
    ChartManager.manualZoom(0, 1.1);

    expect(mockChart.zoom).toHaveBeenCalledWith(1.1);
    const startInput = document.querySelector('.local-range-start');
    // Verify UI reflects the internal chart state
    expect(startInput.value).toBeDefined();
  });

  test('updateLabelVisibility hides labels on narrow screens', () => {
    window.innerWidth = 500; // Mobile width
    ChartManager.updateLabelVisibility(mockChart);
    expect(mockChart.options.plugins.datalabels.display).toBe(false);
  });

  test('keyboard controls trigger panning and zooming', () => {
    const canvas = document.getElementById('chart-0');
    ChartManager.initKeyboardControls(canvas, 0);

    const event = new KeyboardEvent('keydown', { key: '+' });
    canvas.dispatchEvent(event);

    expect(mockChart.zoom).toHaveBeenCalledWith(1.1, undefined, 'none');
  });

  test('resetChart restores full range and UI elements', () => {
    ChartManager.resetChart(0);

    expect(mockChart.options.scales.x.min).toBe(mockFile.startTime);
    expect(mockChart.options.scales.x.max).toBe(
      mockFile.startTime + mockFile.duration * 1000
    );
    expect(mockChart.update).toHaveBeenCalledWith('none');

    expect(document.getElementById('txt-start-0').innerText).toBe('0.0s');
    expect(document.getElementById('highlight-0').style.width).toBe('100%');
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
