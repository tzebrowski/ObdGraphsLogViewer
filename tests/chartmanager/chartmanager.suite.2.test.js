import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockChartInstance = {
  destroy: jest.fn(),
  update: jest.fn(),
  draw: jest.fn(),
  resetZoom: jest.fn(),
  pan: jest.fn(),
  zoom: jest.fn(),
  width: 1000,
  scales: {
    x: {
      min: 0,
      max: 1000,
      getValueForPixel: jest.fn(),
      getPixelForValue: jest.fn(),
    },
  },
  data: { datasets: [] },
  options: {
    plugins: { datalabels: {}, zoom: {}, tooltip: { callbacks: {} } },
    scales: { x: { min: 0, max: 0 } },
  },
  ctx: {
    save: jest.fn(),
    restore: jest.fn(),
    fillRect: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    setLineDash: jest.fn(),
  },
  chartArea: { top: 10, bottom: 90, left: 10, right: 190 },
  tooltip: { getActiveElements: jest.fn(() => []) },
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

await jest.unstable_mockModule('hammerjs', () => ({ default: jest.fn() }));
await jest.unstable_mockModule('chartjs-plugin-datalabels', () => ({
  default: {},
}));
await jest.unstable_mockModule('chartjs-adapter-date-fns', () => ({}));
await jest.unstable_mockModule('chartjs-plugin-zoom', () => ({ default: {} }));

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
  Preferences: { prefs: { showAreaFills: true } },
}));

// --- 3. Tests ---
const mockBus = { on: jest.fn() };
await jest.unstable_mockModule('../../src/bus.js', () => ({
  messenger: mockBus,
}));

const { ChartManager } = await import('../../src/chartmanager.js');
const { AppState, DOM } = await import('../../src/config.js');
const { Chart } = await import('chart.js');

describe('ChartManager: Interactions & UI Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AppState.files = [];
    AppState.chartInstances = [];
    ChartManager.viewMode = 'stack';
    ChartManager.activeChartIndex = null;
    ChartManager.hoverValue = null;

    document.body.innerHTML = `<div id="chartContainer"></div>`;
    DOM.get.mockReturnValue(document.getElementById('chartContainer'));
  });

  describe('Event Bus tests', () => {
    test('registers dataprocessor:batch-load-completed listener', () => {
      ChartManager.init();
      expect(mockBus.on).toHaveBeenCalledWith(
        'dataprocessor:batch-load-completed',
        expect.any(Function)
      );

      // Trigger the callback to ensure it calls render
      const callback = mockBus.on.mock.calls.find(
        (call) => call[0] === 'dataprocessor:batch-load-completed'
      )[1];
      const renderSpy = jest
        .spyOn(ChartManager, 'render')
        .mockImplementation(() => {});
      callback();
      expect(renderSpy).toHaveBeenCalled();
      renderSpy.mockRestore();
    });
  });

  describe('Slider Logic tests', () => {
    test('updates chart when local slider inputs change', () => {
      const mockFile = {
        name: 'f1',
        duration: 100,
        startTime: 1000,
        availableSignals: [],
        signals: {},
      };
      AppState.files = [mockFile];

      // Render to create DOM elements
      ChartManager.render();

      // Mock the instance
      AppState.chartInstances = [mockChartInstance];

      const container = document.getElementById('chartContainer');
      const startInput = container.querySelector('.local-range-start');
      const endInput = container.querySelector('.local-range-end');

      // Test Valid Input
      startInput.value = '10';
      startInput.dispatchEvent(new Event('input'));

      expect(mockChartInstance.options.scales.x.min).toBe(1000 + 10 * 1000);
      expect(mockChartInstance.update).toHaveBeenCalledWith('none');
    });

    test('swaps values if start > end  tests', () => {
      const mockFile = {
        name: 'f1',
        duration: 100,
        startTime: 1000,
        availableSignals: [],
        signals: {},
      };
      AppState.files = [mockFile];
      ChartManager.render();
      AppState.chartInstances = [mockChartInstance];

      const container = document.getElementById('chartContainer');
      const startInput = container.querySelector('.local-range-start');
      const endInput = container.querySelector('.local-range-end');

      // Set start > end
      startInput.value = '80';
      endInput.value = '20';

      startInput.dispatchEvent(new Event('input'));

      // Logic swaps them: min should be based on 20, max on 80
      expect(mockChartInstance.options.scales.x.min).toBe(1000 + 20 * 1000);
      expect(mockChartInstance.options.scales.x.max).toBe(1000 + 80 * 1000);
    });
  });

  describe('Smart Update tests', () => {
    test('performs smart update on existing charts', () => {
      const mockFile = {
        name: 'f1',
        availableSignals: ['A'],
        signals: { A: [] },
      };
      AppState.files = [mockFile];
      AppState.chartInstances = [mockChartInstance];

      // Ensure data structure matches what _performSmartUpdate expects
      mockChartInstance.data.datasets = [{ borderColor: '#000000' }];

      ChartManager._performSmartUpdate();

      // Should have updated color and called update
      expect(mockChartInstance.update).toHaveBeenCalledWith('none');
      // PaletteManager default mock returns red
      expect(mockChartInstance.data.datasets[0].borderColor).toBe('#ff0000');
    });

    test('_canPerformSmartUpdate returns true only when conditions match', () => {
      ChartManager.viewMode = 'overlay';
      expect(ChartManager._canPerformSmartUpdate()).toBe(false);

      ChartManager.viewMode = 'stack';
      AppState.files = [{}, {}];
      AppState.chartInstances = [{}]; // Length mismatch
      expect(ChartManager._canPerformSmartUpdate()).toBe(false);

      AppState.chartInstances = [{}, {}]; // Length match
      expect(ChartManager._canPerformSmartUpdate()).toBe(true);
    });
  });

  describe('Keyboard Controls tests', () => {
    let canvas;
    beforeEach(() => {
      const mockFile = {
        name: 'f1',
        duration: 100,
        startTime: 1000,
        availableSignals: [],
        signals: {},
      };
      AppState.files = [mockFile];
      ChartManager.render();
      AppState.chartInstances = [mockChartInstance];
      canvas = document.querySelector('canvas');
    });

    test('handles Pan Keys', () => {
      // ArrowRight
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(mockChartInstance.pan).toHaveBeenCalledWith(
        expect.objectContaining({ x: expect.any(Number) }),
        undefined,
        'none'
      );

      // ArrowLeft
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      expect(mockChartInstance.pan).toHaveBeenCalledTimes(2);
    });

    test('handles Zoom Keys', () => {
      // Zoom In (+)
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }));
      expect(mockChartInstance.zoom).toHaveBeenCalledWith(
        1.1,
        undefined,
        'none'
      );

      // Zoom Out (-)
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '-' }));
      expect(mockChartInstance.zoom).toHaveBeenCalledWith(
        0.9,
        undefined,
        'none'
      );
    });

    test('handles Reset Key (R)', () => {
      const resetSpy = jest.spyOn(ChartManager, 'resetChart');
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
      expect(resetSpy).toHaveBeenCalled();
    });
  });

  describe('Utilities tests', () => {
    test('getAlphaColor handles valid hex', () => {
      const res = ChartManager.getAlphaColor('#ff0000', 0.5);
      expect(res).toBe('rgba(255, 0, 0, 0.5)');
    });

    test('getAlphaColor handles non-string input', () => {
      const res = ChartManager.getAlphaColor(null);
      expect(res).toContain('rgba(128,128,128');
    });

    test('updateLabelVisibility hides labels on small screens', () => {
      // Mock Window width
      window.innerWidth = 500;

      // Mock chart options structure
      mockChartInstance.options.plugins.datalabels = { display: true };

      ChartManager.updateLabelVisibility(mockChartInstance);

      expect(mockChartInstance.options.plugins.datalabels.display).toBe(false);
      expect(mockChartInstance.update).toHaveBeenCalledWith('none');
    });
  });

  describe('Highlighter Plugin tests', () => {
    beforeEach(() => {
      AppState.files = [{ startTime: 1000, duration: 10 }];
      AppState.chartInstances = [mockChartInstance];
      // Default chartArea mocks
      mockChartInstance.chartArea = {
        top: 0,
        bottom: 100,
        left: 0,
        right: 100,
      };
      mockChartInstance.scales.x.getPixelForValue.mockReturnValue(50);
    });

    test('Draws anomaly highlight box tests', () => {
      // Setup Anomaly Highlight State
      AppState.activeHighlight = { start: 0, end: 5, targetIndex: 0 };

      ChartManager.highlighterPlugin.afterDraw(mockChartInstance);

      expect(mockChartInstance.ctx.fillStyle).toBe('rgba(255, 0, 0, 0.08)');
      expect(mockChartInstance.ctx.fillRect).toHaveBeenCalled();
    });

    test('Draws snapped tooltip line tests', () => {
      // Setup Active Tooltip State
      mockChartInstance.tooltip.getActiveElements.mockReturnValue([
        { element: { x: 50 } },
      ]);
      ChartManager.hoverValue = null; // Ensure we rely on tooltip, not hoverValue

      ChartManager.highlighterPlugin.afterDraw(mockChartInstance);

      expect(mockChartInstance.ctx.setLineDash).toHaveBeenCalledWith([5, 5]);
      expect(mockChartInstance.ctx.strokeStyle).toBe('rgba(227, 24, 55, 0.6)');
      expect(mockChartInstance.ctx.stroke).toHaveBeenCalled();
    });

    test('Draws mouse hover line when no tooltip tests', () => {
      // Setup Hover State
      mockChartInstance.tooltip.getActiveElements.mockReturnValue([]);
      ChartManager.activeChartIndex = 0;
      ChartManager.hoverValue = 1005; // Valid value

      ChartManager.highlighterPlugin.afterDraw(mockChartInstance);

      expect(mockChartInstance.ctx.strokeStyle).toBe('rgba(154, 0, 0, 0.3)');
      expect(mockChartInstance.ctx.stroke).toHaveBeenCalled();
    });

    test('Does NOT draw hover line if index mismatch', () => {
      ChartManager.activeChartIndex = 99; // Mismatch
      ChartManager.highlighterPlugin.afterDraw(mockChartInstance);
      expect(mockChartInstance.ctx.stroke).not.toHaveBeenCalled();
    });
  });
});
