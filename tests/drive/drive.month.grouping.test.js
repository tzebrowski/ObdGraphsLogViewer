import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { Drive } from '../../src/drive.js';
import { DOM } from '../../src/config.js';

global.gapi = {
  client: {
    drive: { files: { list: jest.fn(), get: jest.fn() } },
  },
};

describe('Drive Module - Month Grouping & Interactions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = `
      <div id="driveList"></div>
      <div id="driveFileContainer"></div>
      ${Drive.TEMPLATES.searchInterface()}
    `;
    DOM.get = jest.fn((id) => document.getElementById(id));

    // Reset state
    Drive._state.filters = { term: '', start: null, end: null };
    Drive._state.pagination.currentPage = 1;

    // Create Data Objects (mocking what fetchJsonFiles does)
    const item1 = {
      file: { id: '1', name: 'Log A', size: 1024 },
      meta: { date: '2026-01-10T10:00:00Z', length: 100 },
      timestamp: new Date('2026-01-10T10:00:00Z').getTime(),
    };

    const item2 = {
      file: { id: '2', name: 'Log B', size: 1024 },
      meta: { date: '2026-01-15T10:00:00Z', length: 100 },
      timestamp: new Date('2026-01-15T10:00:00Z').getTime(),
    };

    Drive.fileData = [item1, item2];
  });

  test('renderGroupedCards creates a single month header for same-month logs', () => {
    const container = document.getElementById('driveFileContainer');

    // Trigger render
    Drive.refreshUI();

    const headers = container.querySelectorAll('.month-header');
    const cards = container.querySelectorAll('.drive-file-card');

    // Should only have one "January 2026" header for both cards
    expect(headers).toHaveLength(1);
    expect(headers[0].textContent).toContain('January 2026');
    expect(cards).toHaveLength(2);
  });

  test('Clicking month header toggles the visibility of the card list', () => {
    Drive.refreshUI();
    const container = document.getElementById('driveFileContainer');
    const header = container.querySelector('.month-header');
    const list = container.querySelector('.month-list');

    // Initial state: visible (block or default)
    expect(list.style.display).not.toBe('none');

    // First Click: Collapse
    header.click();
    expect(list.style.display).toBe('none');
    expect(header.querySelector('.toggle-icon').className).toContain(
      'fa-chevron-right'
    );

    // Second Click: Expand
    header.click();
    expect(list.style.display).toBe('block');
    expect(header.querySelector('.toggle-icon').className).toContain(
      'fa-chevron-down'
    );
  });

  test('renderRecentSection handles missing fileData references gracefully', () => {
    const container = document.getElementById('driveFileContainer');

    // Set localStorage to an ID that doesn't exist in fileData
    localStorage.setItem('recent_logs', JSON.stringify(['missing-id']));
    Drive.fileData = []; // No data loaded

    Drive.renderRecentSection(container);

    // Only the header should exist or nothing if logical check prevents it
    // Logic: if recentItems.length === 0 return;
    const section = container.querySelector('.recent-section');
    expect(section).toBeNull();
  });
});
