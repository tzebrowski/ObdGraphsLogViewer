import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// ------------------------------------------------------------------
// 1. SETUP GLOBALS
// Must define these BEFORE importing the module under test
// ------------------------------------------------------------------

const localStorageMock = (() => {
  let store = {};
  return {
    getItem: jest.fn((key) => store[key] || null),
    setItem: jest.fn((key, value) => {
      store[key] = value.toString();
    }),
    clear: jest.fn(() => {
      store = {};
    }),
    removeItem: jest.fn((key) => {
      delete store[key];
    }),
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: () => 'test-uuid-' + Math.random(),
  },
  writable: true,
});

// ------------------------------------------------------------------
// 2. DEFINE MOCKS
// Using unstable_mockModule for ESM support
// ------------------------------------------------------------------

jest.unstable_mockModule('../src/config.js', () => ({
  AppState: {
    files: [], // This array will be mutated in tests
  },
}));

// FIX: Added renderSignalList to the UI mock
jest.unstable_mockModule('../src/ui.js', () => ({
  UI: {
    renderProjectHistory: jest.fn(),
    renderSignalList: jest.fn(),
  },
}));

jest.unstable_mockModule('../src/mathchannels.js', () => ({
  mathChannels: {
    createChannel: jest.fn(),
  },
}));

// ------------------------------------------------------------------
// 3. DYNAMIC IMPORTS
// Load modules AFTER mocks are defined
// ------------------------------------------------------------------

const { projectManager } = await import('../src/projectmanager.js');
const { AppState } = await import('../src/config.js');
const { UI } = await import('../src/ui.js');
const { mathChannels } = await import('../src/mathchannels.js');

// ------------------------------------------------------------------
// 4. TEST SUITE
// ------------------------------------------------------------------

describe('ProjectManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.clear();

    // Reset shared state
    AppState.files.length = 0;

    // Reset the singleton instance
    projectManager.resetProject();
  });

  describe('Project Metadata', () => {
    test('should have a default name upon creation/reset', () => {
      const name = projectManager.getProjectName();
      expect(name).toContain('Project');
    });

    test('should rename project and save to storage', () => {
      projectManager.renameProject('My Cool Run');
      expect(projectManager.getProjectName()).toBe('My Cool Run');
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'current_project',
        expect.stringContaining('My Cool Run')
      );
    });

    test('should ignore empty names', () => {
      const oldName = projectManager.getProjectName();
      projectManager.renameProject('');
      projectManager.renameProject('   ');
      expect(projectManager.getProjectName()).toBe(oldName);
    });
  });

  describe('File Registration', () => {
    test('should register a new file', () => {
      const file = { name: 'run1.json', size: 1024 };

      projectManager.registerFile(file);

      const resources = projectManager.getResources();
      expect(resources).toHaveLength(1);
      expect(resources[0].fileName).toBe('run1.json');
      expect(resources[0].isActive).toBe(true);
      expect(UI.renderProjectHistory).toHaveBeenCalled();
    });

    test('should update existing file when registered again', () => {
      const file = { name: 'run1.json', size: 1024 };

      projectManager.registerFile(file);
      projectManager.registerFile(file);

      const resources = projectManager.getResources();
      expect(resources).toHaveLength(1);
      expect(resources[0].isActive).toBe(true);
    });
  });

  describe('File Removal (onFileRemoved)', () => {
    test('should mark file as inactive and archive history', () => {
      const file = { name: 'data.json', size: 500 };
      AppState.files.push(file);
      projectManager.registerFile(file);

      projectManager.logAction('TEST_ACTION', 'Created test', {}, 0);

      projectManager.onFileRemoved(0);

      const resources = projectManager.getResources();
      expect(resources[0].isActive).toBe(false);

      const history = projectManager.getHistory();
      expect(history[0].targetFileIndex).toBe(-1);
      expect(history[0].description).toContain('(Archived)');
    });

    test('should shift indices for subsequent files', () => {
      const f1 = { name: '1.json', size: 1 };
      const f2 = { name: '2.json', size: 1 };
      const f3 = { name: '3.json', size: 1 };

      AppState.files.push(f1, f2, f3);
      projectManager.registerFile(f1);
      projectManager.registerFile(f2);
      projectManager.registerFile(f3);

      projectManager.logAction('ACT_2', 'Action on 2', {}, 1);
      projectManager.logAction('ACT_3', 'Action on 3', {}, 2);

      AppState.files.shift();
      projectManager.onFileRemoved(0);

      const history = projectManager.getHistory();

      const act2 = history.find((h) => h.description === 'Action on 2');
      expect(act2.targetFileIndex).toBe(0);

      const act3 = history.find((h) => h.description === 'Action on 3');
      expect(act3.targetFileIndex).toBe(1);
    });
  });

  describe('History & Replay', () => {
    test('should log actions correctly', () => {
      const file = { name: 'test.json', size: 100 };
      AppState.files.push(file);
      projectManager.registerFile(file);

      projectManager.logAction(
        'CREATE_MATH_CHANNEL',
        'New Math',
        { formula: 'x+y' },
        0
      );

      const history = projectManager.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].actionType).toBe('CREATE_MATH_CHANNEL');
      expect(history[0].payload).toEqual({ formula: 'x+y' });
    });

    test('should replay CREATE_MATH_CHANNEL actions', async () => {
      const file = { name: 'replay.json', size: 100 };
      AppState.files.push(file);
      projectManager.registerFile(file);

      projectManager.logAction(
        'CREATE_MATH_CHANNEL',
        'Boost Calc',
        {
          formulaId: 'boost',
          inputs: ['a'],
          channelName: 'Boost',
          options: { color: 'red' },
        },
        0
      );

      await projectManager.replayHistory();

      expect(mathChannels.createChannel).toHaveBeenCalledWith(
        0,
        'boost',
        ['a'],
        'Boost',
        expect.objectContaining({ color: 'red', isReplay: true })
      );

      // Now this should pass because we defined the mock function
      expect(UI.renderSignalList).toHaveBeenCalled();
    });

    test('should skip replay if file index is -1 (Archived)', async () => {
      const file = { name: 'gone.json', size: 100 };
      projectManager.registerFile(file);
      projectManager.logAction('CREATE_MATH_CHANNEL', 'Old Math', {}, 0);

      projectManager.onFileRemoved(0);

      await projectManager.replayHistory();

      expect(mathChannels.createChannel).not.toHaveBeenCalled();
      // Even if nothing happened, the method calls renderSignalList at the end
      expect(UI.renderSignalList).toHaveBeenCalled();
    });
  });

  describe('Reset', () => {
    test('should clear history but keep loaded files registered', () => {
      const file = { name: 'keep.json', size: 50 };
      AppState.files.push(file);
      projectManager.registerFile(file);
      projectManager.logAction('TEST', 'Something', {}, 0);

      expect(projectManager.getHistory()).toHaveLength(1);

      projectManager.resetProject();

      expect(projectManager.getHistory()).toHaveLength(0);
      expect(projectManager.getResources()).toHaveLength(1);
      expect(projectManager.getResources()[0].fileName).toBe('keep.json');
    });
  });
});
