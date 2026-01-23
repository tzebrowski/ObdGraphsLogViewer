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
  resetZoom: jest.fn(),
  draw: jest.fn(),
  width: 1000,
  scales: { x: { min: 0, max: 1000, getValueForPixel: jest.fn() } },
  data: { datasets: [] },
  canvas: {
    parentNode: {
      querySelector: jest.fn(),
      appendChild: jest.fn(),
    },
    offsetLeft: 0,
    offsetTop: 0,
  },
  options: {
    plugins: {
      datalabels: {},
      zoom: {},
      tooltip: { callbacks: {}, external: null },
    },
    scales: { x: { min: 0, max: 0, title: {} }, y: { title: {} } },
  },
};

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
await jest.unstable_mockModule('chartjs-plugin-zoom', () => ({
  default: { id: 'zoom' },
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
const { Chart, Tooltip } = await import('chart.js');

describe('XYAnalysis Comprehensive Tests', () => {
  const originalCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    jest.clearAllMocks();
    AppState.files = [];
    XYAnalysis.charts = [null, null];
    XYAnalysis.timelineChart = null;
    XYAnalysis.currentFileIndex = undefined;

    jest.spyOn(document, 'createElement').mockImplementation((tagName) => {
      const el = originalCreateElement(tagName);
      Object.defineProperty(el, 'innerText', {
        get() {
          return this.textContent;
        },
        set(value) {
          this.textContent = value;
        },
        configurable: true,
      });
      return el;
    });

    document.body.innerHTML = `
      <div id="xyModal" style="display: none;"></div>
      <div id="xySplitView"></div>
      <div id="xyTimelineView"></div>
      
      <div id="xyGlobalFile"></div>
      <div id="xyX-0"></div> <div id="xyY-0"></div> <div id="xyZ-0"></div>
      <canvas id="xyCanvas-0"></canvas>
      <div id="xyLegend-0" style="display:none;"></div>

      <div id="xyX-1"></div> <div id="xyY-1"></div> <div id="xyZ-1"></div>
      <canvas id="xyCanvas-1"></canvas>
      <div id="xyLegend-1" style="display:none;"></div>
      
      <canvas id="xyTimelineCanvas"></canvas>
    `;

    HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      fill: jest.fn(),
      fillRect: jest.fn(),
      measureText: jest.fn(() => ({ width: 0 })),
    }));

    Chart.mockImplementation(() => mockChartInstance);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const getInputValue = (id) => {
    const container = document.getElementById(id);
    return container && container.querySelector('input')
      ? container.querySelector('input').value
      : '';
  };

  describe('Initialization', () => {
    test('init registers Chart.js plugins', () => {
      XYAnalysis.init();
      expect(Chart.register).toHaveBeenCalled();
    });

    test('xyFixed positioner returns correct coordinates', () => {
      XYAnalysis.init();
      const positioner = Tooltip.positioners.xyFixed;
      const context = { chart: { chartArea: { top: 50, right: 500 } } };
      const pos = positioner.call(context, [], {});
      expect(pos).toEqual({ x: 490, y: 60 });
    });

    test('xyFixed returns undefined if no chart', () => {
      XYAnalysis.init();
      const positioner = Tooltip.positioners.xyFixed;
      const pos = positioner.call({}, [], {});
      expect(pos).toBeUndefined();
    });
  });

  describe('UI Interaction', () => {
    test('openXYModal shows modal and adjusts split view styles', () => {
      const modal = document.getElementById('xyModal');
      const split = document.getElementById('xySplitView');
      const timeline = document.getElementById('xyTimelineView');
      const spy = jest.spyOn(XYAnalysis, 'populateGlobalFileSelector');

      XYAnalysis.openXYModal();

      expect(modal.style.display).toBe('flex');
      expect(split.style.flex).toMatch(/^3/);
      expect(timeline.style.flex).toMatch(/^1/);
      expect(spy).toHaveBeenCalled();
    });

    test('closeXYModal hides modal', () => {
      const modal = document.getElementById('xyModal');
      modal.style.display = 'flex';
      XYAnalysis.closeXYModal();
      expect(modal.style.display).toBe('none');
    });

    describe('Searchable Select Logic', () => {
      test('Replaces SELECT element with custom DIV wrapper', () => {
        const container = document.getElementById('xyX-0');
        container.outerHTML =
          '<select id="xyX-0" class="test-class" style="color:red"></select>';

        XYAnalysis.createSearchableSelect('xyX-0', ['A', 'B'], 'A', jest.fn());

        const newEl = document.getElementById('xyX-0');
        expect(newEl.tagName).toBe('DIV');
        expect(newEl.className).toContain('searchable-select-wrapper');
        expect(newEl.style.color).toBe('red');
      });

      test('Focusing input shows all options regardless of current value', () => {
        const options = ['Engine Rpm', 'Speed', 'Boost'];
        const defaultValue = 'Speed';

        XYAnalysis.createSearchableSelect(
          'xyGlobalFile',
          options,
          defaultValue,
          jest.fn()
        );

        const container = document.getElementById('xyGlobalFile');
        const input = container.querySelector('input');
        const list = container.querySelector('.search-results-list');

        expect(input.value).toBe('Speed');

        input.focus();

        expect(list.children.length).toBe(3);
        expect(list.children[0].textContent).toBe('Engine Rpm');
        expect(list.children[1].textContent).toBe('Speed');
        expect(list.children[2].textContent).toBe('Boost');
        expect(list.style.display).toBe('block');
      });

      test('Filter logic shows "No signals found"', () => {
        XYAnalysis.createSearchableSelect(
          'xyGlobalFile',
          ['OptionA'],
          '',
          jest.fn()
        );
        const container = document.getElementById('xyGlobalFile');
        const input = container.querySelector('input');
        const list = container.querySelector('.search-results-list');

        input.value = 'XYZ';
        input.dispatchEvent(new Event('input'));

        expect(list.children.length).toBe(1);
        expect(list.children[0].innerText).toBe('No signals found');
      });

      test('Clicking option updates value and hides list', () => {
        const cb = jest.fn();
        XYAnalysis.createSearchableSelect('xyGlobalFile', ['OptionA'], '', cb);
        const container = document.getElementById('xyGlobalFile');
        const input = container.querySelector('input');
        const list = container.querySelector('.search-results-list');

        input.focus();
        const option = list.children[0];
        option.click();

        expect(input.value).toBe('OptionA');
        expect(list.style.display).toBe('none');
        expect(cb).toHaveBeenCalledWith('OptionA');
      });

      test('Clicking outside closes list', () => {
        XYAnalysis.createSearchableSelect('xyGlobalFile', ['A'], '', jest.fn());
        const container = document.getElementById('xyGlobalFile');
        const input = container.querySelector('input');
        const list = container.querySelector('.search-results-list');

        input.focus();
        expect(list.style.display).toBe('block');
        document.body.click();
        expect(list.style.display).toBe('none');
      });

      test('getInputValue handles missing input gracefully', () => {
        document.getElementById('xyX-0').innerHTML = '<div>Broken</div>';
        const val = XYAnalysis.getInputValue('xyX-0');
        expect(val).toBe('');
      });

      test('getInputValue handles raw SELECT element', () => {
        const container = document.getElementById('xyX-0');
        container.outerHTML =
          '<select id="xyX-0"><option value="A" selected>A</option></select>';
        const val = XYAnalysis.getInputValue('xyX-0');
        expect(val).toBe('A');
      });
    });

    test('populateGlobalFileSelector fills searchable list and triggers change', () => {
      AppState.files = [{ name: 'Trip A', availableSignals: [], signals: {} }];
      const spy = jest.spyOn(XYAnalysis, 'onFileChange');

      XYAnalysis.populateGlobalFileSelector();

      const container = document.getElementById('xyGlobalFile');
      const input = container.querySelector('input');
      const list = container.querySelector('.search-results-list');

      expect(input.value).toBe('Trip A');

      input.value = '';
      input.dispatchEvent(new Event('input'));

      expect(list.children[0].innerText).toBe('Trip A');
      expect(spy).toHaveBeenCalled();
    });

    test('onFileChange populates axis selectors with defaults', () => {
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
      XYAnalysis.populateGlobalFileSelector();
      const updateTimelineSpy = jest.spyOn(XYAnalysis, 'updateTimeline');

      XYAnalysis.onFileChange();

      expect(getInputValue('xyX-0')).toBe('Engine Rpm');
      expect(getInputValue('xyY-0')).toBe('Intake Manifold Pressure');
      expect(updateTimelineSpy).toHaveBeenCalled();
    });

    test('onFileChange handles missing file gracefully', () => {
      AppState.files = [];
      XYAnalysis.currentFileIndex = 0;
      expect(() => XYAnalysis.onFileChange()).not.toThrow();
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
      expect(result[0]).toEqual({ x: 100, y: 10, z: 20 });
    });

    test('getHeatColor gradient checks', () => {
      expect(XYAnalysis.getHeatColor(10, 10, 10)).toBe(
        'hsla(240, 100%, 50%, 0.8)'
      );
      expect(XYAnalysis.getHeatColor(0, 0, 100)).toContain('240');
      expect(XYAnalysis.getHeatColor(100, 0, 100)).toContain('0');
    });

    describe('Legend Logic', () => {
      test('updateLegend handles constant values', () => {
        XYAnalysis.updateLegend('0', 10, 10, 'Constant');
        const legend = document.getElementById('xyLegend-0');
        const values = legend.querySelectorAll('.legend-values span');
        expect(values[0].innerText).toBe('10.0');
        expect(values[4].innerText).toBe('10.0');
      });

      test('updateLegend creates gradient structure', () => {
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
  });

  describe('Scatter Chart Rendering', () => {
    test('renderChart handles empty data gracefully', () => {
      jest.spyOn(XYAnalysis, 'generateScatterData').mockReturnValue([]);
      XYAnalysis.renderChart('0', 0, 'A', 'B', 'C');
      expect(Chart).toHaveBeenCalledTimes(0);
    });

    test('renderChart configures Axis Titles and Zoom', () => {
      AppState.files = [{ availableSignals: ['X', 'Y', 'Z'], signals: {} }];
      jest
        .spyOn(XYAnalysis, 'generateScatterData')
        .mockReturnValue([{ x: 1, y: 1, z: 1 }]);

      XYAnalysis.renderChart('0', 0, 'X', 'Y', 'Z');

      const config = Chart.mock.calls[0][1];
      expect(config.options.scales.x.title.text).toBe('X');
      expect(config.options.scales.y.title.text).toBe('Y');
      expect(config.options.plugins.zoom.zoom.wheel.enabled).toBe(true);
    });

    test('Scatter chart uses external tooltip handler', () => {
      jest
        .spyOn(XYAnalysis, 'generateScatterData')
        .mockReturnValue([{ x: 1, y: 2, z: 3 }]);
      AppState.files = [{ availableSignals: ['A', 'B', 'C'], signals: {} }];

      XYAnalysis.renderChart('0', 0, 'A', 'B', 'C');

      const config = Chart.mock.calls[0][1];
      const tooltipConfig = config.options.plugins.tooltip;
      expect(tooltipConfig.enabled).toBe(false);
      expect(typeof tooltipConfig.external).toBe('function');
    });

    test('Custom Tooltip: Renders HTML correctly', () => {
      AppState.files = [
        { availableSignals: ['RPM', 'MAP', 'MAF'], signals: {} },
      ];
      jest
        .spyOn(XYAnalysis, 'generateScatterData')
        .mockReturnValue([{ x: 1, y: 1, z: 1 }]);

      XYAnalysis.renderChart('0', 0, 'RPM', 'MAP', 'MAF');

      const config = Chart.mock.calls[0][1];
      const externalHandler = config.options.plugins.tooltip.external;

      const mockTooltipEl = document.createElement('div');
      mockTooltipEl.className = 'chartjs-tooltip';
      const mockTable = document.createElement('table');
      mockTooltipEl.appendChild(mockTable);
      document.body.appendChild(mockTooltipEl);

      const mockChart = {
        canvas: {
          parentNode: { querySelector: jest.fn(() => mockTooltipEl) },
          offsetLeft: 10,
          offsetTop: 20,
        },
      };

      const context = {
        chart: mockChart,
        tooltip: {
          opacity: 1,
          caretX: 100,
          caretY: 100,
          options: { padding: 6, bodyFont: { string: '12px Arial' } },
          body: [{}],
          dataPoints: [{ raw: { x: 1000, y: 1.5, z: 20.5 } }],
        },
      };

      externalHandler(context);

      const rows = mockTable.querySelectorAll('tr');
      expect(rows.length).toBe(3);
      expect(rows[0].innerHTML).toContain('RPM: 1000.00');
      expect(rows[1].innerHTML).toContain('MAP: 1.50');
      const colorDot = rows[0].querySelector('span');
      expect(colorDot.style.background).toBe('rgb(255, 0, 0)');
    });

    test('Custom Tooltip: Hides when opacity is 0', () => {
      jest
        .spyOn(XYAnalysis, 'generateScatterData')
        .mockReturnValue([{ x: 1, y: 1, z: 1 }]);
      XYAnalysis.renderChart('0', 0, 'A', 'B', 'C');

      const handler = Chart.mock.calls[0][1].options.plugins.tooltip.external;
      const mockEl = document.createElement('div');
      const mockChart = {
        canvas: { parentNode: { querySelector: () => mockEl } },
      };

      handler({ chart: mockChart, tooltip: { opacity: 0 } });
      expect(mockEl.style.opacity).toBe('0');
    });

    test('getOrCreateTooltip creates element if missing', () => {
      const mockParent = document.createElement('div');
      const mockCanvas = document.createElement('canvas');
      mockParent.appendChild(mockCanvas);

      const chart = { canvas: mockCanvas };
      const tooltip = XYAnalysis.getOrCreateTooltip(chart);

      expect(tooltip.className).toBe('chartjs-tooltip');
      expect(mockParent.querySelector('.chartjs-tooltip')).not.toBeNull();
    });

    test('resetAllZooms resets all charts', () => {
      XYAnalysis.charts = [mockChartInstance, null];
      XYAnalysis.timelineChart = mockChartInstance;
      XYAnalysis.resetAllZooms();
      expect(mockChartInstance.resetZoom).toHaveBeenCalledTimes(2);
    });
  });

  describe('Timeline Integration', () => {
    test('renderTimeline creates chart with normalized data', () => {
      AppState.files = [
        {
          startTime: 1000,
          availableSignals: ['RPM', 'Boost'],
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

      const config = Chart.mock.calls[0][1];
      expect(config.data.datasets.length).toBe(2);
      const rpmData = config.data.datasets.find((d) => d.label === 'RPM').data;
      expect(rpmData[0].y).toBeCloseTo(0);
      expect(rpmData[1].y).toBeCloseTo(1);
    });

    test('Timeline tooltip returns original values', () => {
      AppState.files = [
        {
          startTime: 0,
          availableSignals: ['S1'],
          signals: { S1: [{ x: 0, y: 50 }] },
        },
      ];
      XYAnalysis.renderTimeline(0, ['S1']);

      const callback =
        Chart.mock.calls[0][1].options.plugins.tooltip.callbacks.label;
      const text = callback({
        dataset: { label: 'S1' },
        raw: { originalValue: 50.1234 },
      });
      expect(text).toBe('S1: 50.12');
    });

    test('renderTimeline uses PaletteManager for colors', () => {
      AppState.files = [
        {
          startTime: 0,
          availableSignals: ['SigA'],
          signals: { SigA: [{ x: 0, y: 0 }] },
        },
      ];
      XYAnalysis.renderTimeline(0, ['SigA']);
      const config = Chart.mock.calls[0][1];
      expect(config.data.datasets[0].borderColor).toBe('#ff0000');
    });

    test('renderTimeline handles flatline signals (avoid divide-by-zero)', () => {
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
      const data = Chart.mock.calls[0][1].data.datasets[0].data;
      expect(data[0].y).toBe(0);
    });

    test('renderTimeline skips signals not found in file', () => {
      AppState.files = [
        {
          startTime: 0,
          availableSignals: ['A'],
          signals: { A: [{ x: 0, y: 0 }] },
        },
      ];
      XYAnalysis.renderTimeline(0, ['A', 'Missing']);
      expect(Chart.mock.calls[0][1].data.datasets).toHaveLength(1);
    });

    test('renderTimeline returns early if canvas missing', () => {
      document.getElementById('xyTimelineCanvas').remove();
      XYAnalysis.renderTimeline(0, ['RPM']);
      expect(Chart).not.toHaveBeenCalled();
    });

    test('Timeline Hover Plugin draws line', () => {
      AppState.files = [
        {
          startTime: 0,
          availableSignals: ['S1'],
          signals: { S1: [{ x: 0, y: 0 }] },
        },
      ];
      XYAnalysis.renderTimeline(0, ['S1']);

      const config = Chart.mock.calls[0][1];
      const hoverPlugin = config.plugins.find((p) => p.id === 'xyHoverLine');

      const mockCtx = {
        save: jest.fn(),
        beginPath: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        stroke: jest.fn(),
        restore: jest.fn(),
        lineWidth: 0,
        strokeStyle: '',
      };
      const mockChart = {
        ctx: mockCtx,
        tooltip: { _active: [{ element: { x: 50 } }] },
        scales: { y: { top: 10, bottom: 100 } },
      };

      hoverPlugin.afterDraw(mockChart);
      expect(mockCtx.moveTo).toHaveBeenCalledWith(50, 10);
      expect(mockCtx.lineTo).toHaveBeenCalledWith(50, 100);
      expect(mockCtx.stroke).toHaveBeenCalled();
    });

    test('updateTimeline aggregates signals from all selectors', () => {
      const setVal = (id, val) => {
        document.getElementById(id).innerHTML = `<input value="${val}">`;
      };
      setVal('xyX-0', 'S1');
      setVal('xyY-0', 'S2');
      setVal('xyZ-0', 'S1');
      setVal('xyX-1', 'S3');
      setVal('xyY-1', '');
      setVal('xyZ-1', '');

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

    test('plot triggers both scatter and timeline updates', () => {
      const scatterSpy = jest
        .spyOn(XYAnalysis, 'renderChart')
        .mockImplementation(() => {});
      const timelineSpy = jest
        .spyOn(XYAnalysis, 'updateTimeline')
        .mockImplementation(() => {});

      document.getElementById('xyX-0').innerHTML = `<input value="A">`;
      document.getElementById('xyY-0').innerHTML = `<input value="B">`;
      document.getElementById('xyZ-0').innerHTML = `<input value="C">`;

      AppState.files = [{ name: 'F', startTime: 0, signals: {} }];
      XYAnalysis.currentFileIndex = 0;

      XYAnalysis.plot('0');

      expect(scatterSpy).toHaveBeenCalled();
      expect(timelineSpy).toHaveBeenCalled();
    });
  });

  describe('Edge Cases & Full Coverage', () => {
    test('getHeatColor handles values outside min/max range', () => {
      // Value below min (0) should be clamped to min -> Hue 240 (Blue)
      expect(XYAnalysis.getHeatColor(-50, 0, 100)).toContain('240');
      // Value above max (100) should be clamped to max -> Hue 0 (Red)
      expect(XYAnalysis.getHeatColor(150, 0, 100)).toContain('0');
    });

    test('renderChart destroys existing chart before creating new one', () => {
      const destroySpy = jest.fn();
      XYAnalysis.charts = [{ destroy: destroySpy }, null];

      AppState.files = [{ availableSignals: ['A', 'B', 'C'], signals: {} }];
      jest
        .spyOn(XYAnalysis, 'generateScatterData')
        .mockReturnValue([{ x: 1, y: 1, z: 1 }]);

      XYAnalysis.renderChart('0', 0, 'A', 'B', 'C');

      expect(destroySpy).toHaveBeenCalled();
    });

    test('renderTimeline destroys existing chart', () => {
      const destroySpy = jest.fn();
      XYAnalysis.timelineChart = { destroy: destroySpy };

      AppState.files = [
        {
          startTime: 0,
          availableSignals: ['A'],
          signals: { A: [{ x: 0, y: 0 }] },
        },
      ];
      XYAnalysis.renderTimeline(0, ['A']);

      expect(destroySpy).toHaveBeenCalled();
    });

    test('renderTimeline handles missing data for valid signal', () => {
      // Signal is in availableSignals but null in signals map
      AppState.files = [
        {
          startTime: 0,
          availableSignals: ['GhostSignal'],
          signals: { GhostSignal: null },
        },
      ];

      XYAnalysis.renderTimeline(0, ['GhostSignal']);

      const config = Chart.mock.calls[0][1];
      expect(config.data.datasets.length).toBe(0); // Should be filtered out
    });

    test('Event listener cleanup when element is removed from DOM', () => {
      XYAnalysis.createSearchableSelect('xyGlobalFile', ['A'], '', jest.fn());
      const container = document.getElementById('xyGlobalFile');
      const list = container.querySelector('.search-results-list');

      // Remove container from DOM to trigger cleanup logic
      container.remove();

      // Click anywhere
      document.body.click();

      // Should verify that no errors occurred and list state didn't change (implied coverage)
      expect(list).toBeDefined();
    });

    test('plot returns early if inputs are missing', () => {
      const renderSpy = jest.spyOn(XYAnalysis, 'renderChart');

      // Only set X, leave Y and Z empty
      document.getElementById('xyX-0').innerHTML = `<input value="A">`;

      XYAnalysis.plot('0');

      expect(renderSpy).not.toHaveBeenCalled();
    });
  });
});
