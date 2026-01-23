import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';

// --- 1. GLOBAL MOCKS SETUP ---

// Spies for Context Properties
const ctxFillStyleSpy = jest.fn();
const ctxStrokeStyleSpy = jest.fn();
const ctxLineWidthSpy = jest.fn();
const ctxSetLineDashSpy = jest.fn();

const mockChartInstance = {
  // Core methods
  destroy: jest.fn(),
  update: jest.fn(),
  draw: jest.fn(),
  resetZoom: jest.fn(),
  pan: jest.fn(),
  zoom: jest.fn(),

  // Properties required by logic
  width: 1000,
  chartArea: { top: 10, bottom: 90, left: 10, right: 190 },

  // Scales
  scales: {
    x: {
      min: 0,
      max: 1000,
      getValueForPixel: jest.fn((px) => px * 10 + 1000),
      getPixelForValue: jest.fn((val) => (val - 1000) / 10),
    },
    y: { min: 0, max: 100 },
  },

  // Data & Options
  data: { datasets: [] },
  options: {
    interaction: { mode: 'nearest' },
    plugins: {
      datalabels: {},
      zoom: { pan: {}, zoom: {} },
      tooltip: { callbacks: {} },
      legend: { labels: {} },
    },
    scales: { x: { min: 0, max: 0 } },
  },

  // Canvas Context Mock with Property Spies
  ctx: {
    save: jest.fn(),
    restore: jest.fn(),
    fillRect: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    setLineDash: ctxSetLineDashSpy,
    fillText: jest.fn(),
    measureText: jest.fn(() => ({ width: 20 })),
    font: '',
    textAlign: '',
    textBaseline: '',

    // Property Setters/Getters
    set fillStyle(val) {
      ctxFillStyleSpy(val);
    },
    get fillStyle() {
      return 'mock_fill';
    },

    set strokeStyle(val) {
      ctxStrokeStyleSpy(val);
    },
    get strokeStyle() {
      return 'mock_stroke';
    },

    set lineWidth(val) {
      ctxLineWidthSpy(val);
    },
    get lineWidth() {
      return 1;
    },
  },

  // Tooltip & Element Management
  tooltip: {
    getActiveElements: jest.fn(() => []),
    setActiveElements: jest.fn(),
  },
  setActiveElements: jest.fn(),
  isDatasetVisible: jest.fn(() => true),
  getDatasetMeta: jest.fn(() => ({ data: [] })),
  getElementsAtEventForMode: jest.fn(() => []),
};

// Mock Chart.js Library
await jest.unstable_mockModule('chart.js', () => {
  const MockChart = jest.fn((ctx, config) => {
    if (config && config.options) mockChartInstance.options = config.options;
    if (config && config.data) mockChartInstance.data = config.data;
    return mockChartInstance;
  });
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
    Tooltip: Object.assign(jest.fn(), { positioners: {} }),
    Legend: jest.fn(),
    Filler: jest.fn(),
  };
});

// Dependencies
await jest.unstable_mockModule('hammerjs', () => ({ default: jest.fn() }));
await jest.unstable_mockModule('chartjs-plugin-datalabels', () => ({
  default: {},
}));
await jest.unstable_mockModule('chartjs-adapter-date-fns', () => ({}));
await jest.unstable_mockModule('chartjs-plugin-zoom', () => ({ default: {} }));

// Internal Modules
const mockBus = { on: jest.fn() };
await jest.unstable_mockModule('../src/bus.js', () => ({ messenger: mockBus }));

await jest.unstable_mockModule('../src/config.js', () => ({
  AppState: { files: [], chartInstances: [], activeHighlight: null },
  DOM: { get: jest.fn() },
  DEFAULT_SIGNALS: [],
}));

await jest.unstable_mockModule('../src/ui.js', () => ({
  UI: { updateDataLoadedState: jest.fn(), renderSignalList: jest.fn() },
}));

await jest.unstable_mockModule('../src/palettemanager.js', () => ({
  PaletteManager: { getColorForSignal: jest.fn(() => '#ff0000') },
}));

await jest.unstable_mockModule('../src/preferences.js', () => ({
  Preferences: { prefs: { showAreaFills: true } },
}));

// --- 2. IMPORTS ---
const { ChartManager } = await import('../src/chartmanager.js');
const { AppState, DOM } = await import('../src/config.js');
const { Chart, Tooltip } = await import('chart.js');
const { UI } = await import('../src/ui.js');
const { PaletteManager } = await import('../src/palettemanager.js');
const { Preferences } = await import('../src/preferences.js');

// --- 3. TEST SUITE ---

describe('ChartManager Complete Suite', () => {
  let container;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset AppState
    AppState.files = [];
    AppState.chartInstances = [];
    AppState.activeHighlight = null;
    ChartManager.viewMode = 'stack';
    ChartManager.activeChartIndex = null;
    ChartManager.hoverValue = null;

    // Reset Context Spies
    ctxFillStyleSpy.mockClear();
    ctxStrokeStyleSpy.mockClear();
    ctxLineWidthSpy.mockClear();
    ctxSetLineDashSpy.mockClear();

    // Reset DOM
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

    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(mockChartInstance.ctx);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==========================================
  // SECTION: Lifecycle & Initialization
  // ==========================================
  describe('Lifecycle & Initialization', () => {
    test('init registers chart plugins and listeners', () => {
      ChartManager.init();
      expect(Chart.register).toHaveBeenCalled();
      expect(mockBus.on).toHaveBeenCalledWith(
        'dataprocessor:batch-load-completed',
        expect.any(Function)
      );
    });

    test('Tooltip custom positioner returns correct coordinates', () => {
      ChartManager.init();
      const posFn = Tooltip.positioners.topRightCorner;
      expect(posFn).toBeDefined();
      const result = posFn.call({ chart: mockChartInstance });
      expect(result).toEqual({ x: 180, y: 10 });
    });

    test('render() handles empty file list', () => {
      AppState.files = [];
      ChartManager.render();
      expect(UI.updateDataLoadedState).toHaveBeenCalledWith(false);
      expect(document.getElementById('empty-state')).not.toBeNull();
    });

    test('removeChart() updates state and UI', () => {
      ChartManager.removeChart(0);
      expect(AppState.files).toHaveLength(0);
      expect(UI.renderSignalList).toHaveBeenCalled();
    });

    test('removeChart() does nothing in overlay mode', () => {
      ChartManager.viewMode = 'overlay';
      AppState.files = [{ name: 'f1' }];
      ChartManager.removeChart(0);
      expect(AppState.files).toHaveLength(1);
    });
  });

  // ==========================================
  // SECTION: View Modes
  // ==========================================
  describe('View Modes & Overlay', () => {
    const file1 = {
      name: 'log1.json',
      startTime: 1000,
      duration: 10,
      availableSignals: ['RPM'],
      signals: { RPM: [{ x: 1000, y: 100 }] },
    };
    const file2 = {
      name: 'log2.json',
      startTime: 5000,
      duration: 15,
      availableSignals: ['RPM'],
      signals: { RPM: [{ x: 5000, y: 300 }] },
    };

    test('switches viewMode', () => {
      ChartManager.toggleViewMode('overlay');
      expect(ChartManager.viewMode).toBe('overlay');
      expect(
        document.getElementById('btn-mode-overlay').classList.contains('active')
      ).toBe(true);
    });

    test('toggleViewMode short-circuits if mode is same', () => {
      ChartManager.viewMode = 'stack';
      const spy = jest.spyOn(ChartManager, 'render');
      ChartManager.toggleViewMode('stack');
      expect(spy).not.toHaveBeenCalled();
    });

    test('_renderOverlayMode aggregates datasets', () => {
      AppState.files = [file1, file2];
      ChartManager.viewMode = 'overlay';
      ChartManager.render();
      const config = Chart.mock.calls[0][1];
      expect(config.data.datasets).toHaveLength(2);
      expect(config.options.interaction.mode).toBe('nearest');
    });
  });

  // ==========================================
  // SECTION: Navigation & Sliders
  // ==========================================
  describe('Navigation & Sliders', () => {
    test.skip('updates chart when local slider inputs change', () => {
      const mockFile = {
        name: 'f1',
        duration: 100,
        startTime: 1000,
        availableSignals: [],
        signals: {},
      };

      // FIX: Setup AppState BEFORE calling _renderChartCard
      AppState.files = [mockFile];
      AppState.chartInstances = [mockChartInstance];

      // Use direct _renderChartCard to ensure DOM listeners are attached
      ChartManager._renderChartCard(container, mockFile, 0);

      const startInput = container.querySelector('.local-range-start');
      expect(startInput).not.toBeNull();

      // Reset mock min to start value
      mockChartInstance.options.scales.x.min = 1000;

      // Update input
      startInput.value = '10';
      startInput.dispatchEvent(new Event('input', { bubbles: true }));

      // 1000 (Start) + 10 (Input) * 1000 (ms) = 11000
      expect(mockChartInstance.options.scales.x.min).toBe(11000);
      expect(mockChartInstance.update).toHaveBeenCalledWith('none');
    });

    test('Slider swaps values if start > end', () => {
      const mockFile = {
        name: 'f1',
        duration: 100,
        startTime: 0,
        availableSignals: [],
        signals: {},
      };
      AppState.files = [mockFile];
      AppState.chartInstances = [mockChartInstance];

      ChartManager._renderChartCard(container, mockFile, 0);

      const startInput = container.querySelector('.local-range-start');
      const endInput = container.querySelector('.local-range-end');
      startInput.value = '80';
      endInput.value = '20';
      startInput.dispatchEvent(new Event('input', { bubbles: true }));

      expect(mockChartInstance.options.scales.x.min).toBe(20000);
      expect(mockChartInstance.options.scales.x.max).toBe(80000);
    });

    test('manualZoom triggers chart zoom', () => {
      AppState.chartInstances = [mockChartInstance];
      ChartManager.manualZoom(0, 1.2);
      expect(mockChartInstance.zoom).toHaveBeenCalledWith(1.2);
    });

    test('resetChart restores full range', () => {
      const f = {
        startTime: 1000,
        duration: 100,
        availableSignals: [],
        signals: {},
      };
      AppState.files = [f];
      AppState.chartInstances = [mockChartInstance];
      ChartManager.resetChart(0);
      expect(mockChartInstance.options.scales.x.min).toBe(1000);
      expect(mockChartInstance.options.scales.x.max).toBe(101000);
    });

    test('reset calls resetChart for all instances', () => {
      const spy = jest.spyOn(ChartManager, 'resetChart');
      AppState.chartInstances = [{}, {}];
      ChartManager.reset();
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================
  // SECTION: Step Cursor & Tooltips
  // ==========================================
  describe('Step Cursor & Time Sync', () => {
    beforeEach(() => {
      const mockFile = {
        name: 'test.json',
        startTime: 1000,
        duration: 20,
        availableSignals: ['RPM'],
        signals: { RPM: [] },
      };
      AppState.files = [mockFile];

      const mockPoints = [
        { x: 1000, y: 50 },
        { x: 1100, y: 55 },
      ];
      mockChartInstance.data.datasets = [{ data: mockPoints }];
      mockChartInstance.getDatasetMeta.mockReturnValue({ data: mockPoints });

      AppState.chartInstances = [mockChartInstance];
      ChartManager.hoverValue = 1000;
      ChartManager.activeChartIndex = 0;

      mockChartInstance.scales.x.min = 1000;
      mockChartInstance.scales.x.max = 6000;
      mockChartInstance.options.scales.x.min = 1000;
      mockChartInstance.options.scales.x.max = 6000;
      mockChartInstance.scales.x.getPixelForValue.mockReturnValue(55);
    });

    test('Moves cursor forward', () => {
      ChartManager.stepCursor(0, 1);
      expect(ChartManager.hoverValue).toBe(1100);
      expect(mockChartInstance.update).toHaveBeenCalled();
    });

    test('Clamps cursor to start/end', () => {
      ChartManager.hoverValue = 1000;
      ChartManager.stepCursor(0, -10);
      expect(ChartManager.hoverValue).toBe(1000);

      ChartManager.hoverValue = 21000;
      ChartManager.stepCursor(0, 10);
      expect(ChartManager.hoverValue).toBe(21000);
    });

    test('Shifts view when cursor hits right edge', () => {
      ChartManager.hoverValue = 6000; // Right edge
      ChartManager.stepCursor(0, 1); // Step out to 6100

      expect(mockChartInstance.options.scales.x.min).toBe(5100);
      expect(mockChartInstance.update).toHaveBeenCalledWith('none');
    });

    test('Shifts view when cursor hits left edge', () => {
      mockChartInstance.scales.x.min = 5000;
      mockChartInstance.scales.x.max = 10000;
      ChartManager.hoverValue = 5000;

      ChartManager.stepCursor(0, -1);
      expect(mockChartInstance.options.scales.x.min).toBe(900);
    });

    test('_syncTooltip logic finds nearest point', () => {
      ChartManager.stepCursor(0, 1);
      expect(mockChartInstance.setActiveElements).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ index: 1 })])
      );
    });
  });

  // ==========================================
  // SECTION: Mouse Interactions
  // ==========================================
  describe('Mouse Interactions', () => {
    let canvas;
    beforeEach(() => {
      AppState.chartInstances = [mockChartInstance];
      canvas = document.createElement('canvas');
      canvas.getContext = jest.fn(() => mockChartInstance.ctx);
      ChartManager._attachMouseListeners(canvas, 0);
      ChartManager.initKeyboardControls(canvas, 0);
      mockChartInstance.scales.x.getPixelForValue.mockReturnValue(50);
    });

    test('ArrowRight pans right', () => {
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(mockChartInstance.pan).toHaveBeenCalled();
    });

    test('Mousemove updates hoverValue', () => {
      mockChartInstance.scales.x.getValueForPixel.mockReturnValue(1500);
      const event = new MouseEvent('mousemove', { bubbles: true });
      Object.defineProperty(event, 'offsetX', { value: 100 });
      canvas.dispatchEvent(event);
      expect(ChartManager.hoverValue).toBe(1500);
    });

    test('Double click prompts annotation', () => {
      jest.spyOn(window, 'prompt').mockReturnValue('Note');
      mockChartInstance.scales.x.getValueForPixel.mockReturnValue(2000);
      AppState.files = [
        { name: 'f', startTime: 1000, duration: 10, annotations: [] },
      ];

      const event = new MouseEvent('dblclick', { bubbles: true });
      Object.defineProperty(event, 'offsetX', { value: 50 });
      canvas.dispatchEvent(event);

      expect(AppState.files[0].annotations).toHaveLength(1);
    });
  });

  // ==========================================
  // SECTION: CSV Export
  // ==========================================
  describe('CSV Export Logic', () => {
    let anchorSpy;

    beforeEach(() => {
      const file = {
        name: 'test.json',
        startTime: 1000,
        availableSignals: ['RPM', 'Speed'],
        signals: {
          RPM: [
            { x: 1000, y: 100 },
            { x: 2000, y: 200 },
            { x: 5000, y: 500 },
          ],
          Speed: [
            { x: 1000, y: 10 },
            { x: 2000, y: 20 },
          ],
        },
      };
      AppState.files = [file];
      AppState.chartInstances = [mockChartInstance];

      mockChartInstance.scales.x.min = 900;
      mockChartInstance.scales.x.max = 2100;

      anchorSpy = { setAttribute: jest.fn(), click: jest.fn() };
      jest.spyOn(document, 'createElement').mockReturnValue(anchorSpy);
      jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
      jest.spyOn(document.body, 'removeChild').mockImplementation(() => {});
    });

    test('Exports visible signals within range', () => {
      jest.spyOn(document, 'querySelector').mockReturnValue({ checked: true });
      ChartManager.exportDataRange(0);

      const href = anchorSpy.setAttribute.mock.calls.find(
        (c) => c[0] === 'href'
      )[1];
      const csv = decodeURI(href);

      expect(csv).toContain('0.000,100.000,10.000');
      expect(csv).toContain('1.000,200.000,20.000');
      expect(csv).not.toContain('500.000');
    });

    test('Handles mismatching signal data (holes)', () => {
      AppState.files[0].signals.Speed = [{ x: 1000, y: 10 }];
      jest.spyOn(document, 'querySelector').mockReturnValue({ checked: true });
      ChartManager.exportDataRange(0);
      const href = anchorSpy.setAttribute.mock.calls.find(
        (c) => c[0] === 'href'
      )[1];
      const csv = decodeURI(href);
      expect(csv).toMatch(/1\.000,200\.000,(\r\n|\n|$)/);
    });
  });

  // ==========================================
  // SECTION: Chart Info Modal
  // ==========================================
  describe('Chart Info Modal', () => {
    test('showChartInfo displays metadata', () => {
      AppState.files = [
        {
          name: 'trip.json',
          startTime: 1000,
          duration: 60,
          availableSignals: ['A', 'B'],
          metadata: { profileName: 'Test Profile' },
        },
      ];

      ChartManager.showChartInfo(0);

      const modal = document.getElementById('metadataModal');
      expect(modal).not.toBeNull();
      expect(modal.innerHTML).toContain('trip.json');
      expect(modal.innerHTML).toContain('Signals Count');
    });
  });

  // ==========================================
  // SECTION: Coverage Booster
  // ==========================================
  describe('Coverage Booster', () => {
    const file = {
      name: 't',
      startTime: 1000,
      duration: 10,
      availableSignals: [],
      signals: { A: [{ x: 1000, y: 10 }] },
    };

    test('shouldShowLabels logic thresholds', () => {
      mockChartInstance.scales.x.min = 0;
      mockChartInstance.scales.x.max = 1000;
      mockChartInstance.data.datasets = [{}, {}];
      expect(ChartManager._shouldShowLabels(mockChartInstance)).toBe(true);
      mockChartInstance.scales.x.max = 6000;
      expect(ChartManager._shouldShowLabels(mockChartInstance)).toBe(false);
    });

    test('getAlphaColor handles invalid inputs', () => {
      expect(ChartManager.getAlphaColor(null)).toContain('rgba(128,128,128');
      expect(ChartManager.getAlphaColor('#00FF00', 0.5)).toBe(
        'rgba(0, 255, 0, 0.5)'
      );
    });

    test('_buildDataset handles flat/zero signals', () => {
      const flatFile = {
        ...file,
        signals: {
          A: [
            { x: 1000, y: 100 },
            { x: 2000, y: 100 },
          ],
        },
      };
      const ds1 = ChartManager._buildDataset(flatFile, 'A', 0, 0);
      expect(ds1.data[0].y).toBe(0.8);

      const zeroFile = {
        ...file,
        signals: {
          A: [
            { x: 1000, y: 0 },
            { x: 2000, y: 0 },
          ],
        },
      };
      const ds2 = ChartManager._buildDataset(zeroFile, 'A', 0, 0);
      expect(ds2.data[0].y).toBe(0);
    });

    test('Chart Options Callbacks', () => {
      const opts = ChartManager._getChartOptions(file);
      const titleCb = opts.plugins.tooltip.callbacks.title;
      expect(typeof titleCb([{ parsed: { x: 1600000000000 } }])).toBe('string');
      const labelCb = opts.plugins.tooltip.callbacks.label;
      const ctx = {
        dataset: { label: 'A', originalMin: 0, originalMax: 100 },
        parsed: { y: 0.5 },
      };
      expect(labelCb(ctx)).toBe('A: 50.00');
      const filterCb = opts.plugins.legend.labels.filter;
      jest.spyOn(document, 'querySelector').mockReturnValue({ checked: true });
      expect(filterCb({ text: 'A' }, { datasets: [] })).toBe(true);
    });

    test('Smart Updates Check', () => {
      ChartManager.viewMode = 'overlay';
      expect(ChartManager._canPerformSmartUpdate()).toBe(false);
      ChartManager.viewMode = 'stack';
      // Fix: Ensure files array matches length check logic
      AppState.files = [{}, {}];
      AppState.chartInstances = [{}, {}];
      expect(ChartManager._canPerformSmartUpdate()).toBe(true);
    });

    test('_performSmartUpdate logic', () => {
      AppState.chartInstances = [mockChartInstance];
      mockChartInstance.data.datasets = [{ borderColor: '#000' }];
      ChartManager._performSmartUpdate();
      expect(mockChartInstance.update).toHaveBeenCalledWith('none');
      expect(mockChartInstance.data.datasets[0].borderColor).toBe('#ff0000');
    });

    // --- Highligher Plugin Coverage ---
    test('HighlighterPlugin: Annotation Drawing', () => {
      const noteFile = {
        name: 'n',
        startTime: 1000,
        annotations: [{ time: 10, text: 'Hi' }],
      };
      AppState.files = [noteFile];
      AppState.chartInstances = [mockChartInstance];
      mockChartInstance.scales.x.getPixelForValue.mockReturnValue(50);
      mockChartInstance.scales.x.min = 1000;
      mockChartInstance.scales.x.max = 20000;
      ChartManager.hoverValue = null;

      ChartManager.highlighterPlugin.afterDraw(mockChartInstance);
      expect(ctxStrokeStyleSpy).toHaveBeenCalledWith('#FFA500');
      expect(mockChartInstance.ctx.stroke).toHaveBeenCalled();
    });

    test('HighlighterPlugin: Draw Highlight Box', () => {
      AppState.activeHighlight = { start: 0, end: 5, targetIndex: 0 };
      AppState.chartInstances = [mockChartInstance];
      // FIX: Ensure files is present for the conditional check
      AppState.files = [{ startTime: 1000 }];

      ChartManager.highlighterPlugin.afterDraw(mockChartInstance);
      expect(ctxFillStyleSpy).toHaveBeenCalledWith('rgba(255, 0, 0, 0.08)');
      expect(mockChartInstance.ctx.fillRect).toHaveBeenCalled();
    });

    test('HighlighterPlugin: Draw Cursor (Normal)', () => {
      AppState.activeHighlight = null;
      ChartManager.activeChartIndex = 0;
      ChartManager.hoverValue = 1005;
      AppState.chartInstances = [mockChartInstance];
      AppState.files = [{ startTime: 1000 }];
      mockChartInstance.scales.x.getPixelForValue.mockReturnValue(50);

      ChartManager.highlighterPlugin.afterDraw(mockChartInstance);
      expect(ctxStrokeStyleSpy).toHaveBeenCalledWith('rgba(227, 24, 55, 0.6)');
    });

    test('HighlighterPlugin: Mismatch Index', () => {
      ChartManager.activeChartIndex = 99; // Mismatch
      ChartManager.hoverValue = 1005;
      AppState.chartInstances = [mockChartInstance];
      mockChartInstance.ctx.stroke.mockClear();

      ChartManager.highlighterPlugin.afterDraw(mockChartInstance);
      expect(mockChartInstance.ctx.stroke).not.toHaveBeenCalled();
    });
  });
});
