import { jest, describe, test, expect, beforeEach } from '@jest/globals';

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

// Mock Chart.js
await jest.unstable_mockModule('chart.js', () => {
  const MockChart = jest.fn(() => mockChartInstance);
  MockChart.register = jest.fn();
  return {
    __esModule: true,
    Chart: MockChart,
    ScatterController: jest.fn(),
    PointElement: jest.fn(),
    LinearScale: jest.fn(),
    Tooltip: jest.fn(),
  };
});

// Mock chartjs-plugin-zoom
const mockZoomPlugin = { id: 'zoom' };
await jest.unstable_mockModule('chartjs-plugin-zoom', () => ({
  default: mockZoomPlugin,
}));

// Mock UI.js
await jest.unstable_mockModule('../src/ui.js', () => ({
  UI: {},
}));

// Mock Config.js
await jest.unstable_mockModule('../src/config.js', () => ({
  AppState: {
    files: [],
  },
}));

// --- Dynamic Imports ---
const { XYAnalysis } = await import('../src/xyanalysis.js');
const { AppState } = await import('../src/config.js');
const { Chart } = await import('chart.js');

// --- Tests ---
describe('XYAnalysis Module (Multi-Chart & Z-Axis)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AppState.files = [];
    XYAnalysis.charts = [null, null];

    Chart.mockImplementation(() => mockChartInstance);

    // Setup DOM with new Split View Structure
    document.body.innerHTML = `
      <div id="xyModal" style="display: none;">
        <div class="modal-body"></div>
      </div>
      
      <select id="xyGlobalFile"></select>
      
      <select id="xyX-0"><option value="RPM">RPM</option></select>
      <select id="xyY-0"><option value="Boost">Boost</option></select>
      <select id="xyZ-0"><option value="AFR">AFR</option></select>
      <canvas id="xyCanvas-0"></canvas>
      <div id="xyLegend-0" style="display:none;"></div>

      <select id="xyX-1"><option value="RPM">RPM</option></select>
      <select id="xyY-1"><option value="MAF">MAF</option></select>
      <select id="xyZ-1"><option value="IAT">IAT</option></select>
      <canvas id="xyCanvas-1"></canvas>
      <div id="xyLegend-1" style="display:none;"></div>
    `;
  });

  describe('Initialization & Logic', () => {
    test('init registers Chart.js components', () => {
      XYAnalysis.init();
      expect(Chart.register).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        mockZoomPlugin
      );
    });

    test('openXYModal displays modal and populates global file selector', () => {
      const populateSpy = jest.spyOn(XYAnalysis, 'populateGlobalFileSelector');
      XYAnalysis.openXYModal();

      const modal = document.getElementById('xyModal');
      expect(modal.style.display).toBe('flex');
      expect(populateSpy).toHaveBeenCalled();
    });

    test('onFileChange populates selectors for BOTH panels', () => {
      AppState.files = [
        {
          name: 'Log1',
          availableSignals: ['RPM', 'Boost', 'AFR'],
        },
      ];

      const fileSel = document.getElementById('xyGlobalFile');
      fileSel.innerHTML = '<option value="0">Log1</option>';
      fileSel.value = '0';

      XYAnalysis.onFileChange();

      const x0 = document.getElementById('xyX-0');
      expect(x0.innerHTML).toContain('RPM');
      expect(x0.innerHTML).toContain('Boost');

      const x1 = document.getElementById('xyX-1');
      expect(x1.innerHTML).toContain('RPM');
    });
  });

  describe('generateScatterData (3-Axis Sync)', () => {
    test('returns empty array if file or signals missing', () => {
      AppState.files = [];
      const result = XYAnalysis.generateScatterData(0, 'RPM', 'Boost', 'AFR');
      expect(result).toEqual([]);
    });

    test('synchronizes X, Y, and Z signals correctly', () => {
      AppState.files = [
        {
          signals: {
            RPM: [
              { x: 1.0, y: 1000 },
              { x: 2.0, y: 2000 },
            ],
            Boost: [
              { x: 1.1, y: 1.5 },
              { x: 2.1, y: 2.5 },
            ],
            AFR: [
              { x: 1.05, y: 14.7 },
              { x: 2.05, y: 12.5 },
            ],
          },
        },
      ];

      const result = XYAnalysis.generateScatterData(0, 'RPM', 'Boost', 'AFR');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ x: 1000, y: 1.5, z: 14.7 });
      expect(result[1]).toEqual({ x: 2000, y: 2.5, z: 12.5 });
    });
  });

  describe('renderChart & Z-Axis Visualization', () => {
    beforeEach(() => {
      ['xyCanvas-0', 'xyCanvas-1'].forEach((id) => {
        const canvas = document.getElementById(id);
        canvas.getContext = jest.fn(() => ({
          canvas,
          fillRect: jest.fn(),
          measureText: jest.fn(() => ({ width: 0 })),
          save: jest.fn(),
          restore: jest.fn(),
        }));
      });
    });

    test('renderChart updates correct panel instance', () => {
      jest
        .spyOn(XYAnalysis, 'generateScatterData')
        .mockReturnValue([{ x: 1, y: 1, z: 10 }]);

      XYAnalysis.renderChart('1', 0, 'RPM', 'Boost', 'AFR');

      expect(XYAnalysis.charts[1]).not.toBeNull();
      expect(XYAnalysis.charts[0]).toBeNull();
    });

    test('assigns Z-Axis colors (Heatmap Logic)', () => {
      const mockData = [
        { x: 1, y: 10, z: 10 },
        { x: 2, y: 50, z: 55 },
        { x: 3, y: 90, z: 100 },
      ];
      jest.spyOn(XYAnalysis, 'generateScatterData').mockReturnValue(mockData);

      XYAnalysis.renderChart('0', 0, 'RPM', 'Boost', 'AFR');

      const config = Chart.mock.calls[0][1];
      const bgColors = config.data.datasets[0].backgroundColor;
      const borderColors = config.data.datasets[0].borderColor;

      expect(bgColors[0]).toBe('hsla(240, 100%, 50%, 0.8)'); // Blue
      expect(bgColors[2]).toBe('hsla(0, 100%, 50%, 0.8)'); // Red
      expect(borderColors).toEqual(bgColors);
    });

    test('updates Legend UI with Z-Axis Min/Max', () => {
      jest.spyOn(XYAnalysis, 'generateScatterData').mockReturnValue([
        { x: 1, y: 1, z: 10 },
        { x: 2, y: 2, z: 20 },
      ]);

      XYAnalysis.renderChart('0', 0, 'X', 'Y', 'Z');

      const legend = document.getElementById('xyLegend-0');
      expect(legend.style.display).toBe('flex');

      // The legend now generates a list of 5 values inside .legend-values
      const valueSpans = legend.querySelectorAll('.legend-values span');
      expect(valueSpans.length).toBe(5);

      // Verify Top (Max)
      expect(valueSpans[0].innerText).toBe('20.0');
      // Verify Bottom (Min)
      expect(valueSpans[valueSpans.length - 1].innerText).toBe('10.0');
    });

    test('Tooltip callback includes Z-Axis value', () => {
      jest
        .spyOn(XYAnalysis, 'generateScatterData')
        .mockReturnValue([{ x: 1, y: 1, z: 1 }]);
      XYAnalysis.renderChart('0', 0, 'RPM', 'MAP', 'AFR');

      const config = Chart.mock.calls[0][1];
      const labelCb = config.options.plugins.tooltip.callbacks.label;

      const context = { raw: { x: 3000, y: 1.5, z: 12.8 } };
      const tooltipLines = labelCb(context);

      expect(tooltipLines).toHaveLength(3);
      expect(tooltipLines[2]).toBe('Z (AFR): 12.80');
    });

    test('resetAllZooms calls resetZoom on all active charts', () => {
      XYAnalysis.charts = [mockChartInstance, mockChartInstance];
      XYAnalysis.resetAllZooms();
      expect(mockChartInstance.resetZoom).toHaveBeenCalledTimes(2);
    });

    test('plot() retrieves values from DOM and calls renderChart', () => {
      const renderSpy = jest
        .spyOn(XYAnalysis, 'renderChart')
        .mockImplementation(() => {});

      const fileSel = document.getElementById('xyGlobalFile');
      fileSel.innerHTML = '<option value="0">File 0</option>';
      fileSel.value = '0';

      const xSel = document.getElementById('xyX-0');
      xSel.innerHTML = '<option value="SignalA">SignalA</option>';
      xSel.value = 'SignalA';

      const ySel = document.getElementById('xyY-0');
      ySel.innerHTML = '<option value="SignalB">SignalB</option>';
      ySel.value = 'SignalB';

      const zSel = document.getElementById('xyZ-0');
      zSel.innerHTML = '<option value="SignalC">SignalC</option>';
      zSel.value = 'SignalC';

      XYAnalysis.plot('0');

      expect(renderSpy).toHaveBeenCalledWith(
        '0',
        '0',
        'SignalA',
        'SignalB',
        'SignalC'
      );
    });
  });
});
