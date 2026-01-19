import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockChartInstance = {
  destroy: jest.fn(),
  update: jest.fn(),
  draw: jest.fn(),
  resetZoom: jest.fn(), // Added mock for resetZoom
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

    // Setup DOM with new Reset button
    document.body.innerHTML = `
      <div id="xyModal" style="display: none;"></div>
      <select id="xyFileSelect"><option value="0">File 1</option></select>
      <select id="xyXAxis"><option value="RPM">RPM</option></select>
      <select id="xyYAxis"><option value="Boost">Boost</option></select>
      <canvas id="xyChartCanvas"></canvas>
      <button id="xyResetZoom">Reset Zoom</button>
    `;
  });

  describe('Initialization & UI Helpers', () => {
    test('init registers Chart.js components including Zoom plugin', () => {
      XYAnalysis.init();
      expect(Chart.register).toHaveBeenCalledWith(
        expect.anything(), // ScatterController
        expect.anything(), // PointElement
        expect.anything(), // LinearScale
        expect.anything(), // Tooltip
        mockZoomPlugin // The mocked zoom plugin
      );
    });

    test('init sets up Reset Zoom button listener', () => {
      const resetSpy = jest.spyOn(XYAnalysis, 'resetZoom');
      XYAnalysis.init();

      const btn = document.getElementById('xyResetZoom');
      btn.click();

      expect(resetSpy).toHaveBeenCalled();
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

  describe('renderXYChart & Features', () => {
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
      jest.spyOn(XYAnalysis, 'generateScatterData').mockReturnValue([]);
      const existingDestroy = jest.fn();
      XYAnalysis.chartInstance = { destroy: existingDestroy };
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      XYAnalysis.renderXYChart('xyChartCanvas', 0, 'RPM', 'Boost');

      expect(existingDestroy).toHaveBeenCalled();
      expect(XYAnalysis.chartInstance).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('No overlapping data found')
      );
      warnSpy.mockRestore();
    });

    test('Chart options include Zoom plugin configuration', () => {
      jest
        .spyOn(XYAnalysis, 'generateScatterData')
        .mockReturnValue([{ x: 1, y: 1 }]);

      XYAnalysis.renderXYChart('xyChartCanvas', 0, 'RPM', 'Boost');

      const config = Chart.mock.calls[0][1];
      const zoomOptions = config.options.plugins.zoom;

      expect(zoomOptions).toBeDefined();
      expect(zoomOptions.pan.enabled).toBe(true);
      expect(zoomOptions.zoom.wheel.enabled).toBe(true);
      expect(zoomOptions.zoom.mode).toBe('xy');
    });

    test('Heatmap logic assigns correct colors based on Y-value intensity', () => {
      // Mock data with Min (10) and Max (100) to test color scale
      const mockData = [
        { x: 1, y: 10 }, // Minimum -> Should be Blue (Hue 240)
        { x: 2, y: 55 }, // Midpoint
        { x: 3, y: 100 }, // Maximum -> Should be Red (Hue 0)
      ];
      jest.spyOn(XYAnalysis, 'generateScatterData').mockReturnValue(mockData);

      XYAnalysis.renderXYChart('xyChartCanvas', 0, 'RPM', 'Boost');

      const config = Chart.mock.calls[0][1];
      const colors = config.data.datasets[0].backgroundColor;

      // Expect 3 colors, one for each point
      expect(colors).toHaveLength(3);

      // Check Min Value (Blue)
      expect(colors[0]).toBe('hsla(240, 100%, 50%, 0.8)');

      // Check Max Value (Red)
      expect(colors[2]).toBe('hsla(0, 100%, 50%, 0.8)');
    });

    test('resetZoom calls chartInstance.resetZoom()', () => {
      // Manually assign the mock instance so we can verify the call
      XYAnalysis.chartInstance = mockChartInstance;
      XYAnalysis.resetZoom();
      expect(mockChartInstance.resetZoom).toHaveBeenCalled();
    });

    test('Tooltip callback formats label correctly', () => {
      jest
        .spyOn(XYAnalysis, 'generateScatterData')
        .mockReturnValue([{ x: 10.123, y: 20.456 }]);

      XYAnalysis.renderXYChart('xyChartCanvas', 0, 'RPM', 'Boost');

      const config = Chart.mock.calls[0][1];
      const callback = config.options.plugins.tooltip.callbacks.label;
      const context = { parsed: { x: 10.12345, y: 20.45678 } };

      const result = callback(context);

      // Verify the result is an array with correctly formatted strings
      expect(result).toEqual(['Boost: 20.46', 'RPM: 10.12']);
    });
  });
});
