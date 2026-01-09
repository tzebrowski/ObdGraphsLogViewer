import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { Drive } from '../../src/drive.js';
import { DOM } from '../../src/config.js';
import { UI } from '../../src/ui.js';

describe('Drive Module - Fetch JSON Test', () => {
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

  test('fetchJsonFiles populates masterCards and renders rows', async () => {
    // 1. Setup the mock files response
    const mockFiles = [
      { id: 'f1', name: 'trip-2026-1766840037973-3600.json', size: '2048' },
    ];

    global.gapi.client.drive.files.list.mockResolvedValue({
      result: { files: mockFiles },
    });

    // 2. Setup DOM with the search interface template
    // This provides the elements that initSearch() needs to add listeners to
    document.body.innerHTML = `
    <div id="driveList">
      ${Drive.TEMPLATES.searchInterface()}
    </div>
  `;

    const container = document.getElementById('driveFileContainer');

    // 3. Execute fetch
    await Drive.fetchJsonFiles('folder-id', container);

    // 4. Assertions
    // Verify masterCards were captured
    expect(Drive.masterCards).toHaveLength(1);

    // Verify the filename and size rendering logic
    expect(container.innerHTML).toContain('trip-2026');
    expect(container.innerHTML).toContain('2 KB'); // (2048 / 1024)
  });

  test('fetchJsonFiles handles API rejection', async () => {
    gapi.client.drive.files.list.mockRejectedValue({ message: 'API Down' });
    const container = document.createElement('div');

    await Drive.fetchJsonFiles('id', container);

    expect(container.innerHTML).toContain('Drive error: API Down');
  });

  test('fetchJsonFiles handles empty results', async () => {
    gapi.client.drive.files.list.mockResolvedValue({ result: { files: [] } });
    const container = document.createElement('div');

    await Drive.fetchJsonFiles('id', container);

    expect(container.innerHTML).toContain('No log files found.');
  });
});
