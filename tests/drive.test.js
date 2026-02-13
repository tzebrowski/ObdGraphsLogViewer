import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { Drive } from '../src/drive.js';
import { DOM } from '../src/config.js';
import { UI } from '../src/ui.js';
import { dataProcessor } from '../src/dataprocessor.js';

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

global.confirm = jest.fn();

describe('Drive Module Combined Suite', () => {
  let container;

  beforeEach(() => {
    jest.clearAllMocks();

    document.body.innerHTML = `
      <div id="driveListContainer"></div>
      <div id="driveList"></div>
      <div id="driveFileContainer"></div>
      <input type="text" id="driveSearchInput" />
      <i id="clearDriveSearchText"></i>
      <input type="date" id="driveDateStart" />
      <input type="date" id="driveDateEnd" />
      <button id="clearDriveFilters"></button>
      <button id="driveSortToggle"></button>
      <div id="driveResultCount"></div>
    `;
    container = document.getElementById('driveFileContainer');

    DOM.get = jest.fn((id) => document.getElementById(id));
    UI.setLoading = jest.fn();
    dataProcessor.process = jest.fn();
    global.confirm.mockReturnValue(true);

    Drive.fileData = [];
    Drive._state = {
      sortOrder: 'desc',
      filters: { term: '', start: null, end: null },
      pagination: { currentPage: 1, itemsPerPage: 10 },
    };

    localStorage.clear();
  });

  describe('Initialization & listFiles', () => {
    test('listFiles returns early if driveList DOM element is missing', async () => {
      document.body.innerHTML = '';
      DOM.get.mockReturnValue(null);

      await Drive.listFiles();

      expect(gapi.client.drive.files.list).not.toHaveBeenCalled();
    });

    test('listFiles renders search interface and calls fetchJsonFiles on success', async () => {
      gapi.client.drive.files.list
        .mockResolvedValueOnce({
          result: { files: [{ id: 'root-123', name: 'mygiulia' }] },
        })
        .mockResolvedValueOnce({
          result: { files: [{ id: 'sub-123', name: 'trips' }] },
        })
        .mockResolvedValueOnce({ result: { files: [], nextPageToken: null } });

      await Drive.listFiles();

      const listEl = document.getElementById('driveList');
      expect(listEl.style.display).toBe('block');
      expect(document.getElementById('driveSearchInput')).not.toBeNull();
      expect(gapi.client.drive.files.list).toHaveBeenCalledTimes(3);
    });

    test('listFiles handles error when required folders are missing', async () => {
      gapi.client.drive.files.list.mockResolvedValueOnce({
        result: { files: [{ id: 'root-123' }] },
      });
      gapi.client.drive.files.list.mockResolvedValueOnce({
        result: { files: [] },
      });

      await Drive.listFiles();

      const container = document.getElementById('driveFileContainer');
      expect(container.innerHTML).toContain('Required folders not found');
    });

    test('listFiles handles API errors gracefully', async () => {
      gapi.client.drive.files.list.mockResolvedValueOnce({
        result: { files: [{ id: 'root-id' }] },
      });

      gapi.client.drive.files.list.mockResolvedValueOnce({
        result: { files: [{ id: 'sub-id' }] },
      });

      gapi.client.drive.files.list.mockRejectedValueOnce({
        message: 'Network Error',
      });

      await Drive.listFiles();

      const container = document.getElementById('driveFileContainer');
      expect(container.innerHTML).toContain('Drive error: Network Error');
    });
  });

  describe('Utilities', () => {
    test('getFileMetadata correctly parses valid filenames', () => {
      const fileName = 'trip-log-1704556800000-3600.json';
      const meta = Drive.getFileMetadata(fileName);

      expect(meta.length).toBe('3600');
      expect(meta.date).toContain('2024-01-06');
    });

    test('getFileMetadata returns default object for invalid filenames', () => {
      const fileName = 'invalid-file.json';
      const result = Drive.getFileMetadata(fileName);
      expect(result).toEqual({ date: 'Unknown', length: '?' });
    });

    test('extractTimestamp extracts timestamp correctly from filename', () => {
      const fileName = 'trip-log-1766840037973-3600.json';
      const timestamp = Drive.extractTimestamp(fileName);

      expect(timestamp).toBe(1766840037973);
    });

    test('extractTimestamp returns 0 for invalid filenames', () => {
      const fileName = 'invalid.json';
      expect(Drive.extractTimestamp(fileName)).toBe(0);
    });
  });

  describe('API & Data Fetching', () => {
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

    test('findFolderId handles API errors returns null', async () => {
      gapi.client.drive.files.list.mockRejectedValue(new Error('Fail'));
      const id = await Drive.findFolderId('folder');
      expect(id).toBeNull();
    });

    test('fetchJsonFiles populates fileData and renders UI', async () => {
      const mockFiles = [
        { id: 'f1', name: 'trip-2026-1766840037973-3600.json', size: '2048' },
      ];
      global.gapi.client.drive.files.list.mockResolvedValue({
        result: { files: mockFiles, nextPageToken: null },
      });

      await Drive.fetchJsonFiles('folder-id');

      expect(Drive.fileData).toHaveLength(1);
      expect(Drive.fileData[0].file.id).toBe('f1');
      expect(Drive.fileData[0].timestamp).toBe(1766840037973);

      expect(container.innerHTML).toContain('trip-2026');
      expect(container.innerHTML).toContain('2 KB');
    });

    test('fetchJsonFiles loops until nextPageToken is null (Pagination Fetching)', async () => {
      gapi.client.drive.files.list
        .mockResolvedValueOnce({
          result: {
            files: [{ id: '1', name: 'f1.json' }],
            nextPageToken: 'token-abc',
          },
        })
        .mockResolvedValueOnce({
          result: {
            files: [{ id: '2', name: 'f2.json' }],
            nextPageToken: null,
          },
        });

      await Drive.fetchJsonFiles('folder-id');

      expect(gapi.client.drive.files.list).toHaveBeenCalledTimes(2);
      expect(Drive.fileData).toHaveLength(2);
    });

    test('fetchJsonFiles handles empty results', async () => {
      gapi.client.drive.files.list.mockResolvedValue({ result: { files: [] } });
      await Drive.fetchJsonFiles('folder-id');
      expect(container.innerHTML).toContain('No log files found');
    });

    test('handleApiError clears token on 401 error', () => {
      const error = { status: 401, message: 'Unauthorized' };
      Drive.handleApiError(error, container);

      expect(gapi.client.setToken).toHaveBeenCalledWith(null);
      expect(container.innerHTML).toContain('Session expired');
    });

    test('handleApiError handles 403 error same as 401', () => {
      const error = { status: 403, message: 'Forbidden' };
      Drive.handleApiError(error, container);
      expect(gapi.client.setToken).toHaveBeenCalledWith(null);
    });
  });

  describe('Logic: Filtering & Loading', () => {
    test('_applyFilters handles null/empty filter states', () => {
      const item = { file: { name: 'Trip.json' }, timestamp: 1000 };
      Drive._state.filters = { term: '', start: null, end: null };
      expect(Drive._applyFilters(item)).toBe(true);
    });

    test('_applyFilters correctly matches text', () => {
      const item = { file: { name: 'Speed-Test.json' }, timestamp: 1000 };

      Drive._state.filters.term = 'speed';
      expect(Drive._applyFilters(item)).toBe(true);

      Drive._state.filters.term = 'trip';
      expect(Drive._applyFilters(item)).toBe(false);
    });

    test('_applyFilters correctly matches date range', () => {
      const item = { file: { name: 'A.json' }, timestamp: 1000 };
      Drive._state.filters = { term: '', start: 500, end: 1500 };
      expect(Drive._applyFilters(item)).toBe(true);

      Drive._state.filters = { term: '', start: 1500, end: 2000 };
      expect(Drive._applyFilters(item)).toBe(false);
    });

    test('loadFile ignores old requests if a new one starts (Token check)', async () => {
      gapi.client.drive.files.get.mockResolvedValue({
        result: { data: 'old' },
      });

      const p1 = Drive.loadFile('file1', 'id1');
      const p2 = Drive.loadFile('file2', 'id2');

      await Promise.all([p1, p2]);

      expect(dataProcessor.process).toHaveBeenCalledTimes(1);
      expect(dataProcessor.process).toHaveBeenCalledWith(
        expect.anything(),
        'file2'
      );
    });

    test('loadFile handles API errors', async () => {
      const consoleSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      gapi.client.drive.files.get.mockRejectedValue({ message: 'Load Failed' });

      await Drive.loadFile('file', 'id');

      expect(dataProcessor.process).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('UI Interactions & Event Listeners', () => {
    beforeEach(() => {
      const listEl = document.getElementById('driveList');
      if (listEl) listEl.innerHTML = Drive.TEMPLATES.searchInterface();
    });

    test('initSearch attaches listeners and handles input changes', () => {
      Drive.initSearch();

      const input = document.getElementById('driveSearchInput');
      const clearBtn = document.getElementById('clearDriveSearchText');

      input.value = 'test';
      input.dispatchEvent(new Event('input'));

      clearBtn.style.display = 'block';
      clearBtn.click();

      expect(input.value).toBe('');
      expect(Drive._state.filters.term).toBe('');
    });

    test('Clear Date Filters resets inputs and updates state', () => {
      Drive.initSearch();
      const start = document.getElementById('driveDateStart');
      const end = document.getElementById('driveDateEnd');
      const clearBtn = document.getElementById('clearDriveFilters');

      start.value = '2023-01-01';
      end.value = '2023-01-31';

      clearBtn.click();

      expect(start.value).toBe('');
      expect(end.value).toBe('');
    });

    test('Sort toggle switches order and triggers refresh', () => {
      Drive.initSearch();
      const sortBtn = document.getElementById('driveSortToggle');

      Drive._state.sortOrder = 'desc';

      sortBtn.click();

      expect(Drive._state.sortOrder).toBe('asc');
      expect(sortBtn.innerHTML).toContain('Oldest');
    });

    test('Date inputs trigger update on change', () => {
      Drive.initSearch();
      const start = document.getElementById('driveDateStart');

      start.value = '2023-01-01';
      start.dispatchEvent(new Event('input'));
    });
  });

  describe('Pagination & Grouping', () => {
    const generateMockData = (count) => {
      return Array.from({ length: count }, (_, i) => ({
        file: { id: `${i}`, name: `log-${i}.json`, size: 1000 },
        meta: { date: '2026-01-01', length: '100' },
        timestamp: new Date('2026-01-01').getTime() + i,
      }));
    };

    test('refreshUI renders only itemsPerPage', () => {
      Drive.fileData = generateMockData(15);
      Drive._state.pagination.itemsPerPage = 10;
      Drive._state.pagination.currentPage = 1;

      Drive.refreshUI();

      const cards = container.querySelectorAll('.drive-file-card');
      expect(cards).toHaveLength(10);

      const pageInfo = container.querySelector('.pagination-controls span');
      expect(pageInfo.textContent).toContain('1-10 of 15');
    });

    test('Next Page button increments page and updates UI', () => {
      Drive.fileData = generateMockData(15);
      Drive._state.pagination.itemsPerPage = 10;
      Drive.refreshUI();

      const nextBtn = container.querySelector('#nextPageBtn');
      nextBtn.click();

      const cards = container.querySelectorAll('.drive-file-card');
      expect(cards).toHaveLength(5);
      expect(Drive._state.pagination.currentPage).toBe(2);
    });

    test('Prev Page button decrements page', () => {
      Drive.fileData = generateMockData(15);
      Drive._state.pagination.itemsPerPage = 10;
      Drive._state.pagination.currentPage = 2;
      Drive.refreshUI();

      const prevBtn = container.querySelector('#prevPageBtn');
      prevBtn.click();

      expect(Drive._state.pagination.currentPage).toBe(1);
    });

    test('Pagination buttons respect bounds', () => {
      Drive.fileData = generateMockData(5);
      Drive._state.pagination.itemsPerPage = 10;
      Drive._state.pagination.currentPage = 1;
      Drive.refreshUI();

      const nextBtn = container.querySelector('#nextPageBtn');
      nextBtn.click();
      expect(Drive._state.pagination.currentPage).toBe(1);

      const prevBtn = container.querySelector('#prevPageBtn');
      prevBtn.click();
      expect(Drive._state.pagination.currentPage).toBe(1);
    });

    test('Month Header Toggles visibility (Expand/Collapse)', () => {
      Drive.fileData = [
        {
          file: { name: 'Jan' },
          timestamp: new Date('2026-01-01').getTime(),
          meta: {},
        },
      ];
      Drive.refreshUI();

      const header = container.querySelector('.month-header');
      const list = container.querySelector('.month-list');

      expect(list.classList.contains('drv-hidden')).toBe(true);
      expect(header.querySelector('i').className).toContain('fa-chevron-right');

      header.click();
      expect(list.style.display).toBe('block');
      expect(header.querySelector('i').className).toContain('fa-chevron-down');

      header.click();
      expect(list.style.display).toBe('none');
      expect(header.querySelector('i').className).toContain('fa-chevron-right');
    });
  });

  describe('Recent History', () => {
    test('Recent History renders if localStorage has items', () => {
      Drive.fileData = [
        {
          file: { id: 'rec1', name: 'Recent.json' },
          meta: {},
          timestamp: 1000,
        },
      ];
      localStorage.setItem('recent_logs', JSON.stringify(['rec1']));

      Drive.refreshUI();

      const recentSection = container.querySelector('.recent-section');
      expect(recentSection).not.toBeNull();
      expect(recentSection.innerHTML).toContain('Recent.json');
    });

    test('clearRecentHistory wipes localStorage and updates UI', () => {
      Drive.fileData = [
        {
          file: { id: 'rec1', name: 'Recent.json' },
          meta: {},
          timestamp: 1000,
        },
      ];
      localStorage.setItem('recent_logs', JSON.stringify(['rec1']));
      Drive.refreshUI();

      const clearBtn = document.getElementById('clearRecentHistory');
      global.confirm.mockReturnValue(true);

      clearBtn.click();

      expect(localStorage.getItem('recent_logs')).toBeNull();
      expect(container.querySelector('.recent-section')).toBeNull();
    });

    test('clearRecentHistory does nothing if confirm is cancelled', () => {
      localStorage.setItem('recent_logs', JSON.stringify(['rec1']));
      global.confirm.mockReturnValue(false);

      Drive.clearRecentHistory();

      expect(localStorage.getItem('recent_logs')).not.toBeNull();
    });
  });
});
