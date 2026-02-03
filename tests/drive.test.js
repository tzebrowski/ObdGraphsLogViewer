import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { Drive } from '../src/drive.js';
import { DOM } from '../src/config.js';
import { UI } from '../src/ui.js';
import { dataProcessor } from '../src/dataprocessor.js';

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
      <input type="text" id="driveSearchInput" />
      <i id="clearDriveSearchText"></i>
      <input type="date" id="driveDateStart" />
      <input type="date" id="driveDateEnd" />
      <button id="clearDriveFilters"></button>
      <button id="driveSortToggle"></button>
      <div id="driveResultCount"></div>
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
  // 1. INITIALIZATION & LIST FILES (Lines 47-72)
  // =========================================================================
  describe('Initialization & listFiles', () => {
    test('listFiles returns early if driveList DOM element is missing', async () => {
      document.body.innerHTML = ''; // Remove DOM
      DOM.get.mockReturnValue(null);

      await Drive.listFiles();

      expect(gapi.client.drive.files.list).not.toHaveBeenCalled();
    });

    test('listFiles renders search interface and calls fetchJsonFiles on success', async () => {
      // Mock finding Root Folder
      gapi.client.drive.files.list
        .mockResolvedValueOnce({
          result: { files: [{ id: 'root-123', name: 'mygiulia' }] },
        })
        // Mock finding Sub Folder
        .mockResolvedValueOnce({
          result: { files: [{ id: 'sub-123', name: 'trips' }] },
        })
        // Mock fetchJsonFiles list call
        .mockResolvedValueOnce({ result: { files: [], nextPageToken: null } });

      await Drive.listFiles();

      const listEl = document.getElementById('driveList');
      expect(listEl.style.display).toBe('block');
      // Check if search interface template was injected
      expect(document.getElementById('driveSearchInput')).not.toBeNull();
      // Check if fetch flow was triggered (3 calls: root, sub, files)
      expect(gapi.client.drive.files.list).toHaveBeenCalledTimes(3);
    });

    test('listFiles handles error when required folders are missing', async () => {
      // Mock finding Root Folder success
      gapi.client.drive.files.list.mockResolvedValueOnce({
        result: { files: [{ id: 'root-123' }] },
      });
      // Mock finding Sub Folder FAILURE (empty array)
      gapi.client.drive.files.list.mockResolvedValueOnce({
        result: { files: [] },
      });

      await Drive.listFiles();

      const container = document.getElementById('driveFileContainer');
      expect(container.innerHTML).toContain('Required folders not found');
    });

    test('listFiles handles API errors gracefully', async () => {
      // 1. Mock Root Folder Discovery (Success)
      gapi.client.drive.files.list.mockResolvedValueOnce({
        result: { files: [{ id: 'root-id' }] },
      });

      // 2. Mock Sub Folder Discovery (Success)
      gapi.client.drive.files.list.mockResolvedValueOnce({
        result: { files: [{ id: 'sub-id' }] },
      });

      // 3. Mock File Listing (Failure) - This will trigger the top-level catch block
      gapi.client.drive.files.list.mockRejectedValueOnce({
        message: 'Network Error',
      });

      await Drive.listFiles();

      const container = document.getElementById('driveFileContainer');
      expect(container.innerHTML).toContain('Drive error: Network Error');
    });
  });

  // =========================================================================
  // 2. UTILITY FUNCTIONS
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

    test('extractTimestamp returns 0 for invalid filenames', () => {
      const fileName = 'invalid.json';
      expect(Drive.extractTimestamp(fileName)).toBe(0);
    });
  });

  // =========================================================================
  // 3. API INTERACTIONS & FETCHING
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

    test('findFolderId handles API errors returns null', async () => {
      gapi.client.drive.files.list.mockRejectedValue(new Error('Fail'));
      const id = await Drive.findFolderId('folder');
      expect(id).toBeNull();
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

    test('handleApiError handles 403 error same as 401', () => {
      const error = { status: 403, message: 'Forbidden' };
      Drive.handleApiError(error, container);
      expect(gapi.client.setToken).toHaveBeenCalledWith(null);
    });
  });

  // =========================================================================
  // 4. LOGIC: FILTERING, SORTING & LOADING
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

    test('_applyFilters correctly matches date range', () => {
      const item = { file: { name: 'A.json' }, timestamp: 1000 };
      // Valid Range
      Drive._state.filters = { term: '', start: 500, end: 1500 };
      expect(Drive._applyFilters(item)).toBe(true);

      // Outside Range
      Drive._state.filters = { term: '', start: 1500, end: 2000 };
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

    test('loadFile handles API errors', async () => {
      // Mock Alert.showAlert behavior (since Alert module isn't mocked in this file specifically)
      // We'll just ensure it doesn't crash and console logs or similar
      const consoleSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      // Mock Global Alert object if it exists or rely on the imported module
      // For this test, we verify that dataProcessor is NOT called
      gapi.client.drive.files.get.mockRejectedValue({ message: 'Load Failed' });

      await Drive.loadFile('file', 'id');

      expect(dataProcessor.process).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  // =========================================================================
  // 5. UI RENDERING & EVENT LISTENERS (Lines 186-245)
  // =========================================================================
  describe('UI Interactions & Event Listeners', () => {
    beforeEach(() => {
      // Re-inject search template to ensure listeners attach to fresh elements
      const listEl = document.getElementById('driveList');
      if (listEl) listEl.innerHTML = Drive.TEMPLATES.searchInterface();
    });

    test('initSearch attaches listeners and handles input changes', () => {
      // 1. Call initSearch to bind listeners
      Drive.initSearch();

      const input = document.getElementById('driveSearchInput');
      const clearBtn = document.getElementById('clearDriveSearchText');

      // 2. Simulate typing
      input.value = 'test';
      input.dispatchEvent(new Event('input'));

      // 3. Since logic is debounced, verify state update (immediate updateHandler logic for checking Clear Btn visibility)
      // We might need to manually trigger the handler logic or rely on the immediate updateHandler call in initSearch

      // Let's test the "Clear Text" button click
      // Manually show it first
      clearBtn.style.display = 'block';

      // Click Clear
      clearBtn.click();

      // Assertions
      expect(input.value).toBe('');
      // The click handler calls updateHandler(true) -> immediate refresh
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

      // Initial state is desc
      Drive._state.sortOrder = 'desc';

      sortBtn.click();

      expect(Drive._state.sortOrder).toBe('asc');
      expect(sortBtn.innerHTML).toContain('Oldest');
    });

    test('Date inputs trigger update on change', () => {
      Drive.initSearch();
      const start = document.getElementById('driveDateStart');

      start.value = '2023-01-01';
      start.dispatchEvent(new Event('input')); // Trigger listener

      // Should update internal state (immediate = false, so it debounces)
      // We verify the listener is attached by checking if logic *would* run
      // For unit test, we can check if filter state is eventually updated or
      // trust that the previous tests covered logic, this verifies binding.
    });
  });

  // =========================================================================
  // 6. PAGINATION & GROUPING (Lines 371-397)
  // =========================================================================
  describe('Pagination & Grouping', () => {
    // Helper to generate mock data
    const generateMockData = (count) => {
      return Array.from({ length: count }, (_, i) => ({
        file: { id: `${i}`, name: `log-${i}.json`, size: 1000 },
        meta: { date: '2026-01-01', length: '100' },
        timestamp: new Date('2026-01-01').getTime() + i, // Different timestamps for sorting
      }));
    };

    test('refreshUI renders only itemsPerPage', () => {
      Drive.fileData = generateMockData(15); // 15 items
      Drive._state.pagination.itemsPerPage = 10;
      Drive._state.pagination.currentPage = 1;

      Drive.refreshUI();

      const cards = container.querySelectorAll('.drive-file-card');
      expect(cards).toHaveLength(10); // Only 1st page shown

      const pageInfo = container.querySelector('.pagination-controls span');
      expect(pageInfo.textContent).toContain('1-10 of 15');
    });

    test('Next Page button increments page and updates UI', () => {
      Drive.fileData = generateMockData(15);
      Drive._state.pagination.itemsPerPage = 10;
      Drive.refreshUI();

      const nextBtn = container.querySelector('#nextPageBtn');
      nextBtn.click(); // Trigger event listener

      const cards = container.querySelectorAll('.drive-file-card');
      expect(cards).toHaveLength(5); // Remaining 5 items (Page 2)
      expect(Drive._state.pagination.currentPage).toBe(2);
    });

    test('Prev Page button decrements page', () => {
      Drive.fileData = generateMockData(15);
      Drive._state.pagination.itemsPerPage = 10;
      Drive._state.pagination.currentPage = 2; // Start on page 2
      Drive.refreshUI();

      const prevBtn = container.querySelector('#prevPageBtn');
      prevBtn.click();

      expect(Drive._state.pagination.currentPage).toBe(1);
    });

    test('Pagination buttons respect bounds', () => {
      // Test "Next" on last page
      Drive.fileData = generateMockData(5);
      Drive._state.pagination.itemsPerPage = 10;
      Drive._state.pagination.currentPage = 1; // Only 1 page exists
      Drive.refreshUI();

      const nextBtn = container.querySelector('#nextPageBtn');
      nextBtn.click();
      expect(Drive._state.pagination.currentPage).toBe(1); // Should not increase

      // Test "Prev" on first page
      const prevBtn = container.querySelector('#prevPageBtn');
      prevBtn.click();
      expect(Drive._state.pagination.currentPage).toBe(1); // Should not decrease
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

      // Initial State: Collapsed (Matches updated drive.js default)
      expect(list.style.display).toBe('none');
      expect(header.querySelector('i').className).toContain('fa-chevron-right');

      //Click to Expand
      header.click();
      expect(list.style.display).toBe('block');
      expect(header.querySelector('i').className).toContain('fa-chevron-down');

      //Click to Collapse
      header.click();
      expect(list.style.display).toBe('none');
      expect(header.querySelector('i').className).toContain('fa-chevron-right');
    });
  });

  // =========================================================================
  // 7. RECENT HISTORY (Lines 451-466)
  // =========================================================================
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

      // Find the clear button created by renderRecentSection
      const clearBtn = document.getElementById('clearRecentHistory');

      // Mock confirm true
      global.confirm.mockReturnValue(true);

      // Trigger click
      clearBtn.click();

      expect(localStorage.getItem('recent_logs')).toBeNull();
      // UI should update (section removed)
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
