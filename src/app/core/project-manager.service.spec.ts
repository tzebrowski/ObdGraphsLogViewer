import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStateService } from './app-state.service';
import { DbManagerService, FileMetadata } from './db-manager.service';
import { EventBusService } from './event-bus.service';
import { MathChannelsService } from './math-channels.service';
import { EVENTS, LoadedFile } from './models';
import { PreferencesService } from './preferences.service';
import { ProjectManagerService } from './project-manager.service';

function makeFile(overrides: Partial<LoadedFile> = {}): LoadedFile {
  return {
    name: 'trip.json',
    rawData: [],
    signals: {},
    startTime: 0,
    duration: 10,
    availableSignals: [],
    metadata: {},
    size: 100,
    dbId: 1,
    ...overrides,
  };
}

function makeMeta(overrides: Partial<FileMetadata> = {}): FileMetadata {
  return {
    id: 1,
    name: 'trip.json',
    size: 100,
    startTime: 0,
    duration: 10,
    availableSignals: ['RPM'],
    metadata: {},
    addedAt: Date.now(),
    ...overrides,
  };
}

function makeDbFake(
  opts: {
    files?: FileMetadata[];
    signals?: Record<number, LoadedFile['signals']>;
  } = {}
) {
  const files = opts.files ?? [];
  const signals = opts.signals ?? {};
  return {
    init: vi.fn().mockResolvedValue(undefined),
    getAllFiles: vi.fn().mockImplementation(async () => files),
    getFileSignals: vi
      .fn()
      .mockImplementation(async (id: number) => signals[id] ?? null),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    clearAll: vi.fn().mockResolvedValue(undefined),
    saveTelemetry: vi.fn().mockResolvedValue(1),
  } as unknown as DbManagerService;
}

function makeMathChannelsFake() {
  return {
    createChannel: vi.fn(),
  } as unknown as MathChannelsService;
}

describe('ProjectManagerService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('registerFile', () => {
    it('adds a new resource for a file not seen before', () => {
      const bus = new EventBusService();
      const appState = new AppStateService(bus);
      const pm = new ProjectManagerService(
        appState,
        makeDbFake(),
        bus,
        new PreferencesService(),
        makeMathChannelsFake()
      );

      pm.registerFile({ name: 'a.json', dbId: 1, size: 100, metadata: {} });

      const stored = JSON.parse(localStorage.getItem('current_project')!);
      expect(stored.resources).toHaveLength(1);
      expect(stored.resources[0]).toEqual(
        expect.objectContaining({ fileName: 'a.json', dbId: 1, isActive: true })
      );
    });

    it('reactivates and un-archives history for an existing resource re-opened by name/size', () => {
      const bus = new EventBusService();
      const appState = new AppStateService(bus);
      const pm = new ProjectManagerService(
        appState,
        makeDbFake(),
        bus,
        new PreferencesService(),
        makeMathChannelsFake()
      );

      pm.registerFile({ name: 'a.json', dbId: 1, size: 100, metadata: {} });
      appState.addFile(makeFile({ name: 'a.json', dbId: 1, size: 100 }));

      bus.emit(EVENTS.ACTION_LOG, {
        type: 'CREATE_MATH_CHANNEL',
        description: 'Created Channel: X',
        payload: {},
        fileIndex: 0,
      });
      appState.removeFileAt(0);
      expect(pm.history()[0].description).toBe('(Archived) Created Channel: X');

      appState.addFile(makeFile({ name: 'a.json', dbId: 1, size: 100 }));
      pm.registerFile({ name: 'a.json', dbId: 1, size: 100, metadata: {} });

      expect(pm.history()[0].description).toBe('Created Channel: X');
      expect(pm.history()[0].targetFileIndex).toBe(0);
    });
  });

  describe('onFileRemoved (via FILE_REMOVED bus event)', () => {
    it('archives history entries pointing at the removed file and shifts later indices down', () => {
      const bus = new EventBusService();
      const appState = new AppStateService(bus);
      const pm = new ProjectManagerService(
        appState,
        makeDbFake(),
        bus,
        new PreferencesService(),
        makeMathChannelsFake()
      );

      appState.addFile(makeFile({ name: 'a.json', dbId: 1 }));
      appState.addFile(makeFile({ name: 'b.json', dbId: 2 }));
      pm.registerFile({ name: 'a.json', dbId: 1, size: 100, metadata: {} });
      pm.registerFile({ name: 'b.json', dbId: 2, size: 100, metadata: {} });

      bus.emit(EVENTS.ACTION_LOG, {
        type: 'CREATE_MATH_CHANNEL',
        description: 'On A',
        payload: {},
        fileIndex: 0,
      });
      bus.emit(EVENTS.ACTION_LOG, {
        type: 'CREATE_MATH_CHANNEL',
        description: 'On B',
        payload: {},
        fileIndex: 1,
      });

      appState.removeFileAt(0);

      const history = pm.history();
      expect(history[0].description).toBe('(Archived) On A');
      expect(history[0].targetFileIndex).toBe(-1);
      expect(history[1].description).toBe('On B');
      expect(history[1].targetFileIndex).toBe(0);
    });
  });

  describe('renameProject', () => {
    it('updates the project name and persists it', () => {
      const bus = new EventBusService();
      const appState = new AppStateService(bus);
      const pm = new ProjectManagerService(
        appState,
        makeDbFake(),
        bus,
        new PreferencesService(),
        makeMathChannelsFake()
      );

      pm.renameProject('Track Day');
      expect(pm.projectName()).toBe('Track Day');

      pm.renameProject('   ');
      expect(pm.projectName()).toBe('Track Day');
    });
  });

  describe('replayHistory', () => {
    it('replays CREATE_MATH_CHANNEL actions for files that still exist', async () => {
      const bus = new EventBusService();
      const appState = new AppStateService(bus);
      const mathChannels = makeMathChannelsFake();
      const pm = new ProjectManagerService(
        appState,
        makeDbFake(),
        bus,
        new PreferencesService(),
        mathChannels
      );

      appState.addFile(makeFile({ name: 'a.json', dbId: 1 }));
      bus.emit(EVENTS.ACTION_LOG, {
        type: 'CREATE_MATH_CHANNEL',
        description: 'Created Channel: X',
        payload: {
          formulaId: 'multiply_const',
          inputs: ['A', '2'],
          channelName: 'X',
          options: {},
        },
        fileIndex: 0,
      });

      await pm.replayHistory();

      expect(mathChannels.createChannel).toHaveBeenCalledWith(
        0,
        'multiply_const',
        ['A', '2'],
        'X',
        expect.objectContaining({ isReplay: true })
      );
    });

    it('skips actions targeting archived (closed) files', async () => {
      const bus = new EventBusService();
      const appState = new AppStateService(bus);
      const mathChannels = makeMathChannelsFake();
      const pm = new ProjectManagerService(
        appState,
        makeDbFake(),
        bus,
        new PreferencesService(),
        mathChannels
      );

      bus.emit(EVENTS.ACTION_LOG, {
        type: 'CREATE_MATH_CHANNEL',
        description: 'Orphaned',
        payload: { formulaId: 'x', inputs: [], channelName: 'X' },
        fileIndex: -1,
      });

      await pm.replayHistory();
      expect(mathChannels.createChannel).not.toHaveBeenCalled();
    });
  });

  describe('init() hydration', () => {
    it('restores only active resources from the DB into AppState', async () => {
      const bus = new EventBusService();
      const appState = new AppStateService(bus);
      const meta = makeMeta({ id: 1, name: 'restored.json' });
      const db = makeDbFake({
        files: [meta],
        signals: { 1: { RPM: [{ x: 0, y: 1 }] } },
      });
      const pm = new ProjectManagerService(
        appState,
        db,
        bus,
        new PreferencesService(),
        makeMathChannelsFake()
      );

      localStorage.setItem(
        'current_project',
        JSON.stringify({
          id: 'p1',
          name: 'My Project',
          createdAt: 0,
          resources: [
            {
              fileId: 'f1',
              dbId: 1,
              fileName: 'restored.json',
              fileSize: 100,
              addedAt: 0,
              isActive: true,
            },
          ],
          history: [],
        })
      );

      await pm.init();

      expect(appState.files()).toHaveLength(1);
      expect(appState.files()[0].name).toBe('restored.json');
      expect(pm.libraryFiles()).toHaveLength(1);
    });

    it('does not restore any resource when rememberFiles preference is false', async () => {
      const bus = new EventBusService();
      const appState = new AppStateService(bus);
      const meta = makeMeta({ id: 1, name: 'restored.json' });
      const db = makeDbFake({
        files: [meta],
        signals: { 1: { RPM: [{ x: 0, y: 1 }] } },
      });
      const preferences = new PreferencesService();
      preferences.setRememberFiles(false);

      const pm = new ProjectManagerService(
        appState,
        db,
        bus,
        preferences,
        makeMathChannelsFake()
      );

      localStorage.setItem(
        'current_project',
        JSON.stringify({
          id: 'p1',
          name: 'My Project',
          createdAt: 0,
          resources: [
            {
              fileId: 'f1',
              dbId: 1,
              fileName: 'restored.json',
              fileSize: 100,
              addedAt: 0,
              isActive: true,
            },
          ],
          history: [],
        })
      );

      await pm.init();
      expect(appState.files()).toHaveLength(0);
    });
  });

  describe('library operations', () => {
    it('loadFromLibrary hydrates the file and registers it', async () => {
      const bus = new EventBusService();
      const appState = new AppStateService(bus);
      const meta = makeMeta({ id: 5, name: 'lib.json' });
      const db = makeDbFake({
        files: [meta],
        signals: { 5: { RPM: [{ x: 0, y: 1 }] } },
      });
      const pm = new ProjectManagerService(
        appState,
        db,
        bus,
        new PreferencesService(),
        makeMathChannelsFake()
      );

      await pm.loadFromLibrary(5);

      expect(appState.files()).toHaveLength(1);
      expect(appState.files()[0].name).toBe('lib.json');
      const stored = JSON.parse(localStorage.getItem('current_project')!);
      expect(stored.resources).toHaveLength(1);
    });

    it('deleteFromLibrary removes the file from the DB and active session', async () => {
      const bus = new EventBusService();
      const appState = new AppStateService(bus);
      const db = makeDbFake();
      const pm = new ProjectManagerService(
        appState,
        db,
        bus,
        new PreferencesService(),
        makeMathChannelsFake()
      );

      appState.addFile(makeFile({ name: 'a.json', dbId: 7 }));
      await pm.deleteFromLibrary(7);

      expect(db.deleteFile).toHaveBeenCalledWith(7);
      expect(appState.files()).toHaveLength(0);
    });

    it('purgeLibrary clears the DB, session, and project bookkeeping', async () => {
      const bus = new EventBusService();
      const appState = new AppStateService(bus);
      const db = makeDbFake();
      const pm = new ProjectManagerService(
        appState,
        db,
        bus,
        new PreferencesService(),
        makeMathChannelsFake()
      );

      appState.addFile(makeFile({ name: 'a.json', dbId: 1 }));
      pm.registerFile({ name: 'a.json', dbId: 1, size: 100, metadata: {} });

      await pm.purgeLibrary();

      expect(db.clearAll).toHaveBeenCalled();
      expect(appState.files()).toHaveLength(0);
      const stored = JSON.parse(localStorage.getItem('current_project')!);
      expect(stored.resources).toHaveLength(0);
      expect(stored.history).toHaveLength(0);
    });
  });
});
