import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { Drive } from '../../src/drive.js';
import { DOM } from '../../src/config.js';
import { UI } from '../../src/ui.js';
import { DataProcessor } from '../../src/dataprocesssor.js';

describe('Drive Module - API & Folder Discovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = `<div id="driveList"></div>`;
    DOM.get = jest.fn((id) => document.getElementById(id));
    UI.setLoading = jest.fn();

    // Global GAPI mock
    global.gapi = {
      client: {
        drive: {
          files: {
            list: jest.fn(),
            get: jest.fn(),
          },
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
    // Verify query format (Line 13-16)
    expect(gapi.client.drive.files.list).toHaveBeenCalledWith(
      expect.objectContaining({
        q: expect.stringContaining("name = 'mygiulia'"),
      })
    );
  });

  test('listFiles handles missing subfolder error', async () => {
    // Mock root found, but subfolder not found
    gapi.client.drive.files.list
      .mockResolvedValueOnce({ result: { files: [{ id: 'root-id' }] } }) // find root
      .mockResolvedValueOnce({ result: { files: [] } }); // find sub (trips)

    await Drive.listFiles();

    const container = document.getElementById('driveFileContainer');
    expect(container.innerHTML).toContain('Required folders');
  });
});

describe('Drive Module - Various Tests', () => {
  let container;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="driveList"></div>
      <div id="driveFileContainer"></div>
    `;
    container = document.getElementById('driveFileContainer');
    localStorage.clear();
    jest.clearAllMocks();

    DataProcessor.process = jest.fn();

    // Global GAPI mock
    global.gapi = {
      client: {
        drive: {
          files: {
            list: jest.fn(),
            get: jest.fn(),
          },
        },
        setToken: jest.fn(),
      },
    };
  });

  test('_applyFilters handles null/empty filter states', () => {
    const card = document.createElement('div');
    card.innerHTML =
      '<div class="file-name-title">Trip-Log</div><div class="meta-item"><span>2026-01-01</span></div>';

    // Reset state to empty filters
    Drive._state.filters = { term: '', start: null, end: null };

    expect(Drive._applyFilters(card)).toBe(true);
  });

  test('_applyFilters correctly rejects mismatching text', () => {
    const card = document.createElement('div');
    card.innerHTML =
      '<div class="file-name-title">Speed-Test</div><div class="meta-item"><span>2026-01-01</span></div>';

    Drive._state.filters = { term: 'trip', start: null, end: null };

    expect(Drive._applyFilters(card)).toBe(false);
  });

  test('loadFile ignores old requests if a new one starts (Token check)', async () => {
    const fileId1 = 'id-1';
    const fileId2 = 'id-2';

    // Setup gapi.get to return successfully
    gapi.client.drive.files.get.mockResolvedValue({
      result: { data: 'old-data' },
    });

    // Start first load
    const promise1 = Drive.loadFile('file1', fileId1);

    // Start second load immediately (increments activeLoadToken)
    const promise2 = Drive.loadFile('file2', fileId2);

    await Promise.all([promise1, promise2]);

    // DataProcessor should only be called for the second file
    expect(DataProcessor.process).toHaveBeenCalledTimes(1);
    expect(DataProcessor.process).not.toHaveBeenCalledWith(
      expect.anything(),
      'file1'
    );
  });
});
