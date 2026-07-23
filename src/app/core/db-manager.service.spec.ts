import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DbManagerService } from './db-manager.service';
import { LoadedFile } from './models';

describe('DbManagerService', () => {
  let mockObjectStore: {
    add: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    getAll: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
  let mockTransaction: {
    objectStore: ReturnType<typeof vi.fn>;
    onerror: (() => void) | null;
  };
  let mockDbInstance: {
    objectStoreNames: { contains: ReturnType<typeof vi.fn> };
    createObjectStore: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
  };
  let mockOpenRequest: {
    result: unknown;
    error: unknown;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
    onupgradeneeded: ((event: { target: { result: unknown } }) => void) | null;
  };
  let mockIdb: { open: ReturnType<typeof vi.fn> };
  let dbManager: DbManagerService;

  beforeEach(() => {
    mockObjectStore = {
      add: vi.fn(),
      get: vi.fn(),
      getAll: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
    };
    mockTransaction = {
      objectStore: vi.fn(() => mockObjectStore),
      onerror: null,
    };
    mockDbInstance = {
      objectStoreNames: { contains: vi.fn(() => false) },
      createObjectStore: vi.fn(),
      transaction: vi.fn(() => mockTransaction),
    };
    mockOpenRequest = {
      result: null,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    mockIdb = { open: vi.fn(() => mockOpenRequest) };

    vi.stubGlobal('indexedDB', mockIdb);
    dbManager = new DbManagerService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const initDb = async () => {
    const promise = dbManager.init();
    mockOpenRequest.result = mockDbInstance;
    mockOpenRequest.onsuccess?.();
    await promise;
  };

  it('init() opens the database and creates the schema on upgrade', async () => {
    const initPromise = dbManager.init();
    expect(mockIdb.open).toHaveBeenCalledWith('GiuliaTelemetryDB', 1);

    mockOpenRequest.result = mockDbInstance;
    mockOpenRequest.onupgradeneeded?.({ target: { result: mockDbInstance } });
    expect(mockDbInstance.createObjectStore).toHaveBeenCalledWith(
      'files',
      expect.objectContaining({ keyPath: 'id' })
    );
    expect(mockDbInstance.createObjectStore).toHaveBeenCalledWith(
      'signals',
      expect.objectContaining({ keyPath: 'fileId' })
    );

    mockOpenRequest.result = mockDbInstance;
    mockOpenRequest.onsuccess?.();
    await initPromise;
  });

  it('init() rejects on open error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const initPromise = dbManager.init();
    mockOpenRequest.error = new Error('Access Denied');
    mockOpenRequest.onerror?.();
    await expect(initPromise).rejects.toThrow('Access Denied');
    consoleSpy.mockRestore();
  });

  it('saveTelemetry() writes metadata and signals to separate stores', async () => {
    await initDb();

    const mockFileReq: { onsuccess: (() => void) | null; result: number } = {
      onsuccess: null,
      result: 101,
    };
    const mockSignalReq: { onsuccess: (() => void) | null } = {
      onsuccess: null,
    };
    mockObjectStore.add
      .mockReturnValueOnce(mockFileReq)
      .mockReturnValueOnce(mockSignalReq);

    const file = {
      name: 'log.json',
      size: 500,
      startTime: 0,
      duration: 1,
      availableSignals: [],
      signals: { RPM: [] },
      metadata: { car: 'Alfa' },
    } as unknown as LoadedFile;

    const savePromise = dbManager.saveTelemetry(file);
    expect(mockObjectStore.add).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: 'log.json', metadata: { car: 'Alfa' } })
    );
    mockFileReq.onsuccess?.();

    await Promise.resolve();
    expect(mockObjectStore.add).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ fileId: 101, data: file.signals })
    );
    mockSignalReq.onsuccess?.();

    expect(await savePromise).toBe(101);
  });

  it('getAllFiles() returns the resolved list', async () => {
    await initDb();
    const mockReq = {
      onsuccess: null as (() => void) | null,
      result: [{ id: 1, name: 'file1' }],
    };
    mockObjectStore.getAll.mockReturnValue(mockReq);

    const promise = dbManager.getAllFiles();
    mockReq.onsuccess?.();

    const result = await promise;
    expect(result).toHaveLength(1);
    expect(mockDbInstance.transaction).toHaveBeenCalledWith(
      'files',
      'readonly'
    );
  });

  it('getFileSignals() returns only the .data payload', async () => {
    await initDb();
    const mockReq = {
      onsuccess: null as (() => void) | null,
      result: { fileId: 99, data: { Speed: [] } },
    };
    mockObjectStore.get.mockReturnValue(mockReq);

    const promise = dbManager.getFileSignals(99);
    mockReq.onsuccess?.();

    expect(await promise).toEqual({ Speed: [] });
    expect(mockObjectStore.get).toHaveBeenCalledWith(99);
  });

  it('deleteFile() removes from both stores', async () => {
    await initDb();
    await dbManager.deleteFile(55);
    expect(mockDbInstance.transaction).toHaveBeenCalledWith(
      ['files', 'signals'],
      'readwrite'
    );
    expect(mockObjectStore.delete).toHaveBeenCalledTimes(2);
    expect(mockObjectStore.delete).toHaveBeenCalledWith(55);
  });

  it('clearAll() wipes both stores', async () => {
    await initDb();
    await dbManager.clearAll();
    expect(mockObjectStore.clear).toHaveBeenCalledTimes(2);
  });

  it('gracefully no-ops when IndexedDB is unavailable', async () => {
    vi.unstubAllGlobals();
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unsupported = new DbManagerService();

    await expect(unsupported.init()).resolves.toBeUndefined();
    await expect(unsupported.getAllFiles()).resolves.toEqual([]);
    await expect(
      unsupported.saveTelemetry({} as LoadedFile)
    ).resolves.toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('not available')
    );

    consoleSpy.mockRestore();
  });
});
