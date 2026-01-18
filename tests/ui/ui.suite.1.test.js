import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';

// --- 1. Mocks ---

// Mock Dependencies
const mockMessenger = { on: jest.fn(), emit: jest.fn() };
await jest.unstable_mockModule('../../src/bus.js', () => ({
  messenger: mockMessenger,
}));

const mockDataProcessor = { process: jest.fn() };
await jest.unstable_mockModule('../../src/dataprocessor.js', () => ({
  dataProcessor: mockDataProcessor,
}));

const mockPreferences = {
  prefs: { useCustomPalette: true, persistence: true },
  customPalette: {},
};
await jest.unstable_mockModule('../../src/preferences.js', () => ({
  Preferences: mockPreferences,
}));

const mockAlert = { showAlert: jest.fn() };
await jest.unstable_mockModule('../../src/alert.js', () => ({
  Alert: mockAlert,
}));

const mockPaletteManager = {
  getColorForSignal: jest.fn(() => '#ff0000'),
  getSignalKey: jest.fn((fname, sname) => `${fname}-${sname}`),
};
await jest.unstable_mockModule('../../src/palettemanager.js', () => ({
  PaletteManager: mockPaletteManager,
}));

// Mock ChartManager
const mockChartInstance = {
  resize: jest.fn(),
  update: jest.fn(),
  data: { datasets: [] },
  options: {
    scales: { x: { ticks: {}, grid: {} }, y: { ticks: {}, grid: {} } },
    plugins: { legend: { labels: {} } },
  },
};
const mockChartManager = {
  render: jest.fn(),
  viewMode: 'stack',
};
await jest.unstable_mockModule('../../src/chartmanager.js', () => ({
  ChartManager: mockChartManager,
}));

// Mock Config
const mockAppState = {
  files: [],
  chartInstances: [],
  version: { tag: 'v1.0', repoUrl: 'http://repo' },
  activeHighlight: null,
};
await jest.unstable_mockModule('../../src/config.js', () => ({
  AppState: mockAppState,
  DOM: { get: (id) => document.getElementById(id) },
  DEFAULT_SIGNALS: ['RPM'],
}));

// --- 2. Imports ---
const { UI, InfoPage } = await import('../../src/ui.js');

// --- 3. Test Suite ---
describe('UI Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAppState.files = [];
    mockAppState.chartInstances = [];
    mockChartManager.viewMode = 'stack';
    mockPreferences.prefs.useCustomPalette = true;

    // Setup DOM
    // Added .sidebar-backdrop to fix the mobile toggle test
    document.body.innerHTML = `
      <div id="resizer"></div>
      <div id="sidebar" class="sidebar">
        <div class="control-group">
          <h3>Header</h3>
          <div class="group-content"></div>
        </div>
      </div>
      <div class="sidebar-backdrop"></div> 

      <div id="mainContent"></div>
      <div id="loadingOverlay" style="display:none"></div>
      <div id="loadingText"></div>
      <button id="cancelLoadBtn"></button>
      <div id="signalList"></div>
      <div id="scanResults"></div>
      <div id="scanCount"></div>
      <div id="chartContainer"></div>
      <div id="fileInfo"></div>
      <div id="appVersion"></div>
      <div id="infoModal" style="display:none"></div>
      <input type="checkbox" id="hideInfoCheckbox">
      <button id="closeInfoBtn"></button>
      <button id="showInfoBtn"></button>
      
      <select id="xyFileSelect"></select>
      <select id="xyXAxis"></select>
      <select id="xyYAxis"></select>

      <button id="btn-theme-light"></button>
      <button id="btn-theme-dark"></button>
      <button class="btn-sample">Load Sample</button>
      <div id="toggle-target" style="display:none"></div>
    `;

    // Mock localStorage
    const localStorageMock = (function () {
      let store = {};
      return {
        getItem: jest.fn((key) => store[key] || null),
        setItem: jest.fn((key, value) => {
          store[key] = value.toString();
        }),
        removeItem: jest.fn((key) => {
          delete store[key];
        }),
        clear: jest.fn(() => {
          store = {};
        }),
      };
    })();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });

    // Mock Fullscreen API
    const mainContent = document.getElementById('mainContent');
    if (mainContent) {
      mainContent.requestFullscreen = jest.fn(() => Promise.resolve());
    }
    document.exitFullscreen = jest.fn();
  });

  describe('Initialization (init)', () => {
    test('registers event listeners', () => {
      UI.init();
      expect(mockMessenger.on).toHaveBeenCalledWith(
        'ui:updateDataLoadedState',
        expect.any(Function)
      );
      expect(mockMessenger.on).toHaveBeenCalledWith(
        'ui:set-loading',
        expect.any(Function)
      );
      expect(mockMessenger.on).toHaveBeenCalledWith(
        'dataprocessor:batch-load-completed',
        expect.any(Function)
      );
    });

    test('handles ui:updateDataLoadedState event', () => {
      UI.init();
      const callback = mockMessenger.on.mock.calls.find(
        (c) => c[0] === 'ui:updateDataLoadedState'
      )[1];

      callback({ status: true });
      expect(
        document.getElementById('chartContainer').classList.contains('has-data')
      ).toBe(true);

      callback({ status: false });
      expect(
        document.getElementById('chartContainer').classList.contains('has-data')
      ).toBe(false);
    });

    test('handles dataprocessor:batch-load-completed event', () => {
      UI.init();
      const callback = mockMessenger.on.mock.calls.find(
        (c) => c[0] === 'dataprocessor:batch-load-completed'
      )[1];

      const renderSpy = jest.spyOn(UI, 'renderSignalList');
      const loadSpy = jest.spyOn(UI, 'setLoading');

      // FIX: Added 'availableSignals' array to prevent forEach error
      mockAppState.files = [{ name: 'test', availableSignals: [] }];

      callback();

      expect(renderSpy).toHaveBeenCalled();
      expect(loadSpy).toHaveBeenCalledWith(false);
      expect(document.getElementById('fileInfo').innerText).toContain(
        '1 logs loaded'
      );
    });
  });

  describe('Selectors & Toggles', () => {
    test('populateXYSelectors handles empty files', () => {
      UI.populateXYSelectors();
      expect(document.getElementById('xyFileSelect').innerHTML).toContain(
        'No files loaded'
      );
    });

    test('populateXYSelectors populates options and defaults', () => {
      mockAppState.files = [
        {
          name: 'log1.json',
          availableSignals: ['Speed', 'Engine Rpm', 'Boost Pressure'],
        },
      ];

      UI.populateXYSelectors();

      const fileSel = document.getElementById('xyFileSelect');
      const xSel = document.getElementById('xyXAxis');
      const ySel = document.getElementById('xyYAxis');

      expect(fileSel.children.length).toBe(1);
      expect(xSel.innerHTML).toContain('Speed');

      // Auto-selection logic
      expect(xSel.value).toBe('Engine Rpm');
      expect(ySel.value).toBe('Boost Pressure');
    });

    test('toggleItem toggles display and resizes chart', () => {
      mockAppState.chartInstance = mockChartInstance;
      const el = document.getElementById('toggle-target');

      UI.toggleItem('toggle-target');
      expect(el.style.display).toBe('block');
      expect(mockChartInstance.resize).toHaveBeenCalled();

      UI.toggleItem('toggle-target');
      expect(el.style.display).toBe('none');
    });
  });

  describe('Sidebar Logic', () => {
    test('toggles sidebar sections on header click', () => {
      UI.initSidebarSectionsCollapse();
      const header = document.querySelector('.control-group h3');
      const group = document.querySelector('.control-group');

      header.click();
      expect(group.classList.contains('collapsed')).toBe(true);
      expect(localStorage.setItem).toHaveBeenCalled();
    });

    test('restores sidebar state from localStorage', () => {
      window.localStorage.getItem.mockReturnValue(JSON.stringify([true]));
      UI.restoreSidebarState();
      const group = document.querySelector('.control-group');
      expect(group.classList.contains('collapsed')).toBe(true);
    });

    test('toggleSidebar handles mobile vs desktop', () => {
      const sidebar = document.getElementById('sidebar');
      const backdrop = document.querySelector('.sidebar-backdrop');

      // Desktop
      window.innerWidth = 1024;
      UI.toggleSidebar();
      expect(sidebar.classList.contains('collapsed')).toBe(true);

      // Mobile
      window.innerWidth = 500;
      UI.toggleSidebar();
      expect(sidebar.classList.contains('active')).toBe(true);
      // backdrop should now exist thanks to beforeEach fix
      expect(backdrop.classList.contains('active')).toBe(true);
    });

    test('Resizer updates width on drag', () => {
      UI.initResizer();
      const resizer = document.getElementById('resizer');
      const sidebar = document.getElementById('sidebar');

      // Mouse Down
      resizer.dispatchEvent(new MouseEvent('mousedown'));

      // Mouse Move
      const moveEvent = new MouseEvent('mousemove', { clientX: 300 });
      document.dispatchEvent(moveEvent);

      expect(sidebar.style.width).toBe('300px');

      // Mouse Up
      document.dispatchEvent(new MouseEvent('mouseup'));
    });
  });

  describe('Signal List & Visibility', () => {
    beforeEach(() => {
      mockAppState.files = [
        {
          name: 'Log 1',
          availableSignals: ['RPM', 'Speed'],
        },
      ];
      mockAppState.chartInstances = [
        {
          data: {
            datasets: [
              { label: 'RPM', hidden: false, _fileIdx: 0, _signalKey: 'RPM' },
              {
                label: 'Speed',
                hidden: false,
                _fileIdx: 0,
                _signalKey: 'Speed',
              },
            ],
          },
          update: jest.fn(),
        },
      ];
    });

    test('renderSignalList creates structure and handles color change', () => {
      UI.renderSignalList();

      const container = document.getElementById('signalListContent');
      expect(container.innerHTML).toContain('Log 1');
      expect(container.innerHTML).toContain('RPM');

      // Test Color Picker
      const picker = container.querySelector('.signal-color-picker');
      picker.value = '#0000ff';
      picker.dispatchEvent(new Event('change'));

      expect(mockPreferences.customPalette).toHaveProperty(
        'Log 1-RPM',
        '#0000ff'
      );
      expect(mockChartManager.render).toHaveBeenCalled();
    });

    test('Filter search hides non-matching signals', () => {
      UI.renderSignalList();
      const searchInput = document.getElementById('signalSearchInput');

      searchInput.value = 'Speed';
      searchInput.dispatchEvent(new Event('input'));

      const rpmItem = document.querySelector('[data-signal-name="rpm"]');
      const speedItem = document.querySelector('[data-signal-name="speed"]');

      expect(rpmItem.style.display).toBe('none');
      expect(speedItem.style.display).toBe('flex');
    });

    test('syncSignalVisibility updates chart dataset in Stack Mode', () => {
      mockChartManager.viewMode = 'stack';
      UI.syncSignalVisibility('RPM', false, 0);

      const ds = mockAppState.chartInstances[0].data.datasets[0]; // RPM
      expect(ds.hidden).toBe(true);
      expect(mockAppState.chartInstances[0].update).toHaveBeenCalled();
    });

    test('syncSignalVisibility updates chart dataset in Overlay Mode', () => {
      mockChartManager.viewMode = 'overlay';
      UI.syncSignalVisibility('RPM', false, 0);

      const ds = mockAppState.chartInstances[0].data.datasets[0]; // RPM
      expect(ds.hidden).toBe(true);
      expect(mockAppState.chartInstances[0].update).toHaveBeenCalled();
    });

    test('toggleFileSignals toggles all signals for a file', () => {
      UI.renderSignalList(); // Setup DOM
      mockChartManager.viewMode = 'stack';

      UI.toggleFileSignals(0, false); // Turn off

      const chart = mockAppState.chartInstances[0];
      expect(chart.data.datasets[0].hidden).toBe(true);
      expect(chart.data.datasets[1].hidden).toBe(true);
    });

    test('toggleAllSignals toggles everything', () => {
      UI.renderSignalList();
      mockChartManager.viewMode = 'stack';

      UI.toggleAllSignals(false);

      const chart = mockAppState.chartInstances[0];
      expect(chart.data.datasets[0].hidden).toBe(true);
      expect(chart.update).toHaveBeenCalled();
    });
  });

  describe('Load Sample Data', () => {
    test('fetches and processes data successfully', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ some: 'data' }),
        })
      );

      await UI.loadSampleData(false);

      expect(global.fetch).toHaveBeenCalled();
      expect(mockDataProcessor.process).toHaveBeenCalledWith(
        { some: 'data' },
        expect.stringContaining('json')
      );
    });

    test('handles fetch errors', async () => {
      global.fetch = jest.fn(() => Promise.reject('Network Error'));

      await UI.loadSampleData(false);

      expect(mockAlert.showAlert).toHaveBeenCalledWith(
        expect.stringContaining('Failed')
      );
    });
  });

  describe('Theme & Version', () => {
    test('setTheme updates body class and chart options', () => {
      mockAppState.chartInstances = [mockChartInstance];
      UI.setTheme('dark');

      expect(document.body.classList.contains('dark-theme')).toBe(true);
      expect(mockChartInstance.options.scales.x.ticks.color).toBe('#F8F9FA');
      expect(mockChartInstance.update).toHaveBeenCalled();
    });

    test('initVersionInfo handles dev tag', () => {
      mockAppState.version.tag = 'dev';
      UI.initVersionInfo();
      expect(document.getElementById('appVersion').innerText).toContain(
        'development'
      );
    });

    test('initVersionInfo handles release tag', () => {
      mockAppState.version.tag = 'v1.0.0';
      UI.initVersionInfo();
      expect(document.getElementById('appVersion').innerHTML).toContain(
        'v1.0.0'
      );
    });
  });

  describe('InfoPage', () => {
    test('init attaches listeners and respects preference', () => {
      window.localStorage.getItem.mockReturnValue('true'); // User hid it
      InfoPage.init();

      expect(document.getElementById('infoModal').style.display).not.toBe(
        'flex'
      );

      // Click show button
      document.getElementById('showInfoBtn').click();
      expect(document.getElementById('infoModal').style.display).toBe('flex');
    });

    test('close stores preference if checked', () => {
      InfoPage.init();
      const checkbox = document.getElementById('hideInfoCheckbox');
      checkbox.checked = true;

      document.getElementById('closeInfoBtn').click();

      expect(localStorage.setItem).toHaveBeenCalledWith(
        InfoPage.STORAGE_KEY,
        'true'
      );
      expect(document.getElementById('infoModal').style.display).toBe('none');
    });
  });

  describe('Other UI Utilities', () => {
    test('setLoading shows overlay and cancel button', () => {
      const cancelFn = jest.fn();
      UI.setLoading(true, 'Processing', cancelFn);

      const overlay = document.getElementById('loadingOverlay');
      const btn = document.getElementById('cancelLoadBtn');

      expect(overlay.style.display).toBe('flex');
      expect(btn.style.display).toBe('inline-block');

      btn.click();
      expect(cancelFn).toHaveBeenCalled();
    });

    test('resetScannerUI clears results', () => {
      const res = document.getElementById('scanResults');
      res.innerHTML = 'Stuff';
      mockAppState.activeHighlight = 'something';

      UI.resetScannerUI();

      expect(res.innerHTML).toBe('');
      expect(mockAppState.activeHighlight).toBeNull();
    });

    test('toggleFullScreen requests fullscreen', () => {
      UI.toggleFullScreen();
      expect(
        document.getElementById('mainContent').requestFullscreen
      ).toHaveBeenCalled();
    });
  });
});
