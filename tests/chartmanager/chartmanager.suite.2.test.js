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
    y: {
      min: 0,
      max: 100,
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
    fillText: jest.fn(),
    measureText: jest.fn(() => ({ width: 20 })),
    font: '',
    textAlign: '',
    textBaseline: '',
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
    Tooltip: { positioners: {} },
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
      jest
        .spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue(mockChartInstance.ctx);
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
      jest
        .spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue(mockChartInstance.ctx);
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

describe('CSV Export Logic tests', () => {
  let mockFile, anchorSpy, clickSpy, alertSpy;

  beforeEach(() => {
    // 1. Setup Data
    mockFile = {
      name: 'test_log.json',
      startTime: 1000, // Start at 1s (1000ms)
      availableSignals: ['RPM', 'Speed'],
      signals: {
        RPM: [
          { x: 1000, y: 800 }, // t=0s relative
          { x: 2000, y: 1500 }, // t=1s relative
          { x: 3000, y: 3000 }, // t=2s relative
        ],
        Speed: [
          { x: 1000, y: 10 },
          { x: 2000, y: 20 },
          { x: 3000, y: 30 },
        ],
      },
    };
    AppState.files = [mockFile];
    AppState.chartInstances = [mockChartInstance];

    // 2. Mock Chart Zoom State (Visible range: 0.5s to 1.5s relative)
    // Absolute: 1500ms to 2500ms
    mockChartInstance.scales.x.min = 1500;
    mockChartInstance.scales.x.max = 2500;

    // 3. Mock DOM Elements for Download
    clickSpy = jest.fn();
    anchorSpy = {
      setAttribute: jest.fn(),
      click: clickSpy,
    };
    jest.spyOn(document, 'createElement').mockReturnValue(anchorSpy);
    jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    jest.spyOn(document.body, 'removeChild').mockImplementation(() => {});

    // 4. Mock Alert
    alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});

    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(mockChartInstance.ctx);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('Exports only visible data within the current zoom range', () => {
    // Setup: Only 'RPM' is visible, 'Speed' is unchecked
    jest.spyOn(document, 'querySelector').mockImplementation((selector) => {
      if (selector.includes('RPM')) return { checked: true };
      if (selector.includes('Speed')) return { checked: false };
      return null;
    });

    // Execute
    ChartManager.exportDataRange(0);

    // Assert: Verify Anchor Attributes
    expect(document.createElement).toHaveBeenCalledWith('a');
    expect(anchorSpy.setAttribute).toHaveBeenCalledWith(
      'download',
      expect.stringContaining('test_log.json_export')
    );

    // Assert: Verify CSV Content
    // We expect only the point at x=2000 (relative t=1.000) because:
    // x=1000 is < min(1500)
    // x=3000 is > max(2500)
    const lastCall = anchorSpy.setAttribute.mock.calls.find(
      (call) => call[0] === 'href'
    );
    const encodedContent = lastCall[1];
    const csvContent = decodeURI(encodedContent);

    // Check Header: Should contain Time and RPM, but NOT Speed
    expect(csvContent).toContain('Time (s),RPM');
    expect(csvContent).not.toContain('Speed');

    // Check Data: Should contain the point at t=1.000 (relative)
    // Relative calculation: (2000 - 1000) / 1000 = 1.000
    expect(csvContent).toContain('1.000,1500.000');

    // Should NOT contain data points outside zoom range
    expect(csvContent).not.toContain('0.000,800.000'); // Too early
    expect(csvContent).not.toContain('2.000,3000.000'); // Too late
  });

  test('Includes multiple signals if checked', () => {
    // Setup: Both signals checked
    jest.spyOn(document, 'querySelector').mockReturnValue({ checked: true });

    // Execute
    ChartManager.exportDataRange(0);

    // Verify CSV
    const href = anchorSpy.setAttribute.mock.calls.find(
      (c) => c[0] === 'href'
    )[1];
    const csv = decodeURI(href);

    expect(csv).toContain('Time (s),RPM,Speed');
    // Should have data for both: Time, RPM_Value, Speed_Value
    expect(csv).toContain('1.000,1500.000,20.000');
  });

  test('Alerts and aborts if no signals are visible', () => {
    // Setup: Nothing visible
    jest.spyOn(document, 'querySelector').mockReturnValue({ checked: false });

    // Execute
    ChartManager.exportDataRange(0);

    // Assert
    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining('No signals visible')
    );
    expect(document.createElement).not.toHaveBeenCalled();
  });

  test('Handles missing file gracefully', () => {
    AppState.files = []; // Empty
    ChartManager.exportDataRange(0);
    expect(document.createElement).not.toHaveBeenCalled();
  });
});

describe('Annotations tests', () => {
  let mockFile;

  beforeEach(() => {
    // Setup a clean file and chart instance
    mockFile = {
      name: 'test_annotations.json',
      startTime: 1000,
      duration: 100,
      annotations: [],
      availableSignals: ['RPM'],
      signals: { RPM: [{ x: 1000, y: 0 }] },
    };

    AppState.files = [mockFile];
    AppState.chartInstances = [mockChartInstance];

    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(mockChartInstance.ctx);

    mockChartInstance.tooltip.getActiveElements.mockReturnValue([]);
    mockChartInstance.ctx.fillText.mockClear();
    mockChartInstance.ctx.beginPath.mockClear();
    mockChartInstance.ctx.stroke.mockClear();

    ChartManager.render();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('Adds annotation via "_addAnnotationViaKeyboard" logic', () => {
    ChartManager.activeChartIndex = 0;
    ChartManager.hoverValue = 3500; // 1000 (start) + 2500 (2.5s)

    // Mock user input
    jest.spyOn(window, 'prompt').mockReturnValue('Keyboard Note');

    // Execute
    ChartManager._addAnnotationViaKeyboard(0);

    // Assert
    expect(mockFile.annotations).toHaveLength(1);
    expect(mockFile.annotations[0]).toEqual({
      time: 2.5,
      text: 'Keyboard Note',
    });
    // Should redraw chart to show new annotation
    expect(mockChartInstance.draw).toHaveBeenCalled();
  });

  test('Does not add annotation if prompt is cancelled', () => {
    ChartManager.activeChartIndex = 0;
    ChartManager.hoverValue = 3500;

    // User pressed Cancel
    jest.spyOn(window, 'prompt').mockReturnValue(null);

    ChartManager._addAnnotationViaKeyboard(0);

    expect(mockFile.annotations).toHaveLength(0);
  });

  test('Adds annotation via Double Click event on canvas', () => {
    // Setup Scale to return a specific time for the click
    mockChartInstance.scales.x.getValueForPixel.mockReturnValue(6000); // 5s relative

    jest.spyOn(window, 'prompt').mockReturnValue('Mouse Note');

    const canvas = document.getElementById('chart-0');

    // Trigger Double Click
    const dblClickEvent = new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
    });
    // Define offsetX since MouseEvent constructor doesn't support it directly
    Object.defineProperty(dblClickEvent, 'offsetX', { value: 100 });

    canvas.dispatchEvent(dblClickEvent);

    // Assert
    expect(mockFile.annotations).toHaveLength(1);
    expect(mockFile.annotations[0]).toEqual({
      time: 5.0, // (6000 - 1000) / 1000
      text: 'Mouse Note',
    });
  });

  test('Highlighter plugin renders visible annotations', () => {
    mockFile.annotations = [{ time: 10.0, text: 'Visible Note' }];

    // 2. Setup Zoom Range (Viewer sees 0s to 20s)
    mockChartInstance.scales.x.min = 1000;
    mockChartInstance.scales.x.max = 21000;

    // 3. Mock pixel conversion
    mockChartInstance.scales.x.getPixelForValue.mockReturnValue(50);

    // 4. IMPORTANT: Disable Hover/Tooltip interference
    // If these are active, the plugin draws a RED line after the ORANGE annotation,
    // overwriting ctx.strokeStyle in the mock.
    ChartManager.hoverValue = null;
    mockChartInstance.tooltip.getActiveElements.mockReturnValue([]);

    // 5. Execute
    ChartManager.highlighterPlugin.afterDraw(mockChartInstance);

    // 6. Assert
    expect(mockChartInstance.ctx.beginPath).toHaveBeenCalled();

    // Check that Orange color was applied (Annotation style)
    // Note: We use toHaveBeenCalledWith because the value might be overwritten later
    // by subsequent draw calls if we aren't careful, but checking the setter logic is safer.
    // However, since we disabled hover above, .toBe('#FFA500') should now work.
    expect(mockChartInstance.ctx.strokeStyle).toBe('#FFA500');

    expect(mockChartInstance.ctx.moveTo).toHaveBeenCalledWith(
      50,
      expect.any(Number)
    );
    expect(mockChartInstance.ctx.lineTo).toHaveBeenCalledWith(
      50,
      expect.any(Number)
    );
    expect(mockChartInstance.ctx.stroke).toHaveBeenCalled();

    // Check Text
    expect(mockChartInstance.ctx.fillText).toHaveBeenCalledWith(
      'Visible Note',
      expect.any(Number),
      expect.any(Number)
    );
  });

  test('Highlighter plugin skips annotations outside zoom range', () => {
    // 1. Setup Data: Annotation at 50s
    const localMockFile = {
      ...mockFile,
      annotations: [{ time: 50.0, text: 'Hidden Note' }],
    };

    // Force AppState to use this specific file instance to avoid pollution
    AppState.files = [localMockFile];
    AppState.chartInstances = [mockChartInstance];

    // 2. Setup View Range: Only 0s to 20s visible
    mockChartInstance.scales.x.min = 1000;
    mockChartInstance.scales.x.max = 21000;

    // 3. Setup Pixel Calculation
    // Even if getPixel returns a value, the logic checks time vs min/max first
    mockChartInstance.scales.x.getPixelForValue.mockReturnValue(500);

    // 4. Disable Hover
    ChartManager.hoverValue = null;
    mockChartInstance.tooltip.getActiveElements.mockReturnValue([]);

    // 5. Execute
    ChartManager.highlighterPlugin.afterDraw(mockChartInstance);

    // 6. Assert: Text should NOT be drawn because 50s > 20s (max)
    expect(mockChartInstance.ctx.fillText).not.toHaveBeenCalled();
  });
});
