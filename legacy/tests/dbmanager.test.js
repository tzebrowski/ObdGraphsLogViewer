import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';

describe('DBManager Module', () => {
  let dbManager;
  let mockIDB;
  let mockDBInstance;
  let mockTransaction;
  let mockObjectStore;
  let mockOpenRequest;

  beforeEach(async () => {
    // 1. Reset modules to get a fresh DBManager instance for each test
    jest.resetModules();

    // 2. Mock external dependencies (bus.js)
    await jest.unstable_mockModule('../src/bus.js', () => ({
      messenger: { emit: jest.fn(), on: jest.fn() },
    }));
    await jest.unstable_mockModule('../src/config.js', () => ({
      EVENTS: {},
    }));

    // 3. Setup IndexedDB Mocks
    mockObjectStore = {
      add: jest.fn(),
      get: jest.fn(),
      getAll: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn(),
    };

    mockTransaction = {
      objectStore: jest.fn(() => mockObjectStore),
      oncomplete: null,
      onerror: null,
    };

    mockDBInstance = {
      objectStoreNames: {
        contains: jest.fn(() => false),
      },
      createObjectStore: jest.fn(),
      transaction: jest.fn(() => mockTransaction),
      close: jest.fn(),
    };

    mockOpenRequest = {
      result: null,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };

    mockIDB = {
      open: jest.fn(() => mockOpenRequest),
    };

    // Inject mock into global scope
    global.indexedDB = mockIDB;

    // 4. Import the module under test (After mocking globals)
    const module = await import('../src/dbmanager.js');
    dbManager = module.dbManager;
  });

  afterEach(() => {
    delete global.indexedDB;
  });

  // --- Helper to simulate successful DB opening ---
  const initDB = async () => {
    const promise = dbManager.init();
    // Simulate DB ready
    if (mockOpenRequest.onsuccess) {
      mockOpenRequest.result = mockDBInstance;
      mockOpenRequest.onsuccess();
    }
    await promise;
  };

  test('init() opens database and creates schema on upgrade', async () => {
    const initPromise = dbManager.init();

    // Verify open was called
    expect(mockIDB.open).toHaveBeenCalledWith('GiuliaTelemetryDB', 1);

    // Simulate Upgrade Needed event
    const upgradeEvent = { target: { result: mockDBInstance } };
    if (mockOpenRequest.onupgradeneeded) {
      mockOpenRequest.onupgradeneeded(upgradeEvent);
    }

    // Expect stores to be created
    expect(mockDBInstance.createObjectStore).toHaveBeenCalledWith(
      'files',
      expect.objectContaining({ keyPath: 'id' })
    );
    expect(mockDBInstance.createObjectStore).toHaveBeenCalledWith(
      'signals',
      expect.objectContaining({ keyPath: 'fileId' })
    );

    // Simulate Success
    mockOpenRequest.result = mockDBInstance;
    mockOpenRequest.onsuccess();

    await initPromise;
  });

  test('init() handles error during open', async () => {
    // Silence console.error for this expected failure
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const initPromise = dbManager.init();

    // Simulate Error
    mockOpenRequest.error = new Error('Access Denied');
    mockOpenRequest.onerror();

    await expect(initPromise).rejects.toThrow('Access Denied');

    consoleSpy.mockRestore();
  });

  test('saveTelemetry() writes metadata and signals to separate stores', async () => {
    await initDB();

    // Mock the add requests
    const mockFileReq = { onsuccess: null, result: 101 }; // New File ID
    const mockSignalReq = { onsuccess: null };

    mockObjectStore.add
      .mockReturnValueOnce(mockFileReq) // First call: files store
      .mockReturnValueOnce(mockSignalReq); // Second call: signals store

    const fileData = {
      name: 'log.json',
      size: 500,
      signals: { RPM: [1, 2, 3] }, // Heavy data
      metadata: { car: 'Alfa' },
    };

    const savePromise = dbManager.saveTelemetry(fileData);

    // 1. Simulate file add success
    expect(mockObjectStore.add).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        name: 'log.json',
        metadata: { car: 'Alfa' },
      })
    );
    mockFileReq.onsuccess({ target: { result: 101 } });

    // 2. Simulate signal add success (should happen after file add)
    // Wait for promise chain to tick
    await new Promise(process.nextTick);

    expect(mockObjectStore.add).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        fileId: 101,
        data: fileData.signals,
      })
    );
    mockSignalReq.onsuccess();

    const resultId = await savePromise;
    expect(resultId).toBe(101);
  });

  test('getAllFiles() returns list of files', async () => {
    await initDB();

    const mockReq = { onsuccess: null, result: [{ id: 1, name: 'file1' }] };
    mockObjectStore.getAll.mockReturnValue(mockReq);

    const promise = dbManager.getAllFiles();
    mockReq.onsuccess();

    const result = await promise;
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('file1');
    expect(mockDBInstance.transaction).toHaveBeenCalledWith(
      'files',
      'readonly'
    );
  });

  test('getFileSignals() returns signals for specific ID', async () => {
    await initDB();

    const mockReq = {
      onsuccess: null,
      result: { fileId: 99, data: { Speed: [] } },
    };
    mockObjectStore.get.mockReturnValue(mockReq);

    const promise = dbManager.getFileSignals(99);

    // Simulate DB response
    mockReq.onsuccess();

    const result = await promise;
    expect(mockObjectStore.get).toHaveBeenCalledWith(99);
    expect(result).toEqual({ Speed: [] }); // Should return just the .data part
  });

  test('deleteFile() removes from both stores', async () => {
    await initDB();

    await dbManager.deleteFile(55);

    expect(mockDBInstance.transaction).toHaveBeenCalledWith(
      ['files', 'signals'],
      'readwrite'
    );
    expect(mockObjectStore.delete).toHaveBeenCalledTimes(2);
    expect(mockObjectStore.delete).toHaveBeenCalledWith(55);
  });

  test('clearAll() wipes both stores', async () => {
    await initDB();

    await dbManager.clearAll();

    expect(mockObjectStore.clear).toHaveBeenCalledTimes(2);
  });

  test('Gracefully handles environment without IndexedDB', async () => {
    // Remove IDB support for this specific test
    delete global.indexedDB;

    // Re-import module to trigger feature detection in constructor
    jest.resetModules();
    const mod = await import('../src/dbmanager.js');
    const safeManager = mod.dbManager;

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Should resolve without error, just do nothing
    await expect(safeManager.init()).resolves.toBeUndefined();
    await expect(safeManager.getAllFiles()).resolves.toEqual([]);
    await expect(safeManager.saveTelemetry({})).resolves.toBeNull();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('not available')
    );
    consoleSpy.mockRestore();
  });
});
