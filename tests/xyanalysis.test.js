import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// --- 1. Define the Mock Data Structure ---
const mockChartInstance = {
  destroy: jest.fn(),
  update: jest.fn(),
  draw: jest.fn(),
  width: 1000,
  scales: { x: { min: 0, max: 1000, getValueForPixel: jest.fn() } },
  data: { datasets: [] },
  options: {
    plugins: { datalabels: {}, zoom: {} },
    scales: { x: { min: 0, max: 0 } },
  },
};

// --- 2. Register Mocks using unstable_mockModule ---

// Mock Chart.js
await jest.unstable_mockModule('chart.js', () => {
  // Create a Mock Constructor function
  const MockChart = jest.fn(() => mockChartInstance);

  // CRITICAL FIX: Attach 'register' as a static method on the constructor
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

// --- 3. Dynamic Imports (Must happen AFTER mocks are registered) ---
const { XYAnalysis } = await import('../src/xyanalysis.js');
const { AppState } = await import('../src/config.js');
const { UI } = await import('../src/ui.js');
const { Chart } = await import('chart.js');

// --- 4. Tests ---
describe('XYAnalysis Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset State
    AppState.files = [];
    XYAnalysis.chartInstance = null;

    // Ensure the constructor returns our instance (redundant but safe)
    Chart.mockImplementation(() => mockChartInstance);

    // Reset DOM
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
      // Now checks the static method on the class
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

    test('creates chart with correct config options', () => {
      jest
        .spyOn(XYAnalysis, 'generateScatterData')
        .mockReturnValue([{ x: 10, y: 20 }]);

      XYAnalysis.renderXYChart('xyChartCanvas', 0, 'RPM', 'Boost');

      expect(Chart).toHaveBeenCalled();
      const config = Chart.mock.calls[0][1];
      expect(config.type).toBe('scatter');
      expect(config.data.datasets[0].data).toEqual([{ x: 10, y: 20 }]);
    });
  });
});
