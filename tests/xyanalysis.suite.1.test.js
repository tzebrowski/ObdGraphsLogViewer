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

describe('XYAnalysis Controller', () => {
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

    test('populateGlobalFileSelector fills dropdown and triggers change', () => {
      AppState.files = [
        { name: 'Trip A', availableSignals: [] },
        { name: 'Trip B', availableSignals: [] },
      ];
      const spy = jest.spyOn(XYAnalysis, 'onFileChange');

      XYAnalysis.populateGlobalFileSelector();

      const select = document.getElementById('xyGlobalFile');
      expect(select.children.length).toBe(2);
      expect(select.children[0].text).toBe('Trip A');
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

      const globalSel = document.getElementById('xyGlobalFile');
      globalSel.innerHTML = '<option value="0">Trip A</option>';
      globalSel.value = '0';

      const updateTimelineSpy = jest.spyOn(XYAnalysis, 'updateTimeline');

      XYAnalysis.onFileChange();

      expect(document.getElementById('xyX-0').value).toBe('Engine Rpm');
      expect(document.getElementById('xyY-0').value).toBe(
        'Intake Manifold Pressure'
      );
      expect(updateTimelineSpy).toHaveBeenCalled();
    });

    test('onFileChange handles missing file gracefully', () => {
      AppState.files = [];
      document.getElementById('xyGlobalFile').value = '0';

      expect(() => XYAnalysis.onFileChange()).not.toThrow();
    });

    test('setSelectValue selects option if partial match found', () => {
      const select = document.getElementById('xyX-0');
      select.innerHTML = '<option value="Some Long Signal Name">Label</option>';

      XYAnalysis.setSelectValue('xyX-0', 'Signal Name');
      expect(select.value).toBe('Some Long Signal Name');
    });

    test('setSelectValue does nothing if no match found', () => {
      const select = document.getElementById('xyX-0');
      select.innerHTML = '<option value="A">A</option>';
      select.value = 'A';

      XYAnalysis.setSelectValue('xyX-0', 'Z');
      expect(select.value).toBe('A');
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

    test('Scatter tooltip callback formats values correctly', () => {
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

  describe('Timeline Integration', () => {
    test('renderTimeline creates chart with normalized data', () => {
      AppState.files = [
        {
          startTime: 1000,
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
      AppState.files = [{ startTime: 0, signals: { S1: [{ x: 0, y: 50 }] } }];
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
      AppState.files = [{ startTime: 0, signals: { SigA: [{ x: 0, y: 0 }] } }];
      window.PaletteManager = { getColorForSignal: jest.fn(() => '#123456') };

      XYAnalysis.renderTimeline(0, ['SigA']);

      const config = Chart.mock.calls[0][1];
      expect(config.data.datasets[0].borderColor).toBe('#ff0000');
    });

    test('renderTimeline handles flatline signals', () => {
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

    test('renderTimeline returns early if canvas missing', () => {
      document.getElementById('xyTimelineCanvas').remove();
      XYAnalysis.renderTimeline(0, ['RPM']);
      expect(Chart).not.toHaveBeenCalled();
    });

    test('updateTimeline aggregates signals and calls render', () => {
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        el.innerHTML = `<option value="${val}">${val}</option>`;
        el.value = val;
      };
      setVal('xyGlobalFile', '0');
      setVal('xyX-0', 'S1');
      setVal('xyY-0', 'S2');
      setVal('xyZ-0', 'S1');
      setVal('xyX-1', 'S3');
      setVal('xyY-1', '');
      setVal('xyZ-1', '');

      AppState.files = [{ startTime: 0, signals: { S1: [], S2: [], S3: [] } }];

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

      const setVal = (id, val) => {
        const el = document.getElementById(id);
        el.innerHTML = `<option value="${val}">${val}</option>`;
        el.value = val;
      };

      document.getElementById('xyGlobalFile').innerHTML =
        '<option value="0">F</option>';
      document.getElementById('xyGlobalFile').value = '0';
      setVal('xyX-0', 'A');
      setVal('xyY-0', 'B');
      setVal('xyZ-0', 'C');

      AppState.files = [{ name: 'F', startTime: 0, signals: {} }];

      XYAnalysis.plot('0');

      expect(scatterSpy).toHaveBeenCalled();
      expect(timelineSpy).toHaveBeenCalled();
    });
  });
});
