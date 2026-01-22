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

describe('XYAnalysis Suite 5', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AppState.files = [];

    // --- JSDOM innerText Hack ---
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      get() {
        return this.textContent;
      },
      set(value) {
        this.textContent = value;
      },
      configurable: true,
    });
    // -----------------------------

    document.body.innerHTML = `
      <div id="xyModal" style="display: none;"></div>
      <div id="xySplitView"></div>
      <div id="xyTimelineView"></div>
      <div id="xyGlobalFile"></div>
      <div id="xyX-0"></div> <div id="xyY-0"></div> <div id="xyZ-0"></div>
      <canvas id="xyCanvas-0"></canvas>
      <div id="xyLegend-0"></div>
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

  describe('Modal Logic', () => {
    test('openXYModal adjusts split view styles', () => {
      XYAnalysis.openXYModal();
      const split = document.getElementById('xySplitView');
      const timeline = document.getElementById('xyTimelineView');

      expect(split.style.flex).toMatch(/^3/);
      expect(timeline.style.flex).toMatch(/^1/);
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

      const mockTooltipEl = document.createElement('div');
      mockTooltipEl.className = 'chartjs-tooltip';
      const mockTable = document.createElement('table');
      mockTooltipEl.appendChild(mockTable);
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

      expect(rows[0].innerHTML).toContain('RPM: 1000.00');
      expect(rows[1].innerHTML).toContain('MAP: 1.50');
      expect(rows[2].innerHTML).toContain('MAF: 20.50');
    });

    test('External tooltip hides when opacity is 0', () => {
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
});
