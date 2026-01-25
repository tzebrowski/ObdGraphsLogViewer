import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';

// ------------------------------------------------------------------
// 1. SETUP MOCKS
// ------------------------------------------------------------------

// Define the mocks for external modules *before* importing them
jest.unstable_mockModule('../../src/config.js', () => ({
  AppState: {
    files: [],
    version: { tag: 'v1.0', repoUrl: 'http://test' },
  },
  DOM: {
    // We will simply forward this to the global document, which we will spy on later
    get: (id) => document.getElementById(id),
  },
  DEFAULT_SIGNALS: [],
}));

jest.unstable_mockModule('../../src/projectmanager.js', () => ({
  projectManager: {
    getProjectName: jest.fn(() => 'Test Project'),
    getHistory: jest.fn(() => []),
    getResources: jest.fn(() => []),
    replayHistory: jest.fn(),
    resetProject: jest.fn(),
    renameProject: jest.fn(),
  },
}));

jest.unstable_mockModule('../../src/bus.js', () => ({
  messenger: { on: jest.fn(), emit: jest.fn() },
}));

// Mock other modules to prevent load errors
jest.unstable_mockModule('../../src/dataprocessor.js', () => ({
  dataProcessor: {},
}));
jest.unstable_mockModule('../../src/preferences.js', () => ({
  Preferences: { prefs: {} },
}));
jest.unstable_mockModule('../../src/alert.js', () => ({ Alert: {} }));
jest.unstable_mockModule('../../src/palettemanager.js', () => ({
  PaletteManager: {},
}));
jest.unstable_mockModule('../../src/chartmanager.js', () => ({
  ChartManager: {},
}));
jest.unstable_mockModule('../../src/mathchannels.js', () => ({
  mathChannels: {},
}));

// ------------------------------------------------------------------
// 2. DYNAMIC IMPORTS
// ------------------------------------------------------------------

const { UI } = await import('../../src/ui.js');
const { AppState } = await import('../../src/config.js');
const { projectManager } = await import('../../src/projectmanager.js');

// ------------------------------------------------------------------
// 3. HELPERS
// ------------------------------------------------------------------

function setupDomMocks(mockElements = {}) {
  // Reset the getElementById spy to return specific mocks for this test
  jest.spyOn(document, 'getElementById').mockImplementation((id) => {
    if (mockElements[id]) return mockElements[id];

    // Default fallback mock element
    return {
      style: { display: '' },
      innerText: '',
      innerHTML: '',
      classList: { add: jest.fn(), remove: jest.fn(), toggle: jest.fn() },
      addEventListener: jest.fn(),
    };
  });
}

// ------------------------------------------------------------------
// 4. TESTS
// ------------------------------------------------------------------

describe('UI - Project History & Replay', () => {
  let projectHistoryList, btnReplayProject, projectHistoryContainer;

  beforeEach(() => {
    jest.clearAllMocks();
    AppState.files.length = 0;

    // Spy on document methods instead of overwriting global.document
    jest.spyOn(document, 'querySelector').mockImplementation(() => null);

    jest.spyOn(document, 'createElement').mockImplementation(() => ({
      classList: { add: jest.fn(), remove: jest.fn(), toggle: jest.fn() },
      style: {},
      setAttribute: jest.fn(),
      appendChild: jest.fn(),
      addEventListener: jest.fn(),
      querySelector: jest.fn(),
    }));

    jest.spyOn(document, 'createDocumentFragment').mockImplementation(() => ({
      appendChild: jest.fn(),
    }));

    // Create fresh mock elements for the variables we want to inspect
    projectHistoryList = { innerHTML: '', style: {} };
    btnReplayProject = { style: {}, disabled: false };
    projectHistoryContainer = { style: { display: 'none' } };

    // Setup the specific elements used by renderProjectHistory
    setupDomMocks({
      projectHistoryList,
      btnReplayProject,
      projectHistoryContainer,
      projectNameDisplay: { innerText: '' },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks(); // Clean up spies on global objects
  });

  describe('renderProjectHistory', () => {
    test('should show empty state when no files are loaded', () => {
      // Setup: 0 files in AppState
      projectManager.getResources.mockReturnValue([]);

      UI.renderProjectHistory();

      // Should show specific empty message
      expect(projectHistoryList.innerHTML).toContain('No active files');
      // Should ensure container is visible (per requirements)
      expect(projectHistoryContainer.style.display).toBe('block');
      // Replay button should be hidden
      expect(btnReplayProject.style.display).toBe('none');
    });

    test('should render files and DISABLE replay button if total actions is 0', () => {
      // Setup: 1 file loaded, but 0 history actions
      const file = { name: 'test.json', size: 100 };
      AppState.files.push(file);

      projectManager.getResources.mockReturnValue([
        { fileName: 'test.json', fileSize: 100, isActive: true, fileId: '1' },
      ]);
      projectManager.getHistory.mockReturnValue([]); // No actions

      UI.renderProjectHistory();

      // Check rendering
      expect(projectHistoryList.innerHTML).toContain('test.json');
      expect(projectHistoryList.innerHTML).toContain(
        'File loaded (no actions yet)'
      );

      // Check Replay Button State
      expect(btnReplayProject.style.display).toBe('block');
      expect(btnReplayProject.disabled).toBe(true);
      expect(btnReplayProject.style.opacity).toBe('0.5');
      expect(btnReplayProject.style.cursor).toBe('not-allowed');
    });

    test('should render files and ENABLE replay button if actions exist', () => {
      // Setup: 1 file loaded with 1 action
      const file = { name: 'data.json', size: 500 };
      AppState.files.push(file);

      projectManager.getResources.mockReturnValue([
        { fileName: 'data.json', fileSize: 500, isActive: true, fileId: 'abc' },
      ]);
      projectManager.getHistory.mockReturnValue([
        { resourceId: 'abc', timestamp: 1000, description: 'Created Math' },
      ]);

      UI.renderProjectHistory();

      // Check Replay Button State
      expect(btnReplayProject.style.display).toBe('block');
      expect(btnReplayProject.disabled).toBe(false);
      expect(btnReplayProject.style.opacity).toBe('1');
      expect(btnReplayProject.style.cursor).toBe('pointer');
    });

    test('should filter out files that are not in AppState (closed files)', () => {
      // Setup: Project has 2 files, but AppState only has 1 loaded
      const activeFile = { name: 'active.json', size: 10 };
      AppState.files.push(activeFile);

      projectManager.getResources.mockReturnValue([
        { fileName: 'active.json', fileSize: 10, isActive: true, fileId: '1' },
        { fileName: 'closed.json', fileSize: 20, isActive: true, fileId: '2' },
      ]);

      UI.renderProjectHistory();

      expect(projectHistoryList.innerHTML).toContain('active.json');
      expect(projectHistoryList.innerHTML).not.toContain('closed.json');
    });
  });

  describe('toggleHistoryGroup', () => {
    test('should toggle display block/none and rotate icon', () => {
      const content = { style: { display: 'none' } };
      const icon = { style: { transform: '' } };

      const header = {
        nextElementSibling: content,
        querySelector: jest.fn(() => icon),
      };

      // 1. Expand
      UI.toggleHistoryGroup(header);
      expect(content.style.display).toBe('block');
      expect(icon.style.transform).toBe('rotate(0deg)');

      // 2. Collapse
      UI.toggleHistoryGroup(header);
      expect(content.style.display).toBe('none');
      expect(icon.style.transform).toBe('rotate(-90deg)');
    });
  });
});
