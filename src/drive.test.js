import { jest, describe, test, expect, beforeEach } from '@jest/globals'; // Add this line
import { Drive } from './drive.js';

// Mocking global dependencies
global.gapi = {
  client: {
    drive: { files: { list: jest.fn(), get: jest.fn() } },
  },
};

describe('Drive Module Logic Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  /**
   * Tests the logic that extracts dates and lengths from filenames
   */
  test('getFileMetadata correctly parses valid filenames', () => {
    const fileName = 'trip-log-1704556800000-3600.json'; // Jan 6, 2024
    const meta = Drive.getFileMetadata(fileName);

    expect(meta).not.toBeNull();
    expect(meta.length).toBe('3600');
    expect(meta.date).toContain('2024-01-06T16:00:00.000Z');
  });

  test('getFileMetadata returns null for invalid filenames', () => {
    const fileName = 'invalid-file.json';
    expect(Drive.getFileMetadata(fileName)).toBeNull();
  });

  test('parseDateFromCard extracts timestamp correctly from DOM element', () => {
    const mockCard = document.createElement('div');
    mockCard.innerHTML =
      '<div class="meta-item"><span>2025-12-27T12:53:57.973Z</span></div>';
    document.body.appendChild(mockCard);

    const timestamp = Drive.parseDateFromCard(mockCard);

    expect(timestamp).toBe(1766840037973);

    const date = new Date(timestamp);
    expect(date.getFullYear()).toBe(2025);
    expect(date.getMonth()).toBe(11);
    expect(date.getDate()).toBe(27);
  });

  /**
   * Tests the Recently Viewed logic
   */
  test('loadFile updates localStorage history', async () => {
    const fileId = 'test-123';
    const fileName = 'trip.json';
    const mockElement = document.createElement('div');

    // Mock successful API response
    gapi.client.drive.files.get.mockResolvedValue({ result: {} });

    await Drive.loadFile(fileName, fileId, mockElement);

    const recent = JSON.parse(localStorage.getItem('recent_logs'));
    expect(recent).toContain(fileId);
    expect(recent.length).toBeLessThanOrEqual(3);
  });

  test('clearRecentHistory wipes localStorage', () => {
    localStorage.setItem('recent_logs', JSON.stringify(['id1', 'id2']));

    // Mocking window.confirm to always return true
    global.confirm = jest.fn(() => true);

    Drive.clearRecentHistory();
    expect(localStorage.getItem('recent_logs')).toBeNull();
  });
});
