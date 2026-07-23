import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
} from '@jest/globals';

import { messenger } from '../src/bus.js';

const ctxFillStyleSpy = jest.fn();
const ctxStrokeStyleSpy = jest.fn();
const ctxLineWidthSpy = jest.fn();
const ctxSetLineDashSpy = jest.fn();

const mockChartInstance = {
  destroy: jest.fn(),
  update: jest.fn(),
  draw: jest.fn(),
  resetZoom: jest.fn(),
  pan: jest.fn(),
  zoom: jest.fn(),
  width: 1000,
  chartArea: { top: 10, bottom: 90, left: 10, right: 190 },
  scales: {
    x: {
      min: 0,
      max: 1000,
      getValueForPixel: jest.fn((px) => px * 10 + 1000),
      getPixelForValue: jest.fn((val) => (val - 1000) / 10),
    },
    y: { min: 0, max: 100 },
  },
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
  ctx: {
    save: jest.fn(),
    restore: jest.fn(),
    fillRect: jest.fn(),
    beginPath: jest.fn(),
    rect: jest.fn(),
    clip: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    setLineDash: ctxSetLineDashSpy,
    fillText: jest.fn(),
    measureText: jest.fn(() => ({ width: 20 })),
    font: '',
    textAlign: '',
    textBaseline: '',
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
  tooltip: {
    getActiveElements: jest.fn(() => []),
    setActiveElements: jest.fn(),
  },
  setActiveElements: jest.fn(),
  isDatasetVisible: jest.fn(() => true),
  getDatasetMeta: jest.fn(() => ({ data: [] })),
  getElementsAtEventForMode: jest.fn(() => []),
};

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

await jest.unstable_mockModule('hammerjs', () => ({ default: jest.fn() }));
await jest.unstable_mockModule('chartjs-plugin-datalabels', () => ({
  default: {},
}));
await jest.unstable_mockModule('chartjs-adapter-date-fns', () => ({}));
await jest.unstable_mockModule('chartjs-plugin-zoom', () => ({ default: {} }));

const mockEvents = {
  BATCH_LOADED: 'dataprocessor:batch-load-completed',
  MAP_SELECTED: 'map:position-selected',
  FILE_REMOVED: 'file:removed',
};

const mockViewModes = {
  STACK: 'stack',
  OVERLAY: 'overlay',
};

await jest.unstable_mockModule('../src/config.js', () => ({
  AppState: { files: [], chartInstances: [], activeHighlight: null },
  DOM: { get: jest.fn() },
  EVENTS: mockEvents,
  VIEW_MODES: mockViewModes,
}));

await jest.unstable_mockModule('../src/ui.js', () => ({
  UI: {
    updateDataLoadedState: jest.fn(),
    renderSignalList: jest.fn(),
    renderProjectHistory: jest.fn(),
  },
}));

await jest.unstable_mockModule('../src/palettemanager.js', () => ({
  PaletteManager: { getColorForSignal: jest.fn(() => '#ff0000') },
}));

await jest.unstable_mockModule('../src/preferences.js', () => ({
  Preferences: {
    prefs: { showAreaFills: true, smoothLines: false, showLabels: true },
  },
}));

const mockMapManager = {
  syncPosition: jest.fn(),
  syncOverlayPosition: jest.fn(),
  syncMapBounds: jest.fn(),
  clearAllMaps: jest.fn(),
  loadRoute: jest.fn(),
  loadOverlayMap: jest.fn(),
};
await jest.unstable_mockModule('../src/mapmanager.js', () => ({
  mapManager: mockMapManager,
}));

const mockProjectManager = {
  onFileRemoved: jest.fn(),
};
await jest.unstable_mockModule('../src/projectmanager.js', () => ({
  projectManager: mockProjectManager,
}));

const mockSignalRegistry = {
  isDefaultSignal: jest.fn(() => true),
};
await jest.unstable_mockModule('../src/signalregistry.js', () => ({
  signalRegistry: mockSignalRegistry,
}));

const { ChartManager } = await import('../src/chartmanager.js');
const { AppState, DOM } = await import('../src/config.js');
const { Chart, Tooltip } = await import('chart.js');
const { UI } = await import('../src/ui.js');
const { Preferences } = await import('../src/preferences.js');

messenger.emit = jest.fn();
messenger.on = jest.fn();

describe('ChartManager Complete Suite', () => {
  let container;

  beforeEach(() => {
    jest.clearAllMocks();

    AppState.files = [];
    AppState.chartInstances = [];
    AppState.activeHighlight = null;
    ChartManager.viewMode = 'stack';
    ChartManager.activeChartIndex = null;
    ChartManager.hoverValue = null;

    ctxFillStyleSpy.mockClear();
    ctxStrokeStyleSpy.mockClear();
    ctxLineWidthSpy.mockClear();
    ctxSetLineDashSpy.mockClear();

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

  describe('Lifecycle & Initialization', () => {
    test('init registers chart plugins and listeners', () => {
      ChartManager.init();
      expect(Chart.register).toHaveBeenCalled();
      expect(messenger.on).toHaveBeenCalledWith(
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
      expect(messenger.emit).toHaveBeenCalledWith('file:removed', { index: 0 });
    });

    test('removeChart() does nothing in overlay mode', () => {
      ChartManager.viewMode = 'overlay';
      AppState.files = [{ name: 'f1' }];
      ChartManager.removeChart(0);
      expect(AppState.files).toHaveLength(1);
    });

    test('MAP_SELECTED event syncs tooltip and updates bounds (Stack mode)', () => {
      ChartManager.init();
      ChartManager.viewMode = 'stack';
      AppState.files = [{ startTime: 1000, duration: 100 }];
      mockChartInstance.scales.x.min = 2000;
      mockChartInstance.scales.x.max = 3000;
      AppState.chartInstances = [mockChartInstance];

      const cb = messenger.on.mock.calls.find(
        (call) => call[0] === 'map:position-selected'
      )[1];
      cb({ time: 5000, fileIndex: 0 });

      expect(ChartManager.hoverValue).toBe(5000);
      expect(mockChartInstance.options.scales.x.min).toBe(4500);
    });

    test('MAP_SELECTED event syncs tooltip and updates bounds (Overlay mode)', () => {
      ChartManager.init();
      ChartManager.viewMode = 'overlay';
      AppState.files = [{ startTime: 1000 }, { startTime: 5000 }];
      mockChartInstance.scales.x.min = 0;
      mockChartInstance.scales.x.max = 1000;
      AppState.chartInstances = [mockChartInstance];

      const cb = messenger.on.mock.calls.find(
        (call) => call[0] === 'map:position-selected'
      )[1];
      cb({ time: 5500, fileIndex: 1 });

      expect(ChartManager.hoverValue).toBe(5500);
      expect(mockChartInstance.options.scales.x.min).toBe(1000);
    });
  });

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

  describe('Navigation & Sliders', () => {
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

  describe('Step Cursor & Tooltips', () => {
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

    test('stepCursor Overlay mode clamps to maxDuration', () => {
      ChartManager.viewMode = 'overlay';
      AppState.files = [
        { startTime: 1000, duration: 10 },
        { startTime: 2000, duration: 20 },
      ];
      AppState.chartInstances = [mockChartInstance];

      ChartManager.hoverValue = 1000;
      ChartManager.stepCursor(0, 500);

      expect(ChartManager.hoverValue).toBe(21000);
    });

    test('Shifts view when cursor hits right edge', () => {
      ChartManager.hoverValue = 6000;
      ChartManager.stepCursor(0, 1);

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

    test('Pointermove updates hoverValue', () => {
      mockChartInstance.scales.x.getValueForPixel.mockReturnValue(1500);
      const event = new MouseEvent('pointermove', { bubbles: true });
      Object.defineProperty(event, 'offsetX', { value: 100 });
      canvas.dispatchEvent(event);
      expect(ChartManager.hoverValue).toBe(1500);
    });

    test('Alt+click prompts annotation', () => {
      jest.spyOn(window, 'prompt').mockReturnValue('Note');
      mockChartInstance.scales.x.getValueForPixel.mockReturnValue(2000);
      AppState.files = [
        { name: 'f', startTime: 1000, duration: 10, annotations: [] },
      ];

      const event = new MouseEvent('click', { bubbles: true, altKey: true });
      Object.defineProperty(event, 'offsetX', { value: 50 });
      canvas.dispatchEvent(event);

      expect(AppState.files[0].annotations).toHaveLength(1);
    });

    test('Pointer events for highlighting anomalies', () => {
      const file = {
        startTime: 1000,
        duration: 10,
        signals: { A: [{ x: 1000, y: 1 }] },
        highlights: [],
      };
      AppState.files = [file];
      AppState.chartInstances = [mockChartInstance];
      mockChartInstance.data.datasets = [{ label: 'A', hidden: false }];

      let testCanvas = document.createElement('canvas');
      testCanvas.getContext = jest.fn(() => mockChartInstance.ctx);
      ChartManager._attachMouseListeners(testCanvas, 0);

      const downEvent = new MouseEvent('pointerdown', {
        bubbles: true,
        shiftKey: true,
      });
      Object.defineProperty(downEvent, 'offsetX', { value: 10 });
      mockChartInstance.scales.x.getValueForPixel.mockReturnValueOnce(1000);
      testCanvas.dispatchEvent(downEvent);

      const moveEvent = new MouseEvent('pointermove', { bubbles: true });
      Object.defineProperty(moveEvent, 'offsetX', { value: 50 });
      mockChartInstance.scales.x.getValueForPixel.mockReturnValueOnce(5000);
      testCanvas.dispatchEvent(moveEvent);

      expect(AppState.activeHighlight.start).toBe(0);
      expect(AppState.activeHighlight.end).toBe(4);

      const upEvent = new MouseEvent('pointerup', { bubbles: true });
      Object.defineProperty(upEvent, 'offsetX', { value: 50 });
      mockChartInstance.scales.x.getValueForPixel.mockReturnValueOnce(5000);
      testCanvas.dispatchEvent(upEvent);

      const modal = document.getElementById('customAnomalyModal');
      expect(modal).not.toBeNull();

      document.getElementById('anoTitle').value = 'Test High';
      document.getElementById('btnAnoSave').click();

      expect(file.highlights).toHaveLength(1);
      expect(file.highlights[0].label).toBe('Test High');
    });

    test('Alt+Click deletes existing annotation or highlight', () => {
      const file = {
        startTime: 1000,
        annotations: [{ time: 1.0, text: 'hi' }],
        highlights: [{ start: 2.0, end: 3.0 }],
      };
      AppState.files = [file];
      AppState.chartInstances = [mockChartInstance];

      let testCanvas = document.createElement('canvas');
      testCanvas.getContext = jest.fn(() => mockChartInstance.ctx);
      ChartManager._attachMouseListeners(testCanvas, 0);

      const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

      mockChartInstance.scales.x.getValueForPixel.mockReturnValueOnce(2000);
      mockChartInstance.scales.x.getPixelForValue.mockReturnValue(50);
      const clickEvent1 = new MouseEvent('click', {
        bubbles: true,
        altKey: true,
      });
      Object.defineProperty(clickEvent1, 'offsetX', { value: 50 });
      testCanvas.dispatchEvent(clickEvent1);

      expect(file.annotations).toHaveLength(0);

      mockChartInstance.scales.x.getValueForPixel.mockReturnValueOnce(3500);
      const clickEvent2 = new MouseEvent('click', {
        bubbles: true,
        altKey: true,
      });
      Object.defineProperty(clickEvent2, 'offsetX', { value: 50 });
      testCanvas.dispatchEvent(clickEvent2);

      expect(file.highlights).toHaveLength(0);

      confirmSpy.mockRestore();
    });

    test('Keyboard controls handle left/right +/=', () => {
      let testCanvas = document.createElement('canvas');
      ChartManager.initKeyboardControls(testCanvas, 0);
      AppState.chartInstances = [mockChartInstance];

      testCanvas.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft' })
      );
      expect(mockChartInstance.pan).toHaveBeenCalled();

      testCanvas.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }));
      expect(mockChartInstance.zoom).toHaveBeenCalled();

      testCanvas.dispatchEvent(new KeyboardEvent('keydown', { key: '-' }));
      expect(mockChartInstance.zoom).toHaveBeenCalled();
    });
  });

  describe('Tagging Functionality', () => {
    let canvas;

    beforeEach(() => {
      AppState.files = [
        {
          name: 'log1.json',
          id: 'file-123',
          startTime: 1000,
          duration: 10,
          availableSignals: ['RPM'],
          signals: { RPM: [] },
          tags: ['rain'],
        },
      ];
      AppState.chartInstances = [mockChartInstance];

      document.body.innerHTML = `<div id="chart-tags-0"></div>`;

      canvas = document.createElement('canvas');
      canvas.getContext = jest.fn(() => mockChartInstance.ctx);
      ChartManager._attachMouseListeners(canvas, 0);
      ChartManager.initKeyboardControls(canvas, 0);
    });

    test('_generateTagsHtml creates HTML with dynamic color hash', () => {
      const html = ChartManager._generateTagsHtml(AppState.files[0]);
      expect(html).toContain('rain');
      expect(html).toContain('hsla(');
    });

    test('_updateChartHeaderTags updates the DOM container', () => {
      ChartManager._updateChartHeaderTags(0);
      const domElement = document.getElementById('chart-tags-0');
      expect(domElement.innerHTML).toContain('rain');
    });

    test('_promptForTag adds valid tag and emits event', () => {
      const promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('Track');

      ChartManager._promptForTag(0);

      expect(promptSpy).toHaveBeenCalled();
      expect(AppState.files[0].tags).toContain('track');
      expect(messenger.emit).toHaveBeenCalledWith('file:tag-added', {
        fileId: 'file-123',
        tag: 'track',
        index: 0,
      });
      promptSpy.mockRestore();
    });

    test('_promptForTag handles duplicates gracefully', () => {
      const promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('Rain ');
      const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});

      ChartManager._promptForTag(0);

      expect(alertSpy).toHaveBeenCalledWith(
        'This tag is already applied to this log.'
      );
      expect(AppState.files[0].tags.filter((t) => t === 'rain').length).toBe(1);
      expect(messenger.emit).not.toHaveBeenCalled();

      promptSpy.mockRestore();
      alertSpy.mockRestore();
    });

    test('_promptForTag ignores empty or cancelled inputs', () => {
      const promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('');
      ChartManager._promptForTag(0);
      expect(AppState.files[0].tags).toHaveLength(1);

      promptSpy.mockReturnValue(null);
      ChartManager._promptForTag(0);
      expect(AppState.files[0].tags).toHaveLength(1);

      promptSpy.mockRestore();
    });

    test('Keyboard "t" triggers tag prompt', () => {
      const promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('commute');

      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 't' }));

      expect(promptSpy).toHaveBeenCalled();
      expect(AppState.files[0].tags).toContain('commute');
      promptSpy.mockRestore();
    });

    test('Shift+Click triggers tag prompt', () => {
      const promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('test');

      const event = new MouseEvent('click', { bubbles: true, shiftKey: true });
      canvas.dispatchEvent(event);

      expect(promptSpy).toHaveBeenCalled();
      expect(AppState.files[0].tags).toContain('test');
      promptSpy.mockRestore();
    });

    test('Event bus "drive:tag-added" synchronizes background tags', () => {
      ChartManager.init();

      const driveTagCb = messenger.on.mock.calls.find(
        (call) => call[0] === 'drive:tag-added'
      )[1];

      driveTagCb({ fileId: 'file-123', tag: 'remote-tag' });

      expect(AppState.files[0].tags).toContain('remote-tag');
      const domElement = document.getElementById('chart-tags-0');
      expect(domElement.innerHTML).toContain('remote-tag');
    });
  });

  describe('CSV Export Logic', () => {
    let anchorSpy;
    let capturedCsv = '';

    beforeAll(() => {
      if (typeof window.URL.createObjectURL === 'undefined') {
        Object.defineProperty(window.URL, 'createObjectURL', {
          writable: true,
          value: jest.fn(() => 'blob:mock-url'),
        });
        Object.defineProperty(window.URL, 'revokeObjectURL', {
          writable: true,
          value: jest.fn(),
        });
      }
    });

    beforeEach(() => {
      capturedCsv = '';

      global.Blob = class MockBlob {
        constructor(content) {
          capturedCsv = content[0];
        }
      };

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

      const csv = capturedCsv;

      expect(csv).toContain('0.000,100.000,10.000');
      expect(csv).toContain('1.000,200.000,20.000');
      expect(csv).not.toContain('500.000');
    });

    test('Handles mismatching signal data (holes)', () => {
      AppState.files[0].signals.Speed = [{ x: 1000, y: 10 }];
      jest.spyOn(document, 'querySelector').mockReturnValue({ checked: true });

      ChartManager.exportDataRange(0);

      const csv = capturedCsv;

      expect(csv).toMatch(/1\.000,200\.000,10\.000(\r\n|\n|$)/);
    });

    test('exportDataRange handles empty timeSet', () => {
      const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
      AppState.files = [
        {
          name: 'f1',
          startTime: 1000,
          availableSignals: ['A'],
          signals: { A: [] },
        },
      ];
      AppState.chartInstances = [mockChartInstance];
      jest.spyOn(document, 'querySelector').mockReturnValue({ checked: true });

      ChartManager.exportDataRange(0);
      expect(alertSpy).toHaveBeenCalledWith(
        'Brak danych w zaznaczonym przedziale czasu.'
      );
      alertSpy.mockRestore();
    });
  });

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

    test('showChartInfo complex metadata formatting', () => {
      AppState.files = [
        {
          name: 'trip.json',
          startTime: 1000,
          duration: 60,
          availableSignals: ['A'],
          signals: { A: [{ x: 1000, y: 1 }], 'Math:A': [] },
          metadata: {
            engineTemp: { min: 80, max: 90, unit: 'C' },
            customJson: { foo: 'bar' },
            timestampTime: 1600000000000,
            trip: { duration: 5 },
          },
        },
      ];
      ChartManager.showChartInfo(0);
      const modal = document.getElementById('metadataModal');
      expect(modal.innerHTML).toContain('Engine Temp');
      expect(modal.innerHTML).toContain('Min: 80.00, Max: 90.00 [C]');
      expect(modal.innerHTML).toContain('foo: bar');
    });
  });

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
      AppState.files = [{ startTime: 1000 }];

      ChartManager.highlighterPlugin.afterDraw(mockChartInstance);
      expect(ctxFillStyleSpy).toHaveBeenCalledWith('rgba(255, 0, 0, 0.15)');
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
      ChartManager.activeChartIndex = 99;
      ChartManager.hoverValue = 1005;
      AppState.chartInstances = [mockChartInstance];
      mockChartInstance.ctx.stroke.mockClear();

      mockChartInstance.scales.x.getPixelForValue.mockReturnValue(50);

      ChartManager.highlighterPlugin.afterDraw(mockChartInstance);
      expect(mockChartInstance.ctx.stroke).toHaveBeenCalled();
    });

    test('HighlighterPlugin draws stats block', () => {
      AppState.chartInstances = [mockChartInstance];
      AppState.files = [
        {
          startTime: 1000,
          highlights: [{ start: 0, end: 1, label: 'x', description: 'y' }],
          signals: { A: [{ x: 1500, y: 10 }] },
        },
      ];
      mockChartInstance.data.datasets = [{ hidden: false, label: 'A' }];
      mockChartInstance.scales.x.getPixelForValue.mockReturnValue(50);
      ChartManager.highlighterPlugin.afterDraw(mockChartInstance);
      expect(mockChartInstance.ctx.fillText).toHaveBeenCalled();
    });

    test('updateSmoothing applies tension based on preferences', () => {
      AppState.chartInstances = [mockChartInstance];
      mockChartInstance.data.datasets = [{ tension: 0 }];

      Preferences.prefs.smoothLines = true;
      ChartManager.updateSmoothing();
      expect(mockChartInstance.data.datasets[0].tension).toBe(0.8);

      Preferences.prefs.smoothLines = false;
      ChartManager.updateSmoothing();
      expect(mockChartInstance.data.datasets[0].tension).toBe(0);
    });

    test('Tick and Tooltip Formatting Callbacks', () => {
      const opts = ChartManager._getChartOptions({ startTime: 1000 });
      const xTickCallback = opts.scales.x.ticks.callback;
      expect(typeof xTickCallback(1600000000000)).toBe('string');

      ChartManager.viewMode = 'overlay';
      AppState.files = [{ startTime: 1000 }];
      const tooltipTitleCb = opts.plugins.tooltip.callbacks.title;
      expect(tooltipTitleCb([{ parsed: { x: 5000 } }])).toBe('T + 4.00s');

      const dlFormatter = opts.plugins.datalabels.formatter;
      const dlRes = dlFormatter(
        { y: 0.5 },
        { dataset: { originalMin: 0, originalMax: 100 } }
      );
      expect(dlRes).toBe('50.0');
    });

    test('Zoom and Pan Plugin Callbacks', () => {
      ChartManager.viewMode = 'stack';
      AppState.files = [{ startTime: 1000, duration: 10 }];
      AppState.chartInstances = [mockChartInstance];

      const opts = ChartManager._getZoomPluginConfig();

      const shiftEvent = { shiftKey: true };
      expect(opts.pan.onPanStart({ event: shiftEvent })).toBe(false);
      expect(opts.zoom.onZoomStart({ event: shiftEvent })).toBe(false);

      opts.pan.onPan({ chart: mockChartInstance });
      opts.pan.onPanComplete({ chart: mockChartInstance });
      opts.zoom.onZoom({ chart: mockChartInstance });
      opts.zoom.onZoomComplete({ chart: mockChartInstance });

      expect(mockChartInstance.update).toHaveBeenCalled();
    });
  });

  describe('Extended Coverage & Edge Cases', () => {
    test('zoomTo sets highlight and updates chart scales with padding', () => {
      const file = { startTime: 1000, duration: 100 };
      AppState.files = [file];
      AppState.chartInstances = [mockChartInstance];

      ChartManager.zoomTo(10, 20, 0);

      expect(AppState.activeHighlight).toEqual({
        start: 10,
        end: 20,
        targetIndex: 0,
      });

      expect(mockChartInstance.options.scales.x.min).toBe(1000);
      expect(mockChartInstance.options.scales.x.max).toBe(61000);
      expect(mockChartInstance.update).toHaveBeenCalledWith('none');
    });

    test('updateAreaFills toggles dataset fill properties', () => {
      AppState.chartInstances = [mockChartInstance];
      const dataset = {
        borderColor: '#ff0000',
        fill: false,
        backgroundColor: 'transparent',
      };
      mockChartInstance.data.datasets = [dataset];

      Preferences.prefs.showAreaFills = true;
      ChartManager.updateAreaFills();

      expect(dataset.fill).toBe('origin');
      expect(dataset.backgroundColor).toContain('rgba(255, 0, 0, 0.1)');

      Preferences.prefs.showAreaFills = false;
      ChartManager.updateAreaFills();

      expect(dataset.fill).toBe(false);
      expect(dataset.backgroundColor).toBe('transparent');
      expect(mockChartInstance.update).toHaveBeenCalledWith('none');
    });

    test('_findNearestIndex handles various array positions', () => {
      const data = [
        { x: 100, y: 1 },
        { x: 200, y: 2 },
        { x: 300, y: 3 },
      ];

      expect(ChartManager._findNearestIndex([], 100)).toBe(-1);
      expect(ChartManager._findNearestIndex(data, 50)).toBe(0);
      expect(ChartManager._findNearestIndex(data, 400)).toBe(2);
      expect(ChartManager._findNearestIndex(data, 200)).toBe(1);
      expect(ChartManager._findNearestIndex(data, 240)).toBe(1);
      expect(ChartManager._findNearestIndex(data, 260)).toBe(2);
    });

    test('_addAnnotationViaKeyboard handles null hoverValue', () => {
      const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
      ChartManager.hoverValue = null;

      ChartManager._addAnnotationViaKeyboard(0);
      expect(alertSpy).toHaveBeenCalled();
    });

    test('_addAnnotationViaKeyboard adds note when cursor is active', () => {
      const promptSpy = jest
        .spyOn(window, 'prompt')
        .mockReturnValue('Key Note');
      const file = { startTime: 1000, annotations: [] };
      AppState.files = [file];
      AppState.chartInstances = [mockChartInstance];
      ChartManager.hoverValue = 2000;
      ChartManager.activeChartIndex = 0;

      ChartManager._addAnnotationViaKeyboard(0);

      expect(promptSpy).toHaveBeenCalled();
      expect(file.annotations[0]).toEqual({ time: 1.0, text: 'Key Note' });
      expect(mockChartInstance.draw).toHaveBeenCalled();
    });

    test('exportDataRange alerts if no signals are checked', () => {
      const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
      AppState.files = [
        {
          name: 'f1',
          startTime: 1000,
          availableSignals: ['A', 'B'],
          signals: { A: [], B: [] },
        },
      ];
      AppState.chartInstances = [mockChartInstance];

      jest.spyOn(document, 'querySelector').mockReturnValue(null);

      ChartManager.exportDataRange(0);
      expect(alertSpy).toHaveBeenCalledWith('No signals visible to export.');
    });

    test('updateLabelVisibility hides labels on small screens', () => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 500,
      });

      mockChartInstance.options.plugins.datalabels.display = true;
      ChartManager.updateLabelVisibility(mockChartInstance);

      expect(mockChartInstance.options.plugins.datalabels.display).toBe(false);

      window.innerWidth = 1024;
    });

    test('formatDuration formats strings correctly', () => {
      expect(ChartManager.formatDuration(NaN)).toBe('0s');
      expect(ChartManager.formatDuration(45)).toBe('45s');
      expect(ChartManager.formatDuration(125)).toBe('2m 5s');
    });

    test('_syncTooltip ignores hidden datasets', () => {
      AppState.chartInstances = [mockChartInstance];
      mockChartInstance.data.datasets = [{}, {}];

      mockChartInstance.isDatasetVisible.mockImplementation((i) => i === 1);

      jest.spyOn(ChartManager, '_findNearestIndex').mockReturnValue(0);
      mockChartInstance.scales.x.getPixelForValue.mockReturnValue(100);

      mockChartInstance.data.datasets[1].data = [{ x: 1000 }];

      ChartManager._syncTooltip(mockChartInstance, 1000);

      expect(mockChartInstance.setActiveElements).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ datasetIndex: 1 })])
      );
      const callArgs = mockChartInstance.setActiveElements.mock.calls[0][0];
      expect(callArgs.find((x) => x.datasetIndex === 0)).toBeUndefined();
    });
  });

  test('Cursor/HoverValue remains active after mouse leave (Sticky Tooltip)', () => {
    const mockFile = {
      name: 'test.log',
      startTime: 1000,
      duration: 10,
      availableSignals: ['RPM'],
      signals: { RPM: [{ x: 1000, y: 0 }] },
    };
    AppState.files = [mockFile];

    ChartManager.render();

    const canvas = document.getElementById('chart-0');
    expect(canvas).toBeTruthy();

    const mouseMoveEvent = new MouseEvent('mousemove', {
      clientX: 50,
      clientY: 50,
      bubbles: true,
    });

    canvas.dispatchEvent(mouseMoveEvent);

    ChartManager.hoverValue = 1234567890;

    expect(ChartManager.hoverValue).not.toBeNull();

    const mouseLeaveEvent = new MouseEvent('mouseleave', {
      bubbles: true,
    });
    canvas.dispatchEvent(mouseLeaveEvent);

    expect(ChartManager.hoverValue).toBe(1234567890);
    expect(ChartManager.hoverValue).not.toBeNull();
  });
});
