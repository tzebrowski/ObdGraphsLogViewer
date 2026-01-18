import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockChartInstance = {
  destroy: jest.fn(),
  update: jest.fn(),
  draw: jest.fn(),
  resetZoom: jest.fn(),
  pan: jest.fn(),
  zoom: jest.fn(),
  width: 1000,
  scales: { x: { min: 0, max: 1000, getValueForPixel: jest.fn() } },
  data: { datasets: [] },
  options: {
    plugins: { datalabels: {}, zoom: {}, tooltip: { callbacks: {} } },
    scales: { x: { min: 0, max: 0 } },
  },
  ctx: { save: jest.fn(), restore: jest.fn() },
};

await jest.unstable_mockModule('chart.js', () => {
  const MockChart = jest.fn(() => mockChartInstance);
  MockChart.register = jest.fn();
  return {
    __esModule: true,
    Chart: MockChart,
    LineController: jest.fn(),
    LineElement: jest.fn(),
    PointElement: jest.fn(),
    LinearScale: jest.fn(),
    LogarithmicScale: jest.fn(),
    TimeScale: jest.fn(),
    Title: jest.fn(),
    Tooltip: jest.fn(),
    Legend: jest.fn(),
    Filler: jest.fn(),
  };
});

await jest.unstable_mockModule('chartjs-plugin-datalabels', () => ({
  __esModule: true,
  default: {},
}));
await jest.unstable_mockModule('chartjs-adapter-date-fns', () => ({
  __esModule: true,
}));
await jest.unstable_mockModule('chartjs-plugin-zoom', () => ({
  __esModule: true,
  default: {},
}));
await jest.unstable_mockModule('hammerjs', () => ({
  __esModule: true,
  default: jest.fn(),
}));

await jest.unstable_mockModule('../../src/config.js', () => ({
  AppState: { files: [], chartInstances: [] },
  DOM: { get: jest.fn() },
  DEFAULT_SIGNALS: [],
}));

await jest.unstable_mockModule('../../src/ui.js', () => ({
  UI: { updateDataLoadedState: jest.fn(), renderSignalList: jest.fn() },
}));

await jest.unstable_mockModule('../../src/palettemanager.js', () => ({
  PaletteManager: { getColorForSignal: jest.fn(() => '#ff0000') },
}));

await jest.unstable_mockModule('../../src/preferences.js', () => ({
  Preferences: { prefs: { showAreaFills: false } },
}));

await jest.unstable_mockModule('../../src/bus.js', () => ({
  messenger: { on: jest.fn() },
}));

const { ChartManager } = await import('../../src/chartmanager.js');
const { AppState, DOM } = await import('../../src/config.js');
const { Chart } = await import('chart.js');

describe('ChartManager Overlay & View Mode Tests', () => {
  let container;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset AppState
    AppState.files = [];
    AppState.chartInstances = [];
    ChartManager.viewMode = 'stack'; // Reset default

    // Setup DOM
    document.body.innerHTML = `
      <div id="chartContainer"></div>
      <button id="btn-mode-stack" class="view-mode-btn active"></button>
      <button id="btn-mode-overlay" class="view-mode-btn"></button>
      
      <div id="signalList">
        <input type="checkbox" data-key="RPM" data-file-idx="0" checked>
      </div>
    `;

    container = document.getElementById('chartContainer');
    DOM.get.mockReturnValue(container);
  });

  describe('toggleViewMode', () => {
    test('switches viewMode and updates button classes', () => {
      ChartManager.toggleViewMode('overlay');

      expect(ChartManager.viewMode).toBe('overlay');
      expect(
        document.getElementById('btn-mode-overlay').classList.contains('active')
      ).toBe(true);
      expect(
        document.getElementById('btn-mode-stack').classList.contains('active')
      ).toBe(false);
    });

    test('triggers render() when mode changes', () => {
      const renderSpy = jest.spyOn(ChartManager, 'render');
      ChartManager.toggleViewMode('overlay');
      expect(renderSpy).toHaveBeenCalled();
      renderSpy.mockRestore();
    });

    test('does nothing if mode is already set', () => {
      ChartManager.viewMode = 'stack';
      const renderSpy = jest.spyOn(ChartManager, 'render');

      ChartManager.toggleViewMode('stack');

      expect(renderSpy).not.toHaveBeenCalled();
      renderSpy.mockRestore();
    });
  });

  describe('_renderOverlayMode', () => {
    const file1 = {
      name: 'log1.json',
      startTime: 1000,
      duration: 10,
      availableSignals: ['RPM'],
      signals: {
        RPM: [
          { x: 1000, y: 100 },
          { x: 2000, y: 200 },
        ],
      },
    };

    const file2 = {
      name: 'log2.json',
      startTime: 5000, // Starts later
      duration: 15,
      availableSignals: ['RPM'],
      signals: {
        RPM: [
          { x: 5000, y: 300 },
          { x: 6000, y: 400 },
        ],
      },
    };

    test('creates a single chart canvas for multiple files', () => {
      AppState.files = [file1, file2];
      ChartManager.viewMode = 'overlay';

      ChartManager.render();

      const canvas = container.querySelector('canvas');
      expect(canvas).not.toBeNull();
      expect(canvas.id).toBe('chart-overlay');

      // Should create exactly 1 chart instance
      expect(Chart).toHaveBeenCalledTimes(1);
      expect(AppState.chartInstances.length).toBe(1);
    });

    test('aggregates datasets from all files into one config', () => {
      AppState.files = [file1, file2];
      ChartManager.viewMode = 'overlay';

      ChartManager.render();

      const config = Chart.mock.calls[0][1];
      const datasets = config.data.datasets;

      expect(datasets).toHaveLength(2); // 1 signal * 2 files
      expect(datasets[0].label).toContain('log1');
      expect(datasets[1].label).toContain('log2');
    });

    test('normalizes time (X-axis) relative to baseStartTime', () => {
      AppState.files = [file1, file2];
      ChartManager.viewMode = 'overlay';

      ChartManager.render();

      const config = Chart.mock.calls[0][1];
      const ds1 = config.data.datasets[0];
      const ds2 = config.data.datasets[1];

      // File 1 (Base): 1000 -> 1000 (Relative 0 if base is 1000)
      // Actually logic is: baseStartTime + (p.x - fileStart)
      // File 1: 1000 + (1000 - 1000) = 1000
      // File 1: 1000 + (2000 - 1000) = 2000

      // File 2: 5000 -> Should map to relative 0 start
      // Logic: 1000 + (5000 - 5000) = 1000
      // Logic: 1000 + (6000 - 5000) = 2000

      expect(ds1.data[0].x).toBe(1000);
      expect(ds2.data[0].x).toBe(1000); // Should align with start
    });

    test('applies visual distinction (dashed lines) for secondary files', () => {
      AppState.files = [file1, file2];
      ChartManager.viewMode = 'overlay';

      ChartManager.render();

      const config = Chart.mock.calls[0][1];

      // First file - solid line (undefined dash)
      expect(config.data.datasets[0].borderDash).toBeUndefined();

      // Second file - dashed line
      expect(config.data.datasets[1].borderDash).toEqual([5, 5]);
    });

    test('initializes specific overlay options (tooltips, scales)', () => {
      AppState.files = [file1];
      ChartManager.viewMode = 'overlay';
      ChartManager.render();

      const config = Chart.mock.calls[0][1];

      // Interaction mode should be 'index' to show all signals at once
      expect(config.options.interaction.mode).toBe('index');

      // Tooltip title callback should exist
      const titleCb = config.options.plugins.tooltip.callbacks.title;
      expect(titleCb).toBeDefined();
    });

    test('attaches keyboard controls to the single canvas', () => {
      const spy = jest.spyOn(ChartManager, 'initKeyboardControls');
      AppState.files = [file1];
      ChartManager.viewMode = 'overlay';

      ChartManager.render();

      const canvas = container.querySelector('#chart-overlay');
      expect(spy).toHaveBeenCalledWith(canvas, 0);
    });
  });
});
