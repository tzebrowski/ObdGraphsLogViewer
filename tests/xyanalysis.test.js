import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockChartInstance = {
  destroy: jest.fn(),
  update: jest.fn(),
  draw: jest.fn(),
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

// Mock UI.js
await jest.unstable_mockModule('../src/ui.js', () => ({
  UI: {
    populateXYSelectors: jest.fn(),
  },
}));

// Mock Config.js
await jest.unstable_mockModule('../src/config.js', () => ({
  AppState: {
    files: [],
  },
}));

// --- 3. Dynamic Imports ---
const { XYAnalysis } = await import('../src/xyanalysis.js');
const { AppState } = await import('../src/config.js');
const { UI } = await import('../src/ui.js');
const { Chart } = await import('chart.js');

// --- 4. Tests ---
describe('XYAnalysis Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AppState.files = [];
    XYAnalysis.chartInstance = null;
    Chart.mockImplementation(() => mockChartInstance);

    document.body.innerHTML = `
      <div id="xyModal" style="display: none;"></div>
      <select id="xyFileSelect"><option value="0">File 1</option></select>
      <select id="xyXAxis"><option value="RPM">RPM</option></select>
      <select id="xyYAxis"><option value="Boost">Boost</option></select>
      <canvas id="xyChartCanvas"></canvas>
    `;
  });

  describe('Initialization & UI Helpers', () => {
    test('init registers Chart.js components', () => {
      XYAnalysis.init();
      expect(Chart.register).toHaveBeenCalled();
    });

    test('openXYModal displays modal and populates selectors', () => {
      XYAnalysis.openXYModal();
      const modal = document.getElementById('xyModal');
      expect(modal.style.display).toBe('flex');
      expect(UI.populateXYSelectors).toHaveBeenCalled();
    });

    test('closeXYModal hides the modal', () => {
      const modal = document.getElementById('xyModal');
      modal.style.display = 'flex';
      XYAnalysis.closeXYModal();
      expect(modal.style.display).toBe('none');
    });

    test('generateXY reads inputs and triggers render', () => {
      const renderSpy = jest
        .spyOn(XYAnalysis, 'renderXYChart')
        .mockImplementation(() => {});
      XYAnalysis.generateXY();
      expect(renderSpy).toHaveBeenCalledWith(
        'xyChartCanvas',
        '0',
        'RPM',
        'Boost'
      );
      renderSpy.mockRestore();
    });
  });

  describe('generateScatterData (Core Logic)', () => {
    test('returns empty array if file does not exist', () => {
      AppState.files = [];
      const result = XYAnalysis.generateScatterData(0, 'RPM', 'Boost');
      expect(result).toEqual([]);
    });

    test('returns empty array if signals do not exist', () => {
      AppState.files = [{ signals: { RPM: [] } }];
      const result = XYAnalysis.generateScatterData(0, 'RPM', 'Boost');
      expect(result).toEqual([]);
    });

    test('synchronizes data correctly (Seconds tolerance)', () => {
      AppState.files = [
        {
          signals: {
            RPM: [
              { x: 1.0, y: 1000 },
              { x: 2.0, y: 2000 },
            ],
            Boost: [
              { x: 1.2, y: 1.5 },
              { x: 2.6, y: 2.0 },
            ],
          },
        },
      ];
      const result = XYAnalysis.generateScatterData(0, 'RPM', 'Boost');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ x: 1000, y: 1.5 });
    });
  });

  describe('renderXYChart', () => {
    beforeEach(() => {
      const canvas = document.getElementById('xyChartCanvas');
      canvas.getContext = jest.fn(() => ({
        canvas: canvas,
        fillRect: jest.fn(),
        measureText: jest.fn(() => ({ width: 0 })),
        save: jest.fn(),
        restore: jest.fn(),
      }));
    });

    test('destroys existing chart and cleans up if no data is found', () => {
      // Mock generateScatterData to return empty
      jest.spyOn(XYAnalysis, 'generateScatterData').mockReturnValue([]);

      // Simulate an existing chart instance
      const existingDestroy = jest.fn();
      XYAnalysis.chartInstance = { destroy: existingDestroy };

      // Spy on console.warn
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      XYAnalysis.renderXYChart('xyChartCanvas', 0, 'RPM', 'Boost');

      expect(existingDestroy).toHaveBeenCalled();
      expect(XYAnalysis.chartInstance).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('No overlapping data found')
      );

      warnSpy.mockRestore();
    });

    test('destroys existing chart instance before creating a new one (valid data)', () => {
      jest
        .spyOn(XYAnalysis, 'generateScatterData')
        .mockReturnValue([{ x: 1, y: 1 }]);

      const existingDestroy = jest.fn();
      XYAnalysis.chartInstance = { destroy: existingDestroy };

      XYAnalysis.renderXYChart('xyChartCanvas', 0, 'RPM', 'Boost');

      expect(existingDestroy).toHaveBeenCalled();
      expect(Chart).toHaveBeenCalled();
    });

    test('does not create chart if canvas missing', () => {
      document.body.innerHTML = ''; // Clear DOM
      XYAnalysis.renderXYChart('missing', 0, 'X', 'Y');
      expect(Chart).not.toHaveBeenCalled();
    });

    test('Tooltip callback formats label correctly', () => {
      jest
        .spyOn(XYAnalysis, 'generateScatterData')
        .mockReturnValue([{ x: 10.123, y: 20.456 }]);

      XYAnalysis.renderXYChart('xyChartCanvas', 0, 'RPM', 'Boost');

      // Get the config object passed to the Chart constructor
      const config = Chart.mock.calls[0][1];
      const callback = config.options.plugins.tooltip.callbacks.label;

      // Mock context object expected by the callback
      const context = { parsed: { x: 10.12345, y: 20.45678 } };
      const result = callback(context);

      expect(result).toEqual(['Boost: 20.46', 'RPM: 10.12']);
    });

    test('applies dark theme styling', () => {
      jest
        .spyOn(XYAnalysis, 'generateScatterData')
        .mockReturnValue([{ x: 1, y: 1 }]);
      document.body.classList.add('dark-theme');
      XYAnalysis.renderXYChart('xyChartCanvas', 0, 'X', 'Y');
      const config = Chart.mock.calls[0][1];
      expect(config.data.datasets[0].backgroundColor).toContain(
        'hsla(240, 100%, 50%, 0.8)'
      );
    });
  });
});
