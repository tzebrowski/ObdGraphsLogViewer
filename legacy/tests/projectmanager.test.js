import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';

// 1. Mock Dependencies BEFORE importing the module under test
const mockMessenger = { on: jest.fn(), emit: jest.fn() };
const mockMathChannels = { createChannel: jest.fn() };
const mockDbManager = {
  init: jest.fn().mockResolvedValue(),
  getAllFiles: jest.fn().mockResolvedValue([]),
  getFileSignals: jest.fn().mockResolvedValue({}),
  deleteFile: jest.fn().mockResolvedValue(),
  clearAll: jest.fn().mockResolvedValue(),
};

// Mock AppState and EVENTS
const mockAppState = { files: [] };
const mockEvents = { FILE_REMOVED: 'file:removed' };

// Mock Preferences for the new load strategy
const mockPreferences = {
  prefs: {
    rememberFiles: false, // Default for tests
  },
};

// Apply mocks
await jest.unstable_mockModule('../src/bus.js', () => ({
  messenger: mockMessenger,
}));
await jest.unstable_mockModule('../src/mathchannels.js', () => ({
  mathChannels: mockMathChannels,
}));
await jest.unstable_mockModule('../src/dbmanager.js', () => ({
  dbManager: mockDbManager,
}));
await jest.unstable_mockModule('../src/config.js', () => ({
  AppState: mockAppState,
  EVENTS: mockEvents,
}));
await jest.unstable_mockModule('../src/preferences.js', () => ({
  Preferences: mockPreferences,
}));

// Setup localStorage globally before any imports happen
const store = {};
Object.defineProperty(global, 'localStorage', {
  value: {
    getItem: jest.fn((key) => store[key] || null),
    setItem: jest.fn((key, val) => {
      store[key] = val.toString();
    }),
    removeItem: jest.fn((key) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      for (const key in store) delete store[key];
    }),
  },
  writable: true,
  configurable: true,
});

// 2. Import the module
const { projectManager } = await import('../src/projectmanager.js');

describe('ProjectManager Module', () => {
  let container;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAppState.files = [];
    mockPreferences.prefs.rememberFiles = false; // Reset preference

    // Setup generic DOM container for UI tests
    container = document.createElement('div');
    container.id = 'librarySlot';
    document.body.appendChild(container);

    // Mock confirm dialogs to always say "Yes"
    global.confirm = jest.fn(() => true);

    // Clear local storage mock store
    global.localStorage.clear();

    // Reset project state by creating a fresh instance or resetting via method
    projectManager.resetProject();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('Initialization & Hydration', () => {
    test('initLibraryUI sets container and renders library', async () => {
      // Setup DB to return files
      mockDbManager.getAllFiles.mockResolvedValue([
        { id: 1, name: 'log.json', addedAt: 1000, size: 500 },
      ]);

      await projectManager.initLibraryUI('librarySlot');

      // Wait for async render
      await new Promise(process.nextTick);

      expect(container.textContent).toContain('Library');
      expect(container.textContent).toContain('(1)');
      expect(container.textContent).toContain('log.json');
    });

    test('loadFromStorage respects rememberFiles = false (sets resources inactive)', async () => {
      // Seed localStorage with an active project
      const savedProject = {
        id: 'p1',
        name: 'Saved Proj',
        resources: [
          { fileId: 'r1', dbId: 99, fileName: 'old.json', isActive: true },
        ],
        history: [],
      };
      global.localStorage.setItem(
        'current_project',
        JSON.stringify(savedProject)
      );

      mockPreferences.prefs.rememberFiles = false;

      // To test the private #loadFromStorage, we can isolate the module and re-import it
      // so the constructor runs again with the seeded localStorage and Preferences
      let isolatedManager;
      await jest.isolateModulesAsync(async () => {
        const module = await import('../src/projectmanager.js');
        isolatedManager = module.projectManager;
      });

      isolatedManager.init();

      const resources = isolatedManager.getResources();
      expect(resources).toHaveLength(1);
      // Because rememberFiles is false, isActive should be forcefully set to false
      expect(resources[0].isActive).toBe(false);
    });

    test('loadFromStorage respects rememberFiles = true (keeps resources active)', async () => {
      // Seed localStorage with an active project
      const savedProject = {
        id: 'p1',
        name: 'Saved Proj',
        resources: [
          { fileId: 'r1', dbId: 99, fileName: 'old.json', isActive: true },
        ],
        history: [],
      };
      global.localStorage.setItem(
        'current_project',
        JSON.stringify(savedProject)
      );

      mockPreferences.prefs.rememberFiles = true;

      // Re-import to trigger constructor
      let isolatedManager;
      await jest.isolateModulesAsync(async () => {
        const module = await import('../src/projectmanager.js');
        isolatedManager = module.projectManager;
      });

      isolatedManager.init();

      const resources = isolatedManager.getResources();
      expect(resources).toHaveLength(1);
      // Because rememberFiles is true, it should leave the saved state alone
      expect(resources[0].isActive).toBe(true);
    });
  });

  describe('Library Rendering (UI)', () => {
    beforeEach(async () => {
      projectManager.initLibraryUI('librarySlot');
    });

    test('Renders empty state correctly', async () => {
      mockDbManager.getAllFiles.mockResolvedValue([]);
      await projectManager.renderLibrary();

      expect(container.innerHTML).toContain('No logs saved');
    });

    test('Renders file list with correct "Loaded" status', async () => {
      const dbFiles = [
        { id: 1, name: 'file1.json', addedAt: 2000, duration: 60, size: 100 },
        { id: 2, name: 'file2.json', addedAt: 1000, duration: 120, size: 200 },
      ];
      mockDbManager.getAllFiles.mockResolvedValue(dbFiles);

      mockAppState.files = [{ dbId: 1, name: 'file1.json' }];

      await projectManager.renderLibrary();

      const names = Array.from(container.querySelectorAll('.pm-name')).map(
        (el) => el.textContent.trim()
      );

      expect(names[0]).toBe('file1.json');
      expect(names[1]).toBe('file2.json');

      expect(container.innerHTML).toContain('Loaded');
      expect(container.innerHTML).toContain('fa-plus');
    });

    test('Load button triggers loadFromLibrary', async () => {
      mockDbManager.getAllFiles.mockResolvedValue([
        { id: 10, name: 'click_me.json' },
      ]);
      mockDbManager.getFileSignals.mockResolvedValue({ Speed: [] });

      await projectManager.renderLibrary();

      const loadBtn = container.querySelector('.pm-add-btn');
      loadBtn.click();

      expect(mockMessenger.emit).toHaveBeenCalledWith(
        'ui:set-loading',
        expect.any(Object)
      );

      await new Promise(process.nextTick);

      expect(mockDbManager.getFileSignals).toHaveBeenCalledWith(10);
      expect(mockAppState.files).toHaveLength(1);
      expect(mockAppState.files[0].name).toBe('click_me.json');

      const resources = projectManager.getResources();
      expect(resources[0].fileName).toBe('click_me.json');
      expect(resources[0].isActive).toBe(true);
    });

    test('Delete button triggers removal from DB and UI update', async () => {
      mockDbManager.getAllFiles.mockResolvedValue([
        { id: 5, name: 'delete_me.json' },
      ]);
      await projectManager.renderLibrary();

      const delBtn = container.querySelector('.pm-del-btn');
      delBtn.click();

      expect(global.confirm).toHaveBeenCalled();
      expect(mockDbManager.deleteFile).toHaveBeenCalledWith(5);
      expect(mockDbManager.getAllFiles).toHaveBeenCalledTimes(2);
    });

    test('Purge button clears all data', async () => {
      const originalLocation = window.location;
      delete window.location;
      window.location = { reload: jest.fn() };

      await projectManager.renderLibrary();

      const purgeBtn = container.querySelector('#lib-purge-btn');
      purgeBtn.click();

      expect(global.confirm).toHaveBeenCalled();
      expect(mockDbManager.clearAll).toHaveBeenCalled();

      window.location = originalLocation;
    });
  });

  describe('Project State Management', () => {
    test('registerFile adds new resource to project', () => {
      const file = { name: 'new.json', size: 1024, dbId: 1 };
      projectManager.registerFile(file);

      const res = projectManager.getResources();
      expect(res).toHaveLength(1);
      expect(res[0].fileName).toBe('new.json');
      expect(res[0].dbId).toBe(1);
      expect(res[0].isActive).toBe(true);
    });

    test('registerFile updates existing resource (re-opening file)', () => {
      projectManager.registerFile({ name: 'reuse.json', size: 500, dbId: 1 });

      const res = projectManager.getResources()[0];
      res.isActive = false;

      projectManager.registerFile({ name: 'reuse.json', size: 500, dbId: 1 });

      const updatedRes = projectManager.getResources();
      expect(updatedRes).toHaveLength(1);
      expect(updatedRes[0].isActive).toBe(true);
    });

    test('onFileRemoved marks resource inactive and archives history', () => {
      mockAppState.files = [
        { name: 'f1.json', size: 10 },
        { name: 'f2.json', size: 20 },
      ];

      projectManager.registerFile({ name: 'f1.json', size: 10, dbId: 1 });
      projectManager.registerFile({ name: 'f2.json', size: 20, dbId: 2 });

      projectManager.logAction('TEST_ACTION', 'Did something', {}, 0);

      projectManager.onFileRemoved(0);

      const res = projectManager.getResources();
      const history = projectManager.getHistory();

      expect(res.find((r) => r.fileName === 'f1.json').isActive).toBe(false);
      expect(history[0].targetFileIndex).toBe(-1);
      expect(history[0].description).toContain('(Archived)');
    });

    test('renameProject updates project name', () => {
      projectManager.renameProject('Super Run');
      expect(projectManager.getProjectName()).toBe('Super Run');
      expect(global.localStorage.setItem).toHaveBeenCalled();
    });

    test('resetProject clears resources and history', () => {
      projectManager.registerFile({ name: 'temp.json' });
      projectManager.resetProject();

      expect(projectManager.getResources()).toHaveLength(0);
      expect(projectManager.getHistory()).toHaveLength(0);
      expect(mockMessenger.emit).toHaveBeenCalledWith('project:reset');
    });
  });

  describe('History Logging & Replay', () => {
    test('logAction adds entry to history', () => {
      mockAppState.files = [{ name: 'log.json', size: 100 }];
      projectManager.registerFile({ name: 'log.json', size: 100 });

      projectManager.logAction('MATH', 'Added Math', { formula: 'x+y' }, 0);

      const history = projectManager.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].actionType).toBe('MATH');
      expect(history[0].payload.formula).toBe('x+y');
    });

    test('replayHistory executes MATH actions', async () => {
      mockAppState.files = [{ name: 'log.json' }];

      projectManager.registerFile({ name: 'log.json', size: 100 });
      projectManager.logAction(
        'CREATE_MATH_CHANNEL',
        'Math 1',
        {
          formulaId: 'f1',
          inputs: [],
          channelName: 'M1',
          options: {},
        },
        0
      );

      await projectManager.replayHistory();

      expect(mockMathChannels.createChannel).toHaveBeenCalledWith(
        0,
        'f1',
        [],
        'M1',
        expect.objectContaining({ isReplay: true })
      );
      expect(mockMessenger.emit).toHaveBeenCalledWith(
        'project:replayHistory',
        {}
      );
    });

    test('replayHistory skips actions for closed files (index -1)', async () => {
      projectManager.logAction('TEST', 'Archived Action', {}, -1);

      await projectManager.replayHistory();

      expect(mockMathChannels.createChannel).not.toHaveBeenCalled();
    });
  });
});
