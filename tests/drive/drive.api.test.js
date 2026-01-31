import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { Drive } from '../../src/drive.js';
import { DOM } from '../../src/config.js';
import { UI } from '../../src/ui.js';
import { dataProcessor } from '../../src/dataprocessor.js';

describe('Drive Module - API & Folder Discovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = `<div id="driveList"></div><div id="driveFileContainer"></div>`;
    DOM.get = jest.fn((id) => document.getElementById(id));
    UI.setLoading = jest.fn();

    global.gapi = {
      client: {
        drive: {
          files: { list: jest.fn(), get: jest.fn() },
        },
        setToken: jest.fn(),
      },
    };
  });

  test('findFolderId handles different name casing variants', async () => {
    gapi.client.drive.files.list.mockResolvedValue({
      result: { files: [{ id: '123', name: 'MyGiulia' }] },
    });

    const id = await Drive.findFolderId('mygiulia');

    expect(gapi.client.drive.files.list).toHaveBeenCalledWith(
      expect.objectContaining({
        q: expect.stringContaining(
          "name = 'mygiulia' or name = 'mygiulia' or name = 'Mygiulia'"
        ),
      })
    );
    expect(id).toBe('123');
  });

  test('findFolderId returns ID on success', async () => {
    gapi.client.drive.files.list.mockResolvedValue({
      result: { files: [{ id: 'folder-123', name: 'mygiulia' }] },
    });

    const id = await Drive.findFolderId('mygiulia');
    expect(id).toBe('folder-123');
  });

  test('listFiles handles missing subfolder error', async () => {
    gapi.client.drive.files.list
      .mockResolvedValueOnce({ result: { files: [{ id: 'root-id' }] } })
      .mockResolvedValueOnce({ result: { files: [] } });

    await Drive.listFiles();

    const container = document.getElementById('driveFileContainer');
    expect(container.innerHTML).toContain('Required folders');
  });
});

describe('Drive Module - Various Tests', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="driveList"></div><div id="driveFileContainer"></div>`;
    localStorage.clear();
    jest.clearAllMocks();
    dataProcessor.process = jest.fn();

    // Reset state
    Drive._state = {
      sortOrder: 'desc',
      filters: { term: '', start: null, end: null },
      pagination: { currentPage: 1, itemsPerPage: 10 },
    };
  });

  test('_applyFilters handles null/empty filter states', () => {
    // Prepare Data Object (not DOM element)
    const item = {
      file: { name: 'Trip-Log.json' },
      timestamp: new Date('2026-01-01').getTime(),
    };

    Drive._state.filters = { term: '', start: null, end: null };

    expect(Drive._applyFilters(item)).toBe(true);
  });

  test('_applyFilters correctly rejects mismatching text', () => {
    const item = {
      file: { name: 'Speed-Test.json' },
      timestamp: new Date('2026-01-01').getTime(),
    };

    Drive._state.filters = { term: 'trip', start: null, end: null };

    expect(Drive._applyFilters(item)).toBe(false);
  });

  test('_applyFilters correctly accepts matching text', () => {
    const item = {
      file: { name: 'Speed-Test.json' },
      timestamp: new Date('2026-01-01').getTime(),
    };

    Drive._state.filters = { term: 'speed', start: null, end: null };

    expect(Drive._applyFilters(item)).toBe(true);
  });

  test('loadFile ignores old requests if a new one starts', async () => {
    // ... existing test code is fine as loadFile logic relies on closure tokens ...
    const fileId1 = 'id-1';
    const fileId2 = 'id-2';

    global.gapi = { client: { drive: { files: { get: jest.fn() } } } };

    gapi.client.drive.files.get.mockResolvedValue({
      result: { data: 'old-data' },
    });

    const promise1 = Drive.loadFile('file1', fileId1);
    const promise2 = Drive.loadFile('file2', fileId2);

    await Promise.all([promise1, promise2]);

    expect(dataProcessor.process).toHaveBeenCalledTimes(1);
    expect(dataProcessor.process).not.toHaveBeenCalledWith(
      expect.anything(),
      'file1'
    );
  });
});
