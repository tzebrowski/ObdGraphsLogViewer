import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';

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
    scales: { x: { min: 0, max: 0 } },
  },
};

await jest.unstable_mockModule('chart.js', () => {
  const MockChart = jest.fn(() => mockChartInstance);
  MockChart.register = jest.fn();
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
    Tooltip: jest.fn(),
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

const { XYAnalysis } = await import('../src/xyanalysis.js');
const { AppState } = await import('../src/config.js');
const { Chart } = await import('chart.js');

describe('XYAnalysis Comprehensive Coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AppState.files = [];
    XYAnalysis.charts = [null, null];
    XYAnalysis.timelineChart = null;

    Chart.mockImplementation(() => mockChartInstance);

    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      canvas: document.createElement('canvas'),
      save: jest.fn(),
      restore: jest.fn(),
      fillRect: jest.fn(),
      measureText: jest.fn(() => ({ width: 0 })),
    });

    document.body.innerHTML = `
      <div id="xyModal" style="display: none;">
        <div class="modal-body"></div>
      </div>
      <select id="xyGlobalFile"></select>
      
      <select id="xyX-0"></select>
      <select id="xyY-0"></select>
      <select id="xyZ-0"></select>
      <canvas id="xyCanvas-0"></canvas>
      <div id="xyLegend-0" style="display:none;"></div>

      <select id="xyX-1"></select>
      <select id="xyY-1"></select>
      <select id="xyZ-1"></select>
      <canvas id="xyCanvas-1"></canvas>
      <div id="xyLegend-1" style="display:none;"></div>
      
      <canvas id="xyTimelineCanvas"></canvas>
    `;

    delete window.PaletteManager;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Legend Logic', () => {
    test('updateLegend() handles min=max edge case (Constant Value)', () => {
      XYAnalysis.updateLegend('0', 10, 10, 'Constant');
      const legend = document.getElementById('xyLegend-0');
      const values = legend.querySelectorAll('.legend-values span');
      expect(values[0].innerText).toBe('10.0');
      expect(values[4].innerText).toBe('10.0');
    });

    test('updateLegend() creates correct gradient structure', () => {
      XYAnalysis.updateLegend('0', 0, 100, 'Label');
      const legend = document.getElementById('xyLegend-0');
      expect(legend.querySelector('.gradient-bar')).not.toBeNull();
      expect(legend.querySelector('.z-axis-label').innerText).toBe('Label');
    });
  });

  describe('Data Synchronization (generateScatterData)', () => {
    test('Handles Millisecond Timestamps (Tolerance Logic)', () => {
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

    test('Skips points outside Tolerance', () => {
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

    test('Iterates "while" loops when Y/Z lag behind X', () => {
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

    test('getHeatColor handles min == max edge case', () => {
      const color = XYAnalysis.getHeatColor(10, 10, 10);
      expect(color).toBe('hsla(240, 100%, 50%, 0.8)');
    });
  });

  describe('Timeline Rendering', () => {
    test('renderTimeline() skips signals not found in file', () => {
      AppState.files = [{ startTime: 0, signals: { A: [{ x: 0, y: 0 }] } }];

      XYAnalysis.renderTimeline(0, ['A', 'B']);

      expect(Chart).toHaveBeenCalled();
      const config = Chart.mock.calls[0][1];
      expect(config.data.datasets).toHaveLength(1);
      expect(config.data.datasets[0].label).toBe('A');
    });

    test('renderTimeline() handles Min=Max normalization (avoid divide-by-zero)', () => {
      AppState.files = [
        {
          startTime: 0,
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

    test('Tooltip Callback execution (Timeline)', () => {
      AppState.files = [{ startTime: 0, signals: { S1: [{ x: 0, y: 50 }] } }];
      XYAnalysis.renderTimeline(0, ['S1']);

      const config = Chart.mock.calls[0][1];
      const callback = config.options.plugins.tooltip.callbacks.label;

      const context = {
        dataset: { label: 'S1' },
        raw: { originalValue: 50.1234 },
      };
      const text = callback(context);

      expect(text).toBe('S1: 50.12');
    });

    test('Color Logic: Uses window.PaletteManager if present', () => {
      AppState.files = [{ startTime: 0, signals: { S1: [{ x: 0, y: 0 }] } }];

      window.PaletteManager = { getColorForSignal: jest.fn(() => '#ABCDEF') };

      XYAnalysis.renderTimeline(0, ['S1']);

      const config = Chart.mock.calls[0][1];
      expect(config.data.datasets[0].borderColor).toBe('#ff0000');
    });
  });

  describe('Scatter Plot Interaction', () => {
    test('Tooltip Callback execution (Scatter)', () => {
      jest
        .spyOn(XYAnalysis, 'generateScatterData')
        .mockReturnValue([{ x: 1, y: 2, z: 3 }]);

      XYAnalysis.renderChart('0', 0, 'A', 'B', 'C');

      const config = Chart.mock.calls[0][1];
      const callback = config.options.plugins.tooltip.callbacks.label;

      const context = { raw: { x: 1.111, y: 2.222, z: 3.333 } };
      const text = callback(context);

      expect(text).toContain('X: 1.11');
      expect(text).toContain('Y: 2.22');
      expect(text).toContain('Z: 3.33');
    });
  });
});
