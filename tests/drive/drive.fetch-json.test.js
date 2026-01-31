import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { Drive } from '../../src/drive.js';
import { DOM } from '../../src/config.js';
import { UI } from '../../src/ui.js';

describe('Drive Module - Fetch JSON Test', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // fetchJsonFiles looks for this specific ID internally now
    document.body.innerHTML = `
      <div id="driveList"></div>
      <div id="driveFileContainer"></div>
    `;
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

  test('fetchJsonFiles populates fileData and renders rows', async () => {
    // 1. Setup the mock files response
    const mockFiles = [
      { id: 'f1', name: 'trip-2026-1766840037973-3600.json', size: '2048' },
    ];

    // Mock list to return files and no nextPageToken (single page)
    global.gapi.client.drive.files.list.mockResolvedValue({
      result: { files: mockFiles, nextPageToken: null },
    });

    const container = document.getElementById('driveFileContainer');

    // 2. Execute fetch (passed argument is ignored in new impl, it uses ID)
    await Drive.fetchJsonFiles('folder-id');

    // 3. Assertions
    // Verify fileData was captured (replacement for masterCards)
    expect(Drive.fileData).toHaveLength(1);
    expect(Drive.fileData[0].file.id).toBe('f1');

    // Verify the UI rendered
    expect(container.innerHTML).toContain('trip-2026');
    expect(container.innerHTML).toContain('2 KB');
  });

  test('fetchJsonFiles handles API rejection', async () => {
    gapi.client.drive.files.list.mockRejectedValue({ message: 'API Down' });
    const container = document.getElementById('driveFileContainer');

    await Drive.fetchJsonFiles('id');

    expect(container.innerHTML).toContain('Drive error: API Down');
  });

  test('fetchJsonFiles handles empty results', async () => {
    gapi.client.drive.files.list.mockResolvedValue({ result: { files: [] } });
    const container = document.getElementById('driveFileContainer');

    await Drive.fetchJsonFiles('id');

    expect(container.innerHTML).toContain('No log files found.');
  });
});
