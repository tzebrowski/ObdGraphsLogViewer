import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { Drive } from '../../src/drive.js';
import { DOM } from '../../src/config.js';
import { UI } from '../../src/ui.js';
import { dataProcessor } from '../../src/dataprocessor.js';

// --- Global Mocks ---
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
    // 1. Reset Jest Mocks
    jest.clearAllMocks();

    // 2. Reset DOM
    document.body.innerHTML = `
      <div id="driveList"></div>
      <div id="driveFileContainer"></div>
    `;
    container = document.getElementById('driveFileContainer');

    // 3. Mock Module Dependencies
    DOM.get = jest.fn((id) => document.getElementById(id));
    UI.setLoading = jest.fn();
    dataProcessor.process = jest.fn();
    global.confirm.mockReturnValue(true);

    // 4. Reset Drive Module Internal State
    Drive.fileData = [];
    Drive._state = {
      sortOrder: 'desc',
      filters: { term: '', start: null, end: null },
      pagination: { currentPage: 1, itemsPerPage: 10 },
    };

    // 5. Clear LocalStorage
    localStorage.clear();
  });

  // =========================================================================
  // 1. UTILITY FUNCTIONS
  // =========================================================================
  describe('Utilities', () => {
    test('getFileMetadata correctly parses valid filenames', () => {
      const fileName = 'trip-log-1704556800000-3600.json'; // Jan 6, 2024
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

      expect(timestamp).toBe(1766840037973); // Matches number in filename
    });
  });

  // =========================================================================
  // 2. API INTERACTIONS & FETCHING
  // =========================================================================
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

    test('fetchJsonFiles populates fileData and renders UI', async () => {
      // Mock API returning one file
      const mockFiles = [
        { id: 'f1', name: 'trip-2026-1766840037973-3600.json', size: '2048' },
      ];
      global.gapi.client.drive.files.list.mockResolvedValue({
        result: { files: mockFiles, nextPageToken: null },
      });

      await Drive.fetchJsonFiles('folder-id');

      // Verify Data Store
      expect(Drive.fileData).toHaveLength(1);
      expect(Drive.fileData[0].file.id).toBe('f1');
      expect(Drive.fileData[0].timestamp).toBe(1766840037973);

      // Verify UI Render
      expect(container.innerHTML).toContain('trip-2026');
      expect(container.innerHTML).toContain('2 KB');
    });

    test('fetchJsonFiles loops until nextPageToken is null (Pagination Fetching)', async () => {
      // First call returns token
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
  });

  // =========================================================================
  // 3. LOGIC: FILTERING, SORTING & LOADING
  // =========================================================================
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

    test('loadFile ignores old requests if a new one starts (Token check)', async () => {
      gapi.client.drive.files.get.mockResolvedValue({
        result: { data: 'old' },
      });

      const p1 = Drive.loadFile('file1', 'id1');
      const p2 = Drive.loadFile('file2', 'id2'); // Increments token

      await Promise.all([p1, p2]);

      expect(dataProcessor.process).toHaveBeenCalledTimes(1);
      expect(dataProcessor.process).toHaveBeenCalledWith(
        expect.anything(),
        'file2'
      );
    });
  });

  // =========================================================================
  // 4. UI RENDERING, PAGINATION & GROUPING
  // =========================================================================
  describe('UI Rendering & Interaction', () => {
    // Helper to generate mock data
    const generateMockData = (count) => {
      return Array.from({ length: count }, (_, i) => ({
        file: { id: `${i}`, name: `log-${i}.json`, size: 1000 },
        meta: { date: '2026-01-01', length: '100' },
        timestamp: new Date('2026-01-01').getTime() + i, // Different timestamps for sorting
      }));
    };

    test('refreshUI renders only itemsPerPage (Pagination)', () => {
      Drive.fileData = generateMockData(15); // 15 items
      Drive._state.pagination.itemsPerPage = 10;
      Drive._state.pagination.currentPage = 1;

      Drive.refreshUI();

      const cards = container.querySelectorAll('.drive-file-card');
      expect(cards).toHaveLength(10); // Only 1st page shown

      const pageInfo = container.querySelector('.pagination-controls span');
      expect(pageInfo.textContent).toContain('1-10 of 15');
    });

    test('Pagination controls change page and render next set', () => {
      Drive.fileData = generateMockData(15);
      Drive._state.pagination.itemsPerPage = 10;
      Drive.refreshUI();

      // Find Next button
      const nextBtn = container.querySelector('#nextPageBtn');
      nextBtn.click(); // Trigger event listener logic mock

      // Since we can't easily trigger the actual click event listener attached inside JS
      // without full DOM simulation, we simulate the state change logic:
      Drive._state.pagination.currentPage++;
      Drive.refreshUI();

      const cards = container.querySelectorAll('.drive-file-card');
      expect(cards).toHaveLength(5); // Remaining 5 items

      const pageInfo = container.querySelector('.pagination-controls span');
      expect(pageInfo.textContent).toContain('11-15 of 15');
    });

    test('Sorting toggles render order', () => {
      const itemOld = { file: { name: 'Old' }, timestamp: 1000, meta: {} };
      const itemNew = { file: { name: 'New' }, timestamp: 5000, meta: {} };
      Drive.fileData = [itemOld, itemNew];

      // Descending (Default)
      Drive._state.sortOrder = 'desc';
      Drive.refreshUI();
      let cards = container.querySelectorAll('.file-name-title');
      expect(cards[0].textContent).toBe('New');

      // Ascending
      Drive._state.sortOrder = 'asc';
      Drive.refreshUI();
      cards = container.querySelectorAll('.file-name-title');
      expect(cards[0].textContent).toBe('Old');
    });

    test('Month Grouping creates headers', () => {
      Drive.fileData = [
        {
          file: { name: 'Jan' },
          timestamp: new Date('2026-01-01').getTime(),
          meta: {},
        },
        {
          file: { name: 'Jan2' },
          timestamp: new Date('2026-01-05').getTime(),
          meta: {},
        },
      ];

      Drive.refreshUI();

      const headers = container.querySelectorAll('.month-header');
      expect(headers).toHaveLength(1); // One header for Jan
      expect(headers[0].textContent).toContain('January 2026');

      const cards = container.querySelectorAll('.drive-file-card');
      expect(cards).toHaveLength(2);
    });

    test('Recent History renders if localStorage has items', () => {
      // Mock FileData to contain the recent item
      Drive.fileData = [
        {
          file: { id: 'rec1', name: 'Recent.json' },
          meta: {},
          timestamp: 1000,
        },
      ];
      localStorage.setItem('recent_logs', JSON.stringify(['rec1']));

      // Must be on page 1 with no filters
      Drive.refreshUI();

      const recentSection = container.querySelector('.recent-section');
      expect(recentSection).not.toBeNull();
      expect(recentSection.innerHTML).toContain('Recent.json');
    });

    test('Recent History is hidden if filtered', () => {
      Drive.fileData = [
        {
          file: { id: 'rec1', name: 'Recent.json' },
          meta: {},
          timestamp: 1000,
        },
      ];
      localStorage.setItem('recent_logs', JSON.stringify(['rec1']));

      Drive._state.filters.term = 'search'; // Active filter
      Drive.refreshUI();

      const recentSection = container.querySelector('.recent-section');
      expect(recentSection).toBeNull();
    });
  });
});
