import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { Drive } from '../../src/drive.js';
import { dataProcessor } from '../../src/dataprocessor.js';

describe('Drive Module - Error Handling Tests', () => {
  let container;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="driveList"></div>
      <div id="driveFileContainer"></div>
    `;
    container = document.getElementById('driveFileContainer');
    localStorage.clear();
    jest.clearAllMocks();

    dataProcessor.process = jest.fn();

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

  test('handleApiError clears token on 401 error', () => {
    const error = { status: 401, message: 'Unauthorized' };
    Drive.handleApiError(error, container);

    expect(gapi.client.setToken).toHaveBeenCalledWith(null);
    expect(container.innerHTML).toContain('Session expired');
  });

  test('handleApiError displays generic error message', () => {
    const error = { status: 500, message: 'Internal Server Error' };
    Drive.handleApiError(error, container);

    expect(container.innerHTML).toContain('Drive error: Internal Server Error');
  });

  test('handleApiError sets expired session on 401 ', () => {
    const mockListEl = document.createElement('div');
    const error401 = { status: 401, message: 'Unauthorized' };

    Drive.handleApiError(error401, mockListEl);

    expect(gapi.client.setToken).toHaveBeenCalledWith(null);
    expect(mockListEl.innerHTML).toContain('Session expired');
  });
});
