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
  canvas: {
    parentNode: {
      querySelector: jest.fn(),
      appendChild: jest.fn(),
    },
    offsetLeft: 0,
    offsetTop: 0,
  },
  data: { datasets: [] },
  options: {
    plugins: { tooltip: { external: null } },
    scales: { x: {}, y: {} },
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

describe('XYAnalysis Suite 4', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AppState.files = [];

    document.body.innerHTML = `
      <div id="xyModal" style="display: none;"></div>
      <div id="xySplitView"></div>
      <div id="xyTimelineView"></div>
      
      <div id="xyGlobalFile"></div>
      <div id="xyX-0"></div> <div id="xyY-0"></div> <div id="xyZ-0"></div>
      <canvas id="xyCanvas-0"></canvas>
      <div id="xyLegend-0"></div>
      
      <div id="xyX-1"></div> <div id="xyY-1"></div> <div id="xyZ-1"></div>
      <canvas id="xyCanvas-1"></canvas>
      <div id="xyLegend-1"></div>
      
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
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Tooltip Positioner', () => {
    test('xyFixed positioner returns correct coordinates', () => {
      XYAnalysis.init();
      const positioner = Tooltip.positioners.xyFixed;

      const context = {
        chart: {
          chartArea: { top: 50, right: 500 },
        },
      };

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

  describe('Modal Logic', () => {
    test('openXYModal adjusts split view styles', () => {
      XYAnalysis.openXYModal();
      const split = document.getElementById('xySplitView');
      const timeline = document.getElementById('xyTimelineView');

      expect(split.style.flex).toMatch(/^3/);
      expect(timeline.style.flex).toMatch(/^1/);
    });
  });

  describe('Searchable Select Interactions', () => {
    test('Replaces SELECT element with custom DIV wrapper', () => {
      const container = document.getElementById('xyX-0');
      container.outerHTML =
        '<select id="xyX-0" class="test-class" style="color:red"></select>';

      XYAnalysis.createSearchableSelect('xyX-0', ['A', 'B'], 'A', jest.fn());

      const newEl = document.getElementById('xyX-0');
      expect(newEl.tagName).toBe('DIV');
      expect(newEl.className).toContain('test-class');
      expect(newEl.className).toContain('searchable-select-wrapper');
      expect(newEl.style.color).toBe('red');
    });

    test('Filter logic: shows "No signals found"', () => {
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
  });

  describe('Custom Tooltip Logic', () => {
    test('renderChart configures external tooltip and it renders HTML correctly', () => {
      AppState.files = [
        {
          availableSignals: ['RPM', 'MAP', 'MAF'],
          signals: {},
        },
      ];

      jest
        .spyOn(XYAnalysis, 'generateScatterData')
        .mockReturnValue([{ x: 1, y: 1, z: 1 }]);
      XYAnalysis.renderChart('0', 0, 'RPM', 'MAP', 'MAF');

      const chartCall = Chart.mock.calls[0];
      const config = chartCall[1];
      const externalHandler = config.options.plugins.tooltip.external;

      expect(externalHandler).toBeDefined();

      // --- Simulate Tooltip Call ---
      const mockTooltipEl = document.createElement('div');
      mockTooltipEl.className = 'chartjs-tooltip';
      const mockTable = document.createElement('table');
      mockTooltipEl.appendChild(mockTable);

      // FIXED: Attach to body to ensure innerText/rendering works in JSDOM
      document.body.appendChild(mockTooltipEl);

      const mockChart = {
        canvas: {
          parentNode: {
            querySelector: jest.fn(() => mockTooltipEl),
            appendChild: jest.fn(),
          },
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
          dataPoints: [
            {
              raw: { x: 1000, y: 1.5, z: 20.5 },
            },
          ],
        },
      };

      externalHandler(context);

      const rows = mockTable.querySelectorAll('tr');
      expect(rows.length).toBe(3);

      // FIXED: Use innerHTML to verify content as textContent can be flaky in detached nodes in JSDOM
      expect(rows[0].innerHTML).toContain('RPM: 1000.00');
      expect(rows[1].innerHTML).toContain('MAP: 1.50');
      expect(rows[2].innerHTML).toContain('MAF: 20.50');

      const colorDot = rows[0].querySelector('span');
      expect(colorDot.style.background).toBe('rgb(255, 0, 0)');
    });

    test('External tooltip hides when opacity is 0', () => {
      // FIXED: generateScatterData must return data, otherwise renderChart returns early
      // and Chart is never instantiated, causing the test to fail when accessing mock calls.
      jest
        .spyOn(XYAnalysis, 'generateScatterData')
        .mockReturnValue([{ x: 1, y: 1, z: 1 }]);

      XYAnalysis.renderChart('0', 0, 'A', 'B', 'C');

      const config = Chart.mock.calls[0][1];
      const handler = config.options.plugins.tooltip.external;

      const mockEl = document.createElement('div');
      const mockChart = {
        canvas: { parentNode: { querySelector: () => mockEl } },
      };

      handler({ chart: mockChart, tooltip: { opacity: 0 } });

      expect(mockEl.style.opacity).toBe('0');
    });
  });

  describe('Timeline Hover Plugin', () => {
    test('Timeline hover plugin draws line on active tooltip', () => {
      AppState.files = [
        {
          startTime: 0,
          availableSignals: ['SigA'],
          signals: { SigA: [{ x: 0, y: 0 }] },
        },
      ];

      XYAnalysis.renderTimeline(0, ['SigA']);

      const chartCall = Chart.mock.calls[0];
      const config = chartCall[1];
      const hoverPlugin = config.plugins.find((p) => p.id === 'xyHoverLine');

      expect(hoverPlugin).toBeDefined();

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

      expect(mockCtx.beginPath).toHaveBeenCalled();
      expect(mockCtx.moveTo).toHaveBeenCalledWith(50, 10);
      expect(mockCtx.lineTo).toHaveBeenCalledWith(50, 100);
      expect(mockCtx.stroke).toHaveBeenCalled();
    });
  });
});
