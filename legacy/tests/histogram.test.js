import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';

// 1. Setup Mock Instances
const mockChartInstance = {
  destroy: jest.fn(),
  update: jest.fn(),
  data: { datasets: [], labels: [] },
  options: {
    scales: { x: {}, y: {} },
    plugins: { tooltip: {}, legend: {} },
  },
};

// 2. Mock Chart.js using unstable_mockModule (awaited)
await jest.unstable_mockModule('chart.js', () => {
  const MockChart = jest.fn(() => mockChartInstance);

  // Static methods required by Histogram.js
  MockChart.register = jest.fn();
  MockChart.getChart = jest.fn(() => null);

  return {
    __esModule: true,
    Chart: MockChart,
    registerables: [],
    BarController: jest.fn(),
    BarElement: jest.fn(),
    CategoryScale: jest.fn(),
    LinearScale: jest.fn(),
    Tooltip: jest.fn(),
    Legend: jest.fn(),
  };
});

// 3. Mock Config
await jest.unstable_mockModule('../src/config.js', () => ({
  AppState: {
    files: [],
  },
}));

// 4. Import Modules Dynamically (Top-level await)
const { Histogram } = await import('../src/histogram.js');
const { AppState } = await import('../src/config.js');
const { Chart } = await import('chart.js');

describe('HistogramManager', () => {
  beforeEach(() => {
    // Clean DOM
    document.body.innerHTML = '';
    jest.clearAllMocks();

    // Reset AppState
    AppState.files = [];

    // Setup basic mock for canvas context
    HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
      save: jest.fn(),
      restore: jest.fn(),
      fillRect: jest.fn(),
      stroke: jest.fn(),
    }));
  });

  describe('init()', () => {
    test('should register Chart.js components', () => {
      Histogram.init();
      expect(Chart.register).toHaveBeenCalled();
    });

    test('should inject the modal HTML into the DOM', () => {
      Histogram.init();
      const modal = document.getElementById('histModal');
      expect(modal).not.toBeNull();
      expect(modal.style.display).toBe('none');
      expect(document.getElementById('histCanvas')).not.toBeNull();
    });
  });

  describe('openModal()', () => {
    beforeEach(() => {
      Histogram.init();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('should set display to flex', () => {
      Histogram.openModal();
      const modal = document.getElementById('histModal');
      expect(modal.style.display).toBe('flex');
    });

    test('should populate file select with loaded files', () => {
      AppState.files.push(
        { name: 'log1.json', availableSignals: [] },
        { name: 'log2.json', availableSignals: [] }
      );

      Histogram.openModal();

      const select = document.getElementById('histFileSelect');
      expect(select.children.length).toBe(2);
      expect(select.children[0].text).toBe('log1.json');
      expect(select.children[1].text).toBe('log2.json');
    });

    test('should trigger generate() after timeout', () => {
      const generateSpy = jest.spyOn(Histogram, 'generate');

      Histogram.openModal();

      expect(generateSpy).not.toHaveBeenCalled();
      jest.runAllTimers();
      expect(generateSpy).toHaveBeenCalled();

      generateSpy.mockRestore();
    });
  });

  describe('generate()', () => {
    beforeEach(() => {
      Histogram.init();

      const mockFile = {
        name: 'TestLog',
        signals: {
          RPM: [
            { x: 1, y: 10 },
            { x: 2, y: 15 },
            { x: 3, y: 20 },
          ],
          Constant: [
            { x: 1, y: 5 },
            { x: 2, y: 5 },
          ],
        },
        availableSignals: ['RPM', 'Constant'],
      };

      AppState.files.push(mockFile);

      // Manually set up UI state
      const fileSelect = document.getElementById('histFileSelect');
      fileSelect.innerHTML = '<option value="0">TestLog</option>';
      fileSelect.value = '0';

      // FIX: Ensure BOTH options exist so .value assignments work correctly
      const sigSelect = document.getElementById('histSignalSelect');
      sigSelect.innerHTML =
        '<option value="RPM">RPM</option><option value="Constant">Constant</option>';
      sigSelect.value = 'RPM';

      const binInput = document.getElementById('histBins');
      binInput.value = '2';
    });

    test('should calculate correct bins for standard data', () => {
      Histogram.generate();

      expect(Chart).toHaveBeenCalledTimes(1);

      const chartConfig = Chart.mock.calls[0][1];
      const data = chartConfig.data.datasets[0].data;
      const labels = chartConfig.data.labels;

      // Data: 10, 15, 20. Bins: 2. Range: 10-20.
      expect(data).toEqual([1, 2]);
      expect(labels).toEqual(['10.0 - 15.0', '15.0 - 20.0']);
      expect(chartConfig.type).toBe('bar');
    });

    test('should handle edge case where min equals max (Step 0)', () => {
      // Switch signal to 'Constant'
      const sigSelect = document.getElementById('histSignalSelect');
      sigSelect.value = 'Constant';

      Histogram.generate();

      // Since mocks are cleared in beforeEach, this is the FIRST call for this test
      const chartConfig = Chart.mock.calls[0][1];

      expect(chartConfig).toBeDefined(); // Ensure chart was created

      const data = chartConfig.data.datasets[0].data;
      const labels = chartConfig.data.labels;

      expect(data[0]).toBe(2);
      expect(labels[0]).toBe('5.0');
    });

    test('should destroy existing chart before creating new one', () => {
      const mockDestroy = jest.fn();

      // Update the getChart mock to return an object with destroy() for this test
      Chart.getChart.mockReturnValue({ destroy: mockDestroy });

      Histogram.generate();

      expect(Chart.getChart).toHaveBeenCalledWith('histCanvas');
      expect(mockDestroy).toHaveBeenCalled();
    });
  });
});
