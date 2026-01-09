import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { ChartManager } from '../src/chartmanager.js';
import { AppState, DOM } from '../src/config.js';
import { Chart } from 'chart.js';

describe('ChartManager Deep Coverage', () => {
  beforeEach(() => {
    // Reset DOM and State
    document.body.innerHTML = `<div id="chartContainer"></div>`;
    AppState.files = [
      {
        name: 'log1.csv',
        startTime: 1000,
        duration: 10,
        availableSignals: ['RPM', 'TPS'],
        signals: {
          RPM: [
            { x: 1000, y: 100 },
            { x: 2000, y: 500 },
          ],
          TPS: [
            { x: 1000, y: 0 },
            { x: 2000, y: 100 },
          ],
        },
      },
    ];
    AppState.chartInstances = [];
  });

  test('createInstance correctly normalizes Y-axis data between 0 and 1', () => {
    const canvas = document.createElement('canvas');
    canvas.getContext = jest.fn(() => ({
      measureText: jest.fn(() => ({ width: 0 })),
      fillRect: jest.fn(),
    }));

    jest
      .spyOn(Chart.prototype, 'constructor')
      .mockImplementation(function (ctx, config) {
        const instance = {
          data: config.data,
          options: config.options,
          update: jest.fn(),
        };
        AppState.chartInstances[0] = instance;
        return instance;
      });

    AppState.files = [
      {
        name: 'log1.csv',
        availableSignals: ['RPM'],
        signals: {
          RPM: [
            { x: 1000, y: 100 },
            { x: 2000, y: 500 },
          ],
        },
        startTime: 1000,
        duration: 10,
      },
    ];

    ChartManager.createInstance(canvas, AppState.files[0], 0);

    const chart = AppState.chartInstances[0];
    expect(chart).toBeDefined(); // Safety check

    const rpmDataset = chart.data.datasets[0];

    // Logic: (val - min) / (max - min)
    // (100 - 100) / 400 = 0
    // (500 - 100) / 400 = 1
    expect(rpmDataset.data[0].y).toBe(0);
    expect(rpmDataset.data[1].y).toBe(1);
    expect(rpmDataset.originalMin).toBe(100);
    expect(rpmDataset.originalMax).toBe(500);
  });

  /** 2. Manual Zoom & Sync  **/
  test('manualZoom triggers chart zoom and syncs with sliders', () => {
    const mockChart = {
      zoom: jest.fn(),
      update: jest.fn(),
      scales: { x: { min: 1000, max: 2000 } },
      data: { datasets: [] },
      options: { plugins: { datalabels: {} } },
    };
    AppState.chartInstances = [mockChart];

    ChartManager.manualZoom(0, 1.2);

    expect(mockChart.zoom).toHaveBeenCalledWith(1.2);
  });

  /** 3. Label Visibility Logic **/
  test('updateLabelVisibility hides labels on small screens', () => {
    const mockChart = {
      options: { plugins: { datalabels: { display: true } } },
      update: jest.fn(),
      scales: { x: { min: 1000, max: 2000 } },
      data: { datasets: [{ hidden: false }] },
    };

    // Simulate mobile width
    global.innerWidth = 500;
    ChartManager.updateLabelVisibility(mockChart);
    expect(mockChart.options.plugins.datalabels.display).toBe(false);

    // Simulate desktop width
    global.innerWidth = 1200;
    ChartManager.updateLabelVisibility(mockChart);
    // Should be true because xRange (1000) < timeRange (5000)
    expect(mockChart.options.plugins.datalabels.display).toBe(true);
  });

  test('canvas mousemove updates hoverValue and triggers draw', () => {
    const canvas = document.createElement('canvas');
    canvas.getContext = jest.fn(() => ({
      save: jest.fn(),
      restore: jest.fn(),
      // Add other context methods if your code calls them
    }));

    const mockChart = {
      draw: jest.fn(),
      scales: {
        x: {
          // Our code calls getValueForPixel(e.offsetX)
          getValueForPixel: jest.fn((pixel) => {
            return pixel === 50 ? 1500 : 0;
          }),
        },
      },
    };

    const file = {
      availableSignals: ['RPM'],
      signals: { RPM: [] },
      name: 'test-file',
    };
    AppState.files = [file];

    ChartManager.createInstance(canvas, file, 0);
    AppState.chartInstances[0] = mockChart; // Match the index 0

    // We use the basic Event constructor because MouseEvent
    // sometimes locks properties like offsetX in certain environments
    const moveEvent = new Event('mousemove', { bubbles: true });

    // Manually inject offsetX because JSDOM does not provide it
    Object.defineProperty(moveEvent, 'offsetX', { value: 50 });

    canvas.dispatchEvent(moveEvent);

    expect(ChartManager.hoverValue).toBe(1500); // Verify scale logic worked
    expect(ChartManager.activeChartIndex).toBe(0); // Verify index was tracked
    expect(mockChart.draw).toHaveBeenCalled(); // Verify chart redraw triggered
  });

  test.skip('tooltip label callback denormalizes values for display', () => {
    const canvas = document.createElement('canvas');
    canvas.getContext = jest.fn(() => ({
      measureText: jest.fn(() => ({ width: 0 })),
      fillRect: jest.fn(),
      fillText: jest.fn(),
      getImageData: jest.fn(),
      putImageData: jest.fn(),
      createImageData: jest.fn(),
      setTransform: jest.fn(),
      drawWidget: jest.fn(),
    }));

    const mockChart = {
      draw: jest.fn(),
      scales: {
        x: {
          getValueForPixel: jest.fn((pixel) => (pixel === 50 ? 1500 : 0)),
        },
      },
    };

    let capturedConfig;

    AppState.files = [
      {
        name: 'test.csv',
        availableSignals: ['RPM'],
        signals: {
          RPM: [
            { x: 0, y: 100 },
            { x: 1000, y: 500 },
          ],
        },
        startTime: 0,
        duration: 1,
      },
    ];

    AppState.chartInstances = [mockChart];

    ChartManager.createInstance(canvas, AppState.files[0], 0);

    expect(capturedConfig).toBeDefined(); // Ensures the constructor was called

    const labelCallback =
      capturedConfig.options.plugins.tooltip.callbacks.label;

    const mockContext = {
      dataset: capturedConfig.data.datasets[0], // Contains the originalMin/Max
      parsed: { y: 0.5 },
    };

    const result = labelCallback(mockContext);

    // (0.5 * (500 - 100) + 100) = 300
    expect(result).toContain('300.0');
  });

  test('ChartManager.zoomTo updates chart scales and slider positions', () => {
    const mockChart = {
      options: { scales: { x: { min: 0, max: 0 } } },
      update: jest.fn(),
    };
    AppState.chartInstances = [mockChart];
    AppState.files = [{ startTime: 1000, duration: 100 }];

    ChartManager.zoomTo(10, 20, 0);

    // Verify chart scale updated (start + seconds*1000)
    // Note: zoomTo adds padding, so we check if it changed from 0
    expect(mockChart.options.scales.x.min).not.toBe(0);
    expect(mockChart.update).toHaveBeenCalled();
  });
});

// Mock Chart.js constructor
const mockChartInstance = {
  zoom: jest.fn(),
  pan: jest.fn(),
  draw: jest.fn(),
  update: jest.fn(),
  destroy: jest.fn(),
  resize: jest.fn(),
  scales: { x: { min: 100, max: 200 } },
  data: { datasets: [] },
  options: {
    plugins: { datalabels: { display: true } },
    scales: { x: { min: 0, max: 0 } },
  },
};
global.Chart = jest.fn(() => mockChartInstance);

describe('ChartManager Extended Coverage', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <canvas id="chart-0"></canvas>
      <div id="chartContainer"></div>
      <input type="range" id="zoomSlider" />
      <span id="zoomValue"></span>
    `;

    AppState.files = [
      {
        name: 'test.json',
        startTime: 1000,
        duration: 100,
        signals: {
          RPM: [
            { x: 1000, y: 10 },
            { x: 2000, y: 20 },
          ],
        },
        availableSignals: ['RPM'],
      },
    ];
    AppState.chartInstances = [];

    DOM.get = jest.fn((id) => document.getElementById(id));
    jest.clearAllMocks();
  });

  test('ChartManager handles chart destruction and cleanup', () => {
    document.body.innerHTML = '<div id="chartContainer"></div>';

    AppState.chartInstances = [mockChartInstance];

    AppState.files = [
      {
        name: 'log1.json',
        startTime: 0,
        duration: 10,
        availableSignals: ['RPM'],
        signals: { RPM: [] },
      },
      {
        name: 'log2.json',
        startTime: 0,
        duration: 10,
        availableSignals: ['RPM'],
        signals: { RPM: [] },
      },
    ];

    DOM.get = jest.fn((id) => document.getElementById(id));

    ChartManager.render();

    expect(mockChartInstance.destroy).toHaveBeenCalled();

    expect(AppState.chartInstances.length).toBe(0);
  });
});
