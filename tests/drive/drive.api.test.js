import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { Drive } from '../../src/drive.js';
import { DOM } from '../../src/config.js';
import { UI } from '../../src/ui.js';

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
