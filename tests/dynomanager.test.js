import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
} from '@jest/globals';

const ctxFillRectSpy = jest.fn();
const ctxDrawImageSpy = jest.fn();

const mockChartInstance = {
  destroy: jest.fn(),
  update: jest.fn(),
  draw: jest.fn(),
  data: { datasets: [] },
  options: { plugins: {}, scales: {} },
};

await jest.unstable_mockModule('../src/chartmanager.js', () => ({
  ChartManager: {
    zoomTo: jest.fn(),
  },
}));

await jest.unstable_mockModule('chart.js', () => {
  const MockChart = jest.fn((ctx, config) => {
    if (config && config.options) mockChartInstance.options = config.options;
    if (config && config.data) mockChartInstance.data = config.data;
    return mockChartInstance;
  });
  MockChart.register = jest.fn();
  return {
    __esModule: true,
    Chart: MockChart,
  };
});

await jest.unstable_mockModule('../src/config.js', () => ({
  AppState: { files: [] },
  DOM: { get: jest.fn() },
}));

await jest.unstable_mockModule('../src/palettemanager.js', () => ({
  PaletteManager: {
    getColorForSignal: jest.fn(() => '#00ff00'),
  },
}));

const { DynoManager } = await import('../src/dynomanager.js');
const { AppState } = await import('../src/config.js');
const { Chart } = await import('chart.js');

describe('DynoManager Suite', () => {
  let mockCanvas;

  beforeEach(() => {
    jest.clearAllMocks();

    AppState.files = [];
    DynoManager.currentPulls = [];
    DynoManager.selectedPullIndex = 0;
    DynoManager.selectedExtraSignals = [];
    DynoManager.currentConfig = null;
    DynoManager.chartInstance = null;

    document.body.innerHTML = `
      <div id="dynoSetupModal" class="modal-overlay" style="display: none;">
        <div class="modal-header">
          <h2>Dyno Configuration</h2>
          <button class="btn-close">×</button>
        </div>
        <div class="modal-body">
          <select id="dynoSetupRpm" class="template-select"></select>
          <select id="dynoSetupTorque" class="template-select"></select>
          <select id="dynoSetupPedal" class="template-select"></select>
          <input type="number" id="dynoSetupPedalStart" value="60">
          <input type="number" id="dynoSetupPedalWot" value="85">
          <input type="number" id="dynoSetupRpmDelta" value="1200">
        </div>
      </div>

      <div id="dynoModal" class="modal-overlay" style="display: none;">
        <div class="modal-header">
          <h2>Virtual Dyno</h2>
          <button class="btn-close">×</button>
        </div>
        <div id="dynoSignalSearchContainer">
          <input type="text" id="dynoSignalSearch">
        </div>
        <div id="dynoSignalList"></div>
        <canvas id="dynoCanvas"></canvas>
      </div>
    `;

    mockCanvas = document.getElementById('dynoCanvas');
    jest.spyOn(mockCanvas, 'getContext').mockReturnValue({
      fillRect: ctxFillRectSpy,
      drawImage: ctxDrawImageSpy,
    });

    jest
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,mock');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Initialization & Global Binding', () => {
    test('init binds global functions to window', () => {
      DynoManager.init();
      expect(typeof window.openDynoModal).toBe('function');
      expect(typeof window.closeDynoSetupModal).toBe('function');
      expect(typeof window.closeDynoModal).toBe('function');
      expect(typeof window.generateDyno).toBe('function');
    });
  });

  describe('Setup Modal & Configuration', () => {
    test('openSetupModal alerts if no files loaded', () => {
      const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
      AppState.files = [];

      DynoManager.openSetupModal();

      expect(alertSpy).toHaveBeenCalledWith('Please load a log file first.');
      expect(document.getElementById('dynoSetupModal').style.display).toBe(
        'none'
      );
    });

    test('openSetupModal populates dropdowns and selects best matches', () => {
      AppState.files = [
        {
          availableSignals: [
            'Engine Speed',
            'Measured Engine Torque',
            'Gas Pedal Position',
            'Boost Pressure',
          ],
        },
      ];

      DynoManager.openSetupModal();

      expect(document.getElementById('dynoSetupModal').style.display).toBe(
        'flex'
      );
      expect(document.getElementById('dynoSetupRpm').value).toBe(
        'Engine Speed'
      );
      expect(document.getElementById('dynoSetupTorque').value).toBe(
        'Measured Engine Torque'
      );
      expect(document.getElementById('dynoSetupPedal').value).toBe(
        'Gas Pedal Position'
      );
    });

    test('generateFromSetup validates missing inputs', () => {
      const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
      DynoManager.openSetupModal();

      document.getElementById('dynoSetupRpm').value = '';
      DynoManager.generateFromSetup();

      expect(alertSpy).toHaveBeenCalledWith(
        'Please select Engine Speed, Torque, and Pedal Position signals.'
      );
    });

    test('generateFromSetup sets currentConfig and launches dyno modal', () => {
      AppState.files = [
        {
          availableSignals: [
            'Engine Speed',
            'Measured Engine Torque',
            'Gas Pedal Position',
          ],
          signals: {
            'Engine Speed': [
              { x: 1000, y: 2000 },
              { x: 2000, y: 5000 },
            ],
            'Measured Engine Torque': [
              { x: 1000, y: 300 },
              { x: 2000, y: 400 },
            ],
            'Gas Pedal Position': [
              { x: 1000, y: 90 },
              { x: 2000, y: 90 },
            ],
          },
        },
      ];

      DynoManager.openSetupModal();
      DynoManager.generateFromSetup();

      expect(DynoManager.currentConfig).toEqual({
        rpmKey: 'Engine Speed',
        torqueKey: 'Measured Engine Torque',
        pedalKey: 'Gas Pedal Position',
        pedalStart: 60,
        pedalWot: 85,
        rpmDelta: 1200,
      });
      expect(document.getElementById('dynoModal').style.display).toBe('flex');
    });
  });

  describe('Pull Extraction Logic (extractPulls)', () => {
    beforeEach(() => {
      DynoManager.currentConfig = {
        rpmKey: 'Engine Speed',
        torqueKey: 'Measured Engine Torque',
        pedalKey: 'Gas Pedal Position',
        pedalStart: 60,
        pedalWot: 85,
        rpmDelta: 1200,
      };
    });

    test('extracts valid WOT pull with forward-filling', () => {
      const file = {
        signals: {
          'Engine Speed': [
            { x: 1000, y: 2000 },
            { x: 2000, y: 3500 },
            { x: 3000, y: 5000 },
            { x: 4000, y: 2000 },
          ],
          'Measured Engine Torque': [
            { x: 1000, y: 300 },
            { x: 2000, y: 400 },
            { x: 3000, y: 350 },
            { x: 4000, y: 100 },
          ],
          'Gas Pedal Position': [
            { x: 1000, y: 90 },
            { x: 3000, y: 90 },
            { x: 4000, y: 10 },
          ],
        },
      };

      const pulls = DynoManager.extractPulls(file);

      expect(pulls).toHaveLength(1);
      expect(pulls[0].rpm[0]).toBe(2000);
      expect(pulls[0].rpm[pulls[0].rpm.length - 1]).toBe(5000);
    });

    test('handles decimal pedal scale (0.0 to 1.0)', () => {
      const file = {
        signals: {
          'Engine Speed': [
            { x: 1000, y: 2000 },
            { x: 2000, y: 4000 },
            { x: 3000, y: 1500 },
          ],
          'Measured Engine Torque': [
            { x: 1000, y: 300 },
            { x: 2000, y: 350 },
            { x: 3000, y: 100 },
          ],
          'Gas Pedal Position': [
            { x: 1000, y: 0.95 },
            { x: 2000, y: 0.95 },
            { x: 3000, y: 0.1 },
          ],
        },
      };

      const pulls = DynoManager.extractPulls(file);

      expect(pulls).toHaveLength(1);
    });

    test('rejects sweeps below Min RPM Delta', () => {
      const file = {
        signals: {
          'Engine Speed': [
            { x: 1000, y: 2000 },
            { x: 2000, y: 2500 },
            { x: 3000, y: 1000 },
          ],
          'Measured Engine Torque': [
            { x: 1000, y: 300 },
            { x: 2000, y: 300 },
            { x: 3000, y: 100 },
          ],
          'Gas Pedal Position': [
            { x: 1000, y: 100 },
            { x: 2000, y: 100 },
            { x: 3000, y: 0 },
          ],
        },
      };

      const pulls = DynoManager.extractPulls(file);

      expect(pulls).toHaveLength(0);
    });
  });

  describe('Rendering & Drawing (render, drawChart, updateDropdown)', () => {
    beforeEach(() => {
      DynoManager.currentConfig = {
        rpmKey: 'Engine Speed',
        torqueKey: 'Measured Engine Torque',
        pedalKey: 'Gas Pedal Position',
        pedalStart: 60,
        pedalWot: 85,
        rpmDelta: 1200,
      };
    });

    test('render alerts and closes modal if 0 pulls found', () => {
      const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
      AppState.files = [
        {
          availableSignals: [
            'Engine Speed',
            'Measured Engine Torque',
            'Gas Pedal Position',
          ],
          signals: {
            'Engine Speed': [],
            'Measured Engine Torque': [],
            'Gas Pedal Position': [],
          },
        },
      ];

      DynoManager.render();

      expect(alertSpy).toHaveBeenCalled();
      expect(document.getElementById('dynoModal').style.display).toBe('none');
    });

    test('updateDropdown populates pull options when multiple pulls exist', () => {
      const modal = document.getElementById('dynoModal');
      DynoManager.injectHeaderControls(modal);

      DynoManager.currentPulls = [{ rpm: [2000, 5000] }, { rpm: [2500, 6000] }];

      DynoManager.updateDropdown();

      const select = document.getElementById('dyno-pull-select');
      expect(select).not.toBeNull();
      expect(select.style.display).toBe('block');
      expect(select.children).toHaveLength(2);
    });

    test('drawChart builds binning, moving average, and instantiates Chart', () => {
      AppState.files = [
        {
          availableSignals: [
            'Engine Speed',
            'Measured Engine Torque',
            'Gas Pedal Position',
          ],
          signals: {
            'Engine Speed': [
              { x: 1000, y: 2000 },
              { x: 2000, y: 5000 },
            ],
            'Measured Engine Torque': [
              { x: 1000, y: 300 },
              { x: 2000, y: 400 },
            ],
            'Gas Pedal Position': [
              { x: 1000, y: 90 },
              { x: 2000, y: 90 },
            ],
          },
        },
      ];

      DynoManager.render();

      expect(Chart).toHaveBeenCalled();
      expect(mockChartInstance.data.datasets).toHaveLength(2);
      expect(mockChartInstance.data.datasets[0].label).toBe('Torque (Nm)');
      expect(mockChartInstance.data.datasets[1].label).toBe('Power (HP)');
    });
  });

  describe('Overlay Signals (populateSignalList)', () => {
    beforeEach(() => {
      DynoManager.currentConfig = {
        rpmKey: 'Engine Speed',
        torqueKey: 'Measured Engine Torque',
        pedalKey: 'Gas Pedal Position',
        pedalStart: 60,
        pedalWot: 85,
        rpmDelta: 1200,
      };

      AppState.files = [
        {
          availableSignals: [
            'Engine Speed',
            'Measured Engine Torque',
            'Gas Pedal Position',
            'Boost Pressure',
            'Spark Advance',
          ],
          signals: {
            'Engine Speed': [
              { x: 1000, y: 2000 },
              { x: 2000, y: 5000 },
            ],
            'Measured Engine Torque': [
              { x: 1000, y: 300 },
              { x: 2000, y: 400 },
            ],
            'Gas Pedal Position': [
              { x: 1000, y: 90 },
              { x: 2000, y: 90 },
            ],
            'Boost Pressure': [
              { x: 1000, y: 1.2 },
              { x: 2000, y: 1.5 },
            ],
            'Spark Advance': [
              { x: 1000, y: 10 },
              { x: 2000, y: 25 },
            ],
          },
        },
      ];
    });

    test('populateSignalList excludes base keys and filters search results', () => {
      DynoManager.openModal();

      const listContainer = document.getElementById('dynoSignalList');
      expect(listContainer.children).toHaveLength(2); // Boost Pressure & Spark Advance

      const searchInput = document.getElementById('dynoSignalSearch');
      searchInput.value = 'Spark';
      searchInput.dispatchEvent(new Event('input'));

      expect(listContainer.children).toHaveLength(1);
      expect(listContainer.innerHTML).toContain('Spark Advance');
    });

    test('selecting extra signal updates selectedExtraSignals and overlays dashed dataset', () => {
      DynoManager.openModal();

      const checkbox = document.getElementById('dyno-sig-Boost Pressure');
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      expect(DynoManager.selectedExtraSignals).toContain('Boost Pressure');
      expect(mockChartInstance.data.datasets).toHaveLength(3);
      expect(mockChartInstance.data.datasets[2].label).toBe('Boost Pressure');
      expect(mockChartInstance.data.datasets[2].borderDash).toEqual([5, 5]);
    });
  });

  describe('Export & Cleanup', () => {
    test('exportChart creates link and triggers PNG download', () => {
      jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        fillStyle: '',
        fillRect: ctxFillRectSpy,
        drawImage: ctxDrawImageSpy,
      });

      const appendSpy = jest
        .spyOn(document.body, 'appendChild')
        .mockImplementation(() => {});
      const removeSpy = jest
        .spyOn(document.body, 'removeChild')
        .mockImplementation(() => {});

      DynoManager.exportChart();

      expect(ctxDrawImageSpy).toHaveBeenCalled();
      expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith(
        'image/png'
      );
    });
  });
});
