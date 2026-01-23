import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';

// 1. Define mock instances outside to be reused
const mockChartInstance = {
  destroy: jest.fn(),
  update: jest.fn(),
  draw: jest.fn(),
  resetZoom: jest.fn(),
  width: 1000,
  scales: { x: { min: 0, max: 1000, getValueForPixel: jest.fn() } },
  data: { datasets: [] },
  options: {
    plugins: { datalabels: {}, zoom: {}, tooltip: { callbacks: {} } },
    scales: { x: { min: 0, max: 0, title: {} }, y: { title: {} } },
  },
};

// 2. Mock Chart.js
await jest.unstable_mockModule('chart.js', () => {
  const MockChart = jest.fn(() => mockChartInstance);
  MockChart.register = jest.fn();

  const MockTooltip = jest.fn();
  MockTooltip.positioners = {};

  return {
    __esModule: true,
    Chart: MockChart,
    ScatterController: jest.fn(),
    LineController: jest.fn(),
    PointElement: jest.fn(),
    LineElement: jest.fn(),
    LinearScale: jest.fn(),
    TimeScale: jest.fn(),
    Legend: jest.fn(),
    Tooltip: MockTooltip,
    _adapters: { _date: {} },
  };
});

await jest.unstable_mockModule('chartjs-adapter-date-fns', () => ({}));

const mockZoomPlugin = { id: 'zoom' };
await jest.unstable_mockModule('chartjs-plugin-zoom', () => ({
  default: mockZoomPlugin,
}));

await jest.unstable_mockModule('../src/ui.js', () => ({ UI: {} }));
await jest.unstable_mockModule('../src/config.js', () => ({
  AppState: { files: [] },
}));

await jest.unstable_mockModule('../src/palettemanager.js', () => ({
  PaletteManager: { getColorForSignal: jest.fn(() => '#ff0000') },
}));

// Variables for fresh module instances per test
let XYAnalysis;
let AppState;
let Chart;

describe('XYAnalysis Suite - 1', () => {
  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();

    // 4. Setup DOM - Note: IDs match what the code expects.
    // The code replaces <select> with <div> wrappers, so we start with the "before" state
    // or just empty containers where the code will append stuff.
    // Based on the code: if it finds a SELECT, it replaces it. If it finds a DIV, it uses it.
    // We will start with DIVs to simulate the "ready" state or SELECTs to test replacement.
    document.body.innerHTML = `
      <div id="xyModal" style="display: none;">
        <div class="modal-body"></div>
      </div>
      <div id="xyGlobalFile"></div>
      
      <div id="xyX-0"></div>
      <div id="xyY-0"></div>
      <div id="xyZ-0"></div>
      <canvas id="xyCanvas-0"></canvas>
      <div id="xyLegend-0" style="display:none;"></div>

      <div id="xyX-1"></div>
      <div id="xyY-1"></div>
      <div id="xyZ-1"></div>
      <canvas id="xyCanvas-1"></canvas>
      <div id="xyLegend-1" style="display:none;"></div>
      
      <canvas id="xyTimelineCanvas"></canvas>
    `;

    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      canvas: document.createElement('canvas'),
      save: jest.fn(),
      restore: jest.fn(),
      fillRect: jest.fn(),
      measureText: jest.fn(() => ({ width: 0 })),
    });

    const xyModule = await import('../src/xyanalysis.js');
    XYAnalysis = xyModule.XYAnalysis;

    const configModule = await import('../src/config.js');
    AppState = configModule.AppState;
    AppState.files = [];

    const chartModule = await import('chart.js');
    Chart = chartModule.Chart;

    if (XYAnalysis.charts) XYAnalysis.charts = [null, null];
    if (XYAnalysis.timelineChart) XYAnalysis.timelineChart = null;
    XYAnalysis.currentFileIndex = undefined; // Reset state

    Chart.mockImplementation(() => mockChartInstance);
    // Ensure PaletteManager is available globally if code relies on window.PaletteManager
    // or checks it. The code imports it, but some checks use window.PaletteManager.
    // The mock above handles the import.
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Helper to get value from the custom searchable select
  const getCustomValue = (id) => {
    const container = document.getElementById(id);
    const input = container.querySelector('input');
    return input ? input.value : '';
  };

  describe('UI Interaction', () => {
    test('init registers Chart.js plugins', () => {
      XYAnalysis.init();
      expect(Chart.register).toHaveBeenCalled();
    });

    test('openXYModal shows modal and triggers file population', () => {
      const modal = document.getElementById('xyModal');
      const spy = jest.spyOn(XYAnalysis, 'populateGlobalFileSelector');

      XYAnalysis.openXYModal();

      expect(modal.style.display).toBe('flex');
      expect(spy).toHaveBeenCalled();
    });

    test('closeXYModal hides modal', () => {
      const modal = document.getElementById('xyModal');
      modal.style.display = 'flex';

      XYAnalysis.closeXYModal();

      expect(modal.style.display).toBe('none');
    });

    test('populateGlobalFileSelector fills searchable list and triggers change', () => {
      AppState.files = [
        { name: 'Trip A', availableSignals: [], signals: {} },
        { name: 'Trip B', availableSignals: [], signals: {} },
      ];
      const spy = jest.spyOn(XYAnalysis, 'onFileChange');

      XYAnalysis.populateGlobalFileSelector();

      const container = document.getElementById('xyGlobalFile');
      const input = container.querySelector('input');
      const list = container.querySelector('.search-results-list');

      // Default selection sets input value, which acts as a filter
      expect(input.value).toBe('Trip A');

      // Clear filter to show all options
      input.value = '';
      input.dispatchEvent(new Event('input'));

      expect(list.children.length).toBe(2);
      expect(list.children[0].innerText).toBe('Trip A');
      expect(spy).toHaveBeenCalled();
    });

    test('onFileChange populates axis selectors and sets defaults', () => {
      AppState.files = [
        {
          name: 'Trip A',
          availableSignals: [
            'Engine Rpm',
            'Intake Manifold Pressure',
            'Air Mass',
          ],
          signals: {
            'Engine Rpm': [],
            'Intake Manifold Pressure': [],
            'Air Mass': [],
          },
        },
      ];

      // Setup global file selector first
      XYAnalysis.populateGlobalFileSelector();

      const updateTimelineSpy = jest.spyOn(XYAnalysis, 'updateTimeline');

      XYAnalysis.onFileChange();

      expect(getCustomValue('xyX-0')).toBe('Engine Rpm');
      expect(getCustomValue('xyY-0')).toBe('Intake Manifold Pressure');
      expect(updateTimelineSpy).toHaveBeenCalled();
    });

    test('onFileChange handles missing file gracefully', () => {
      AppState.files = [];
      // Manually set index to something invalid or just call it
      XYAnalysis.currentFileIndex = 0;
      expect(() => XYAnalysis.onFileChange()).not.toThrow();
    });
  });

  describe('Legend Logic', () => {
    test('updateLegend handles constant values correctly', () => {
      XYAnalysis.updateLegend('0', 10, 10, 'Constant');
      const legend = document.getElementById('xyLegend-0');
      const values = legend.querySelectorAll('.legend-values span');
      expect(values[0].innerText).toBe('10.0');
      expect(values[4].innerText).toBe('10.0');
    });

    test('updateLegend creates correct gradient structure', () => {
      XYAnalysis.updateLegend('0', 0, 100, 'Label');
      const legend = document.getElementById('xyLegend-0');
      expect(legend.querySelector('.gradient-bar')).not.toBeNull();
      expect(legend.querySelector('.z-axis-label').innerText).toBe('Label');
    });

    test('updateLegend returns early if element missing', () => {
      document.getElementById('xyLegend-0').remove();
      expect(() => XYAnalysis.updateLegend('0', 0, 10, 'L')).not.toThrow();
    });
  });

  describe('Data Processing', () => {
    test('generateScatterData handles millisecond timestamp tolerance', () => {
      AppState.files = [
        {
          signals: {
            X: [{ x: 200000, y: 1 }],
            Y: [{ x: 200100, y: 2 }],
            Z: [{ x: 200499, y: 3 }],
          },
        },
      ];

      const result = XYAnalysis.generateScatterData(0, 'X', 'Y', 'Z');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ x: 1, y: 2, z: 3 });
    });

    test('generateScatterData skips points outside tolerance', () => {
      AppState.files = [
        {
          signals: {
            X: [{ x: 1.0, y: 1 }],
            Y: [{ x: 2.0, y: 2 }],
            Z: [{ x: 1.0, y: 3 }],
          },
        },
      ];

      const result = XYAnalysis.generateScatterData(0, 'X', 'Y', 'Z');
      expect(result).toHaveLength(0);
    });

    test('generateScatterData synchronizes lagging signals', () => {
      AppState.files = [
        {
          signals: {
            X: [{ x: 50.0, y: 100 }],
            Y: [
              { x: 1.0, y: 1 },
              { x: 2.0, y: 2 },
              { x: 50.0, y: 10 },
            ],
            Z: [
              { x: 5.0, y: 5 },
              { x: 50.0, y: 20 },
            ],
          },
        },
      ];

      const result = XYAnalysis.generateScatterData(0, 'X', 'Y', 'Z');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ x: 100, y: 10, z: 20 });
    });

    test('getHeatColor returns default blue when min equals max', () => {
      const color = XYAnalysis.getHeatColor(10, 10, 10);
      expect(color).toBe('hsla(240, 100%, 50%, 0.8)');
    });
  });

  describe('Chart Rendering', () => {
    test('renderChart handles empty data gracefully', () => {
      jest.spyOn(XYAnalysis, 'generateScatterData').mockReturnValue([]);
      XYAnalysis.renderChart('0', 0, 'A', 'B', 'C');
      expect(Chart).toHaveBeenCalledTimes(0);
    });

    test('resetAllZooms resets scatter and timeline charts', () => {
      XYAnalysis.charts = [mockChartInstance, null];
      XYAnalysis.timelineChart = mockChartInstance;
      XYAnalysis.resetAllZooms();
      expect(mockChartInstance.resetZoom).toHaveBeenCalledTimes(2);
    });

    test('Scatter chart uses external tooltip handler', () => {
      jest
        .spyOn(XYAnalysis, 'generateScatterData')
        .mockReturnValue([{ x: 1, y: 2, z: 3 }]);

      // Need valid file with availableSignals for tooltip logic
      AppState.files = [
        {
          availableSignals: ['A', 'B', 'C'],
          signals: {},
        },
      ];

      XYAnalysis.renderChart('0', 0, 'A', 'B', 'C');

      const config = Chart.mock.calls[0][1];
      const tooltipConfig = config.options.plugins.tooltip;

      // New implementation disables default tooltip and uses external
      expect(tooltipConfig.enabled).toBe(false);
      expect(typeof tooltipConfig.external).toBe('function');
    });
  });

  describe('Timeline Integration', () => {
    test('renderTimeline creates chart with normalized data', () => {
      AppState.files = [
        {
          startTime: 1000,
          availableSignals: ['RPM', 'Boost'], // Required for color lookup
          signals: {
            RPM: [
              { x: 1000, y: 0 },
              { x: 2000, y: 6000 },
            ],
            Boost: [
              { x: 1000, y: 0 },
              { x: 2000, y: 1.5 },
            ],
          },
        },
      ];

      XYAnalysis.renderTimeline(0, ['RPM', 'Boost']);

      expect(Chart).toHaveBeenCalled();
      const config = Chart.mock.calls[0][1];
      const datasets = config.data.datasets;

      expect(datasets.length).toBe(2);

      const rpmData = datasets.find((d) => d.label === 'RPM').data;
      expect(rpmData[0].y).toBeCloseTo(0);
      expect(rpmData[1].y).toBeCloseTo(1);
    });

    test('Timeline tooltip returns original values', () => {
      // Required for color lookup inside renderTimeline map loop
      AppState.files = [
        {
          startTime: 0,
          availableSignals: ['S1'],
          signals: { S1: [{ x: 0, y: 50 }] },
        },
      ];

      XYAnalysis.renderTimeline(0, ['S1']);

      const config = Chart.mock.calls[0][1];
      const callback = config.options.plugins.tooltip.callbacks.label;
      const context = {
        dataset: { label: 'S1' },
        raw: { originalValue: 50.1234 },
      };

      expect(callback(context)).toBe('S1: 50.12');
    });

    test('renderTimeline uses PaletteManager module color', () => {
      AppState.files = [
        {
          startTime: 0,
          availableSignals: ['SigA'],
          signals: { SigA: [{ x: 0, y: 0 }] },
        },
      ];
      // Removed erroneous require()
      // The PaletteManager mock is active via jest.unstable_mockModule
      XYAnalysis.renderTimeline(0, ['SigA']);
      const config = Chart.mock.calls[0][1];
      expect(config.data.datasets[0].borderColor).toBe('#ff0000');
    });

    test('renderTimeline handles flatline signals', () => {
      AppState.files = [
        {
          startTime: 0,
          availableSignals: ['Flat'],
          signals: {
            Flat: [
              { x: 0, y: 100 },
              { x: 1, y: 100 },
            ],
          },
        },
      ];

      XYAnalysis.renderTimeline(0, ['Flat']);

      const config = Chart.mock.calls[0][1];
      const data = config.data.datasets[0].data;
      expect(data[0].y).toBe(0);
    });

    test('renderTimeline returns early if canvas missing', () => {
      document.getElementById('xyTimelineCanvas').remove();
      XYAnalysis.renderTimeline(0, ['RPM']);
      expect(Chart).not.toHaveBeenCalled();
    });

    test('updateTimeline aggregates signals and calls render', () => {
      // Helper to set value in custom input
      const setCustomVal = (id, val) => {
        const container = document.getElementById(id);
        // Ensure container has input (it should from beforeEach)
        if (!container.querySelector('input')) {
          container.innerHTML = `<input class="searchable-input" value="${val}" />`;
        } else {
          container.querySelector('input').value = val;
        }
      };

      // Mock createSearchableSelect behavior manually since we are not clicking UI
      setCustomVal('xyGlobalFile', '0');
      setCustomVal('xyX-0', 'S1');
      setCustomVal('xyY-0', 'S2');
      setCustomVal('xyZ-0', 'S1');
      setCustomVal('xyX-1', 'S3');
      setCustomVal('xyY-1', '');
      setCustomVal('xyZ-1', '');

      AppState.files = [
        {
          startTime: 0,
          availableSignals: ['S1', 'S2', 'S3'],
          signals: { S1: [], S2: [], S3: [] },
        },
      ];
      XYAnalysis.currentFileIndex = 0;

      const spy = jest.spyOn(XYAnalysis, 'renderTimeline');

      XYAnalysis.updateTimeline();

      expect(spy).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining(['S1', 'S2', 'S3'])
      );
    });

    test('plot triggers chart render and timeline update', () => {
      const scatterSpy = jest
        .spyOn(XYAnalysis, 'renderChart')
        .mockImplementation(() => {});
      const timelineSpy = jest
        .spyOn(XYAnalysis, 'updateTimeline')
        .mockImplementation(() => {});

      // Manually setup inputs
      const setCustomVal = (id, val) => {
        document.getElementById(id).innerHTML = `<input value="${val}">`;
      };
      setCustomVal('xyX-0', 'A');
      setCustomVal('xyY-0', 'B');
      setCustomVal('xyZ-0', 'C');

      AppState.files = [{ name: 'F', startTime: 0, signals: {} }];
      XYAnalysis.currentFileIndex = 0;

      XYAnalysis.plot('0');

      expect(scatterSpy).toHaveBeenCalled();
      expect(timelineSpy).toHaveBeenCalled();
    });
  });

  describe('Extended Coverage', () => {
    test('getHeatColor generates correct gradient range', () => {
      expect(XYAnalysis.getHeatColor(0, 0, 100)).toContain('240'); // Blue
      expect(XYAnalysis.getHeatColor(100, 0, 100)).toContain('0'); // Red
      expect(XYAnalysis.getHeatColor(50, 0, 100)).toContain('120'); // Green
    });

    test('renderChart configures Axis Titles and Zoom options', () => {
      AppState.files = [
        {
          availableSignals: ['X', 'Y', 'Z'],
          signals: {
            X: [{ x: 1, y: 1 }],
            Y: [{ x: 1, y: 1 }],
            Z: [{ x: 1, y: 1 }],
          },
        },
      ];
      jest
        .spyOn(XYAnalysis, 'generateScatterData')
        .mockReturnValue([{ x: 1, y: 1, z: 1 }]);

      XYAnalysis.renderChart('0', 0, 'X', 'Y', 'Z');

      expect(Chart).toHaveBeenCalled();
      const config = Chart.mock.calls[0][1];

      expect(config.options.scales.x.title.text).toBe('X');
      expect(config.options.scales.y.title.text).toBe('Y');
      expect(config.options.plugins.zoom.zoom.wheel.enabled).toBe(true);
    });

    test('generateScatterData handles partial overlap', () => {
      AppState.files = [
        {
          signals: {
            X: [
              { x: 100, y: 1 },
              { x: 200, y: 2 },
              { x: 300, y: 3 },
            ],
            Y: [{ x: 200, y: 20 }],
            Z: [{ x: 200, y: 30 }],
          },
        },
      ];

      const data = XYAnalysis.generateScatterData(0, 'X', 'Y', 'Z');

      expect(data).toHaveLength(1);
      expect(data[0].x).toBe(2);
      expect(data[0].y).toBe(20);
    });
  });
});
