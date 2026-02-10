import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';

const mockMessenger = { on: jest.fn(), emit: jest.fn() };
const mockDataProcessor = { process: jest.fn() };
const mockPreferences = {
  prefs: { useCustomPalette: true, persistence: true, smoothLines: false },
  customPalette: {},
  savePreferences: jest.fn(),
};
const mockAlert = { showAlert: jest.fn() };
const mockPaletteManager = {
  getColorForSignal: jest.fn(() => '#ff0000'),
  getSignalKey: jest.fn((fname, sname) => `${fname}-${sname}`),
};
const mockChartManager = {
  render: jest.fn(),
  viewMode: 'stack',
  chartInstances: [],
};
const mockProjectManager = {
  getProjectName: jest.fn(() => 'Test Project'),
  getHistory: jest.fn(() => []),
  getResources: jest.fn(() => []),
  replayHistory: jest.fn(),
  resetProject: jest.fn(),
  renameProject: jest.fn(),
};
const mockMapManager = {
  updateTheme: jest.fn(),
};

const mockSignalRegistry = {
  findSignal: jest.fn(),
};

await jest.unstable_mockModule('../src/bus.js', () => ({
  messenger: mockMessenger,
}));
await jest.unstable_mockModule('../src/dataprocessor.js', () => ({
  dataProcessor: mockDataProcessor,
}));
await jest.unstable_mockModule('../src/preferences.js', () => ({
  Preferences: mockPreferences,
}));
await jest.unstable_mockModule('../src/alert.js', () => ({ Alert: mockAlert }));
await jest.unstable_mockModule('../src/palettemanager.js', () => ({
  PaletteManager: mockPaletteManager,
}));
await jest.unstable_mockModule('../src/chartmanager.js', () => ({
  ChartManager: mockChartManager,
}));
await jest.unstable_mockModule('../src/projectmanager.js', () => ({
  projectManager: mockProjectManager,
}));
await jest.unstable_mockModule('../src/mapmanager.js', () => ({
  mapManager: mockMapManager,
}));

await jest.unstable_mockModule('../src/signalregistry.js', () => ({
  signalRegistry: mockSignalRegistry,
}));

const mockAppState = {
  files: [],
  chartInstances: [],
  version: { tag: 'v1.0.0', repoUrl: 'http://repo' },
  activeHighlight: null,
};
await jest.unstable_mockModule('../src/config.js', () => ({
  AppState: mockAppState,
  DOM: { get: (id) => document.getElementById(id) },
  DEFAULT_SIGNALS: ['RPM'],
}));

const { UI, InfoPage } = await import('../src/ui.js');
const { AppState } = await import('../src/config.js');

describe('UI Module Consolidated', () => {
  const setupDOM = () => {
    document.body.innerHTML = `
      <div id="resizer"></div>
      <div id="sidebar" class="sidebar" style="width: 250px;">
        <div class="control-group">
          <h3 class="group-header">Section</h3>
          <div class="group-content"></div>
        </div>
      </div>
      <div id="mainContent"></div>
      
      <div id="loadingOverlay" style="display:none">
        <span id="loadingText"></span>
        <button id="cancelLoadBtn"></button>
      </div>

      <div id="signalList">
        <div id="signalSearchInput"></div>
        <div id="clearSignalSearch"></div>
        <div id="signalListContent"></div>
      </div>
      <div id="chartContainer"></div>
      <div id="scanResults"></div>
      <div id="scanCount"></div>
      
      <div id="fileInfo"></div>
      <div id="appVersion"></div>
      <div id="projectNameDisplay"></div>
      
      <div id="infoModal" style="display:none">
        <button id="closeInfoBtn"></button>
        <button id="showInfoBtn"></button>
        <input type="checkbox" id="hideInfoCheckbox">
      </div>

      <select id="xyFileSelect"></select>
      <select id="xyXAxis"></select>
      <select id="xyYAxis"></select>
      
      <button class="xy-btn">XY</button>
      <button title="View Histogram">Hist</button>
      <button id="btn-create-math"></button>
      <button id="btn-theme-light"></button>
      <button id="btn-theme-dark"></button>
      <button class="btn-sample">Load Sample</button>
      <button id="btnReplayProject">Replay</button>
      
      <div id="projectHistoryList"></div>
      <div id="projectHistoryContainer" style="display:none"></div>
      
      <div id="toggle-target" style="display:none"></div>
    `;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    setupDOM();

    AppState.files = [];
    AppState.chartInstances = [];
    mockChartManager.viewMode = 'stack';

    const store = {};
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn((key) => store[key] || null),
        setItem: jest.fn((key, val) => {
          store[key] = val.toString();
        }),
        removeItem: jest.fn((key) => {
          delete store[key];
        }),
        clear: jest.fn(() => {}),
      },
      writable: true,
    });

    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      writable: true,
    });

    const mainContent = document.getElementById('mainContent');
    if (mainContent) {
      mainContent.requestFullscreen = jest.fn(() => Promise.resolve());
    }
    document.exitFullscreen = jest.fn();
  });

  describe('Initialization', () => {
    test('init registers all event listeners', () => {
      UI.init();
      expect(mockMessenger.on).toHaveBeenCalledWith(
        'project:updated',
        expect.any(Function)
      );
      expect(mockMessenger.on).toHaveBeenCalledWith(
        'project:replayHistory',
        expect.any(Function)
      );
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

    test('ui:updateDataLoadedState enables/disables UI buttons', () => {
      UI.init();
      const handler = mockMessenger.on.mock.calls.find(
        (c) => c[0] === 'ui:updateDataLoadedState'
      )[1];
      const xyBtn = document.querySelector('.xy-btn');
      const histBtn = document.querySelector('button[title="View Histogram"]');

      handler({ status: true });
      expect(
        document.getElementById('chartContainer').classList.contains('has-data')
      ).toBe(true);
      expect(xyBtn.disabled).toBe(false);
      expect(histBtn.disabled).toBe(false);

      handler({ status: false });
      expect(
        document.getElementById('chartContainer').classList.contains('has-data')
      ).toBe(false);
      expect(xyBtn.disabled).toBe(true);
      expect(histBtn.disabled).toBe(true);
    });

    test('ui:set-loading updates overlay', () => {
      UI.init();
      const handler = mockMessenger.on.mock.calls.find(
        (c) => c[0] === 'ui:set-loading'
      )[1];

      handler({ message: 'Testing...' });
      const overlay = document.getElementById('loadingOverlay');
      const text = document.getElementById('loadingText');

      expect(overlay.style.display).toBe('flex');
      expect(text.innerText).toBe('Testing...');
    });

    test('dataprocessor:batch-load-completed enables UI and updates text', () => {
      UI.init();
      AppState.files = [{ availableSignals: [] }, { availableSignals: [] }];
      const handler = mockMessenger.on.mock.calls.find(
        (c) => c[0] === 'dataprocessor:batch-load-completed'
      )[1];
      const spy = jest.spyOn(UI, 'renderSignalList');

      handler();

      expect(spy).toHaveBeenCalled();
      expect(document.getElementById('fileInfo').innerText).toBe(
        '2 logs loaded'
      );
      expect(document.querySelector('.xy-btn').disabled).toBe(false);
    });
  });

  describe('Signal List Logic', () => {
    beforeEach(() => {
      AppState.files = [
        {
          name: 'Log 1.json',
          availableSignals: ['RPM', 'Speed', 'Math: Calculated'],
        },
      ];
      AppState.chartInstances = [
        {
          data: {
            datasets: [
              { label: 'RPM', hidden: false, _fileIdx: 0, _signalKey: 'RPM' },
              {
                label: 'Speed',
                hidden: true,
                _fileIdx: 0,
                _signalKey: 'Speed',
              },
            ],
          },
          update: jest.fn(),
        },
      ];
    });

    test('renderSignalList generates proper HTML structure including Math signals', () => {
      UI.renderSignalList();
      const content = document.getElementById('signalListContent');
      expect(content.innerHTML).toContain('Log 1.json');
      expect(content.innerHTML).toContain('Math: Calculated');
      expect(content.innerHTML).toContain('RPM');
    });

    test('renderSignalList shows empty message if no files', () => {
      AppState.files = [];
      UI.renderSignalList();
      const list = document.getElementById('signalList');
      expect(list.innerHTML).toContain('No signals available');
    });

    test('search filter hides unmatched signals', () => {
      UI.renderSignalList();
      const input = document.getElementById('signalSearchInput');

      input.value = 'RPM';
      input.dispatchEvent(new Event('input'));

      const rpmItem = document.querySelector('[data-signal-name="rpm"]');
      const speedItem = document.querySelector('[data-signal-name="speed"]');

      expect(rpmItem.style.display).not.toBe('none');
      expect(speedItem.style.display).toBe('none');
    });

    test('clearSignalFilter clears input and resets view', () => {
      UI.renderSignalList();
      const input = document.getElementById('signalSearchInput');
      input.value = 'RPM';

      UI.clearSignalFilter();

      expect(input.value).toBe('');
    });

    test('color picker updates preference correctly', () => {
      UI.renderSignalList();
      const picker = document.querySelector('.signal-color-picker');
      picker.value = '#00ff00';
      picker.dispatchEvent(new Event('change'));

      expect(mockPreferences.customPalette['Log 1.json-Math: Calculated']).toBe(
        '#00ff00'
      );
      expect(mockChartManager.render).toHaveBeenCalled();
    });
  });

  describe('Visibility Toggles', () => {
    test('toggleFileSignals toggles checkbox and chart dataset', () => {
      document.getElementById('signalList').innerHTML = `
        <input type="checkbox" data-file-idx="0" data-key="S1" checked>
        <input type="checkbox" data-file-idx="0" data-key="S2" checked>
      `;
      AppState.chartInstances = [
        {
          data: { datasets: [{ hidden: false }, { hidden: false }] },
          update: jest.fn(),
        },
      ];

      UI.toggleFileSignals(0, false);

      const inputs = document.querySelectorAll('#signalList input');
      expect(inputs[0].checked).toBe(false);
      expect(AppState.chartInstances[0].data.datasets[0].hidden).toBe(true);
      expect(AppState.chartInstances[0].update).toHaveBeenCalled();
    });

    test('toggleAllSignals updates all checkboxes', () => {
      document.getElementById('signalList').innerHTML =
        `<input type="checkbox" checked>`;
      AppState.chartInstances = [
        {
          data: { datasets: [{ hidden: false }] },
          update: jest.fn(),
        },
      ];

      UI.toggleAllSignals(false);

      expect(document.querySelector('#signalList input').checked).toBe(false);
      expect(AppState.chartInstances[0].data.datasets[0].hidden).toBe(true);
    });

    test('syncSignalVisibility handles Overlay mode', () => {
      mockChartManager.viewMode = 'overlay';
      AppState.chartInstances = [
        {
          data: {
            datasets: [{ _fileIdx: 0, _signalKey: 'RPM', hidden: false }],
          },
          update: jest.fn(),
        },
      ];

      UI.syncSignalVisibility('RPM', false, 0);

      expect(AppState.chartInstances[0].data.datasets[0].hidden).toBe(true);
      expect(AppState.chartInstances[0].update).toHaveBeenCalled();
    });
  });

  describe('Sidebar & Mobile', () => {
    test('initResizer drag logic updates width', () => {
      UI.initResizer();
      const resizer = document.getElementById('resizer');
      const sidebar = document.getElementById('sidebar');

      resizer.dispatchEvent(new MouseEvent('mousedown'));
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));

      expect(sidebar.style.width).toBe('300px');
      document.dispatchEvent(new MouseEvent('mouseup'));
    });

    test('initResizer ignores out of bounds', () => {
      UI.initResizer();
      const resizer = document.getElementById('resizer');
      const sidebar = document.getElementById('sidebar');

      resizer.dispatchEvent(new MouseEvent('mousedown'));

      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 }));
      expect(sidebar.style.width).not.toBe('100px');

      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 800 }));
      expect(sidebar.style.width).not.toBe('800px');

      document.dispatchEvent(new MouseEvent('mouseup'));
    });

    test('toggleSidebar handles desktop collapse', () => {
      window.innerWidth = 1024;
      UI.toggleSidebar();
      expect(
        document.getElementById('sidebar').classList.contains('collapsed')
      ).toBe(true);
    });

    test('toggleSidebar handles mobile active state', () => {
      window.innerWidth = 500;
      UI.initMobileUI();

      UI.toggleSidebar();
      expect(
        document.getElementById('sidebar').classList.contains('active')
      ).toBe(true);
      expect(
        document.querySelector('.sidebar-backdrop').classList.contains('active')
      ).toBe(true);
    });

    test('mobile backdrop click closes sidebar', () => {
      window.innerWidth = 500;
      UI.initMobileUI();

      const sidebar = document.getElementById('sidebar');
      const backdrop = document.querySelector('.sidebar-backdrop');

      sidebar.classList.add('active');
      backdrop.classList.add('active');

      backdrop.click();

      expect(sidebar.classList.contains('active')).toBe(false);
      expect(backdrop.classList.contains('active')).toBe(false);
    });

    test('sidebar sections save state to localStorage', () => {
      UI.initSidebarSectionsCollapse();
      const header = document.querySelector('.group-header');
      const group = document.querySelector('.control-group');

      header.click();
      expect(group.classList.contains('collapsed')).toBe(true);
      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        'sidebar_collapsed_states',
        expect.any(String)
      );
    });

    test('restoreSidebarState applies saved classes', () => {
      window.localStorage.getItem.mockReturnValue(JSON.stringify([true]));
      UI.restoreSidebarState();

      const group = document.querySelector('.control-group');
      expect(group.classList.contains('collapsed')).toBe(true);
    });
  });

  describe('Project Actions & History', () => {
    test('replayProjectHistory calls manager', () => {
      UI.replayProjectHistory();
      expect(mockProjectManager.replayHistory).toHaveBeenCalled();
    });

    test('resetProject calls manager', () => {
      UI.resetProject();
      expect(mockProjectManager.resetProject).toHaveBeenCalled();
    });

    test('editProjectName prompts user and calls manager', () => {
      jest.spyOn(window, 'prompt').mockReturnValue('New Name');
      UI.editProjectName();
      expect(mockProjectManager.renameProject).toHaveBeenCalledWith('New Name');
    });

    test('renders empty state correctly', () => {
      mockProjectManager.getResources.mockReturnValue([]);
      UI.renderProjectHistory();

      const list = document.getElementById('projectHistoryList');
      expect(list.innerHTML).toContain('No active files');
      expect(document.getElementById('btnReplayProject').style.display).toBe(
        'none'
      );
    });

    test('renders loaded files and enables replay', () => {
      AppState.files = [{ name: 'test.json', size: 123 }];
      mockProjectManager.getResources.mockReturnValue([
        { fileName: 'test.json', fileSize: 123, isActive: true, fileId: '1' },
      ]);
      mockProjectManager.getHistory.mockReturnValue([
        { resourceId: '1', timestamp: 1000, description: 'Created Chart' },
      ]);

      UI.renderProjectHistory();

      const list = document.getElementById('projectHistoryList');
      expect(list.innerHTML).toContain('test.json');
      expect(list.innerHTML).toContain('Created Chart');
      expect(document.getElementById('btnReplayProject').disabled).toBe(false);
    });

    test('filters out closed files (not in AppState)', () => {
      AppState.files = [{ name: 'active.json', size: 10 }];
      mockProjectManager.getResources.mockReturnValue([
        { fileName: 'active.json', fileSize: 10, isActive: true, fileId: '1' },
        { fileName: 'closed.json', fileSize: 20, isActive: true, fileId: '2' },
      ]);

      UI.renderProjectHistory();

      const list = document.getElementById('projectHistoryList');
      expect(list.innerHTML).toContain('active.json');
      expect(list.innerHTML).not.toContain('closed.json');
    });

    test('toggleHistoryGroup switches display', () => {
      const header = document.createElement('div');
      const content = document.createElement('div');
      const icon = document.createElement('i');
      icon.className = 'toggle-icon';
      header.appendChild(icon);

      document.body.appendChild(header);
      document.body.appendChild(content);
      content.style.display = 'none';

      UI.toggleHistoryGroup(header);
      expect(content.style.display).toBe('block');
      expect(icon.style.transform).toBe('rotate(0deg)');

      header.remove();
      content.remove();
    });
  });

  describe('Settings & Meta', () => {
    test('setTheme updates classes and chart options', () => {
      const mockChart = {
        options: {
          scales: {
            x: { ticks: { color: '' }, grid: { color: '' } },
            y: { ticks: { color: '' }, grid: { color: '' } },
          },
          plugins: { legend: { labels: { color: '' } } },
        },
        update: jest.fn(),
      };
      AppState.chartInstances = [mockChart];

      UI.setTheme('dark');

      expect(document.body.classList.contains('dark-theme')).toBe(true);
      expect(mockChart.options.scales.x.ticks.color).toBe('#F8F9FA');
      expect(mockMapManager.updateTheme).toHaveBeenCalledWith('dark');
    });

    test('initVersionInfo parses tags', () => {
      AppState.version.tag = 'v2.0';
      UI.initVersionInfo();
      expect(document.getElementById('appVersion').innerHTML).toContain('v2.0');
    });

    test('InfoPage init handles "Hide Forever" logic', () => {
      window.localStorage.getItem.mockReturnValue('true');
      InfoPage.init();
      expect(document.getElementById('infoModal').style.display).not.toBe(
        'flex'
      );
    });

    test('InfoPage open/close logic with persistence', () => {
      InfoPage.open();
      expect(document.getElementById('infoModal').style.display).toBe('flex');

      document.getElementById('hideInfoCheckbox').checked = true;

      InfoPage.close();
      expect(document.getElementById('infoModal').style.display).toBe('none');
    });
  });

  describe('Utilities', () => {
    test('loadSampleData calls fetch and processor', async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: 'sample' }),
        })
      );

      await UI.loadSampleData(false);
      expect(global.fetch).toHaveBeenCalled();
      expect(mockDataProcessor.process).toHaveBeenCalled();
    });

    test('loadSampleData handles error', async () => {
      global.fetch = jest.fn(() => Promise.reject('Network Error'));
      await UI.loadSampleData(false);
      expect(mockAlert.showAlert).toHaveBeenCalled();
    });

    test('populateXYSelectors selects defaults from Config', () => {
      AppState.files = [
        { name: 'log.json', availableSignals: ['RPM', 'Boost'] },
      ];

      mockSignalRegistry.findSignal.mockImplementation((key) => {
        if (key === 'Engine Speed') return 'RPM';
        if (key === 'Intake Manifold Pressure Measured') return 'Boost';
        return null;
      });

      UI.populateXYSelectors();

      expect(document.getElementById('xyXAxis').value).toBe('RPM');
      expect(document.getElementById('xyYAxis').value).toBe('Boost');
    });

    test('toggleFullScreen catches rejection errors', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const main = document.getElementById('mainContent');
      main.requestFullscreen = jest.fn().mockRejectedValue(new Error('Denied'));

      UI.toggleFullScreen();
      await new Promise((r) => setTimeout(r, 0));

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error'));
      consoleSpy.mockRestore();
    });

    test('Graceful handling of missing DOM elements', () => {
      document.body.innerHTML = '';

      expect(() => UI.updateDataLoadedState(true)).not.toThrow();
      expect(() => UI.resetScannerUI()).not.toThrow();
      expect(() => UI.setLoading(true)).not.toThrow();
    });
  });
});
