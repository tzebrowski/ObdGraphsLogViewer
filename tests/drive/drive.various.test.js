import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { Drive } from '../../src/drive.js';
import { DataProcessor } from '../../src/dataprocesssor.js';

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

  test('renderRecentSection handles missing card references gracefully', () => {
    localStorage.setItem('recent_logs', JSON.stringify(['missing-id']));
    Drive.masterCards = []; // No cards loaded to simulate a mismatch

    Drive.renderRecentSection(container);

    // Target the specific DIV created for the list, not the header
    const recentList =
      container.querySelector('.recent-section').lastElementChild;

    // This will now correctly be 0 because no matching cards were found to append
    expect(recentList.children.length).toBe(0);
  });
});
