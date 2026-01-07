import { jest, describe, test, expect, beforeEach } from '@jest/globals'; // Add this line
import { Drive } from '../src/drive.js';
import { DOM } from '../src/config.js';

// Mocking global dependencies
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
      ${Drive.getSearchInterfaceTemplate()}
    `;
    DOM.get = jest.fn((id) => document.getElementById(id));

    // Create two cards in the same month
    const card1 = document.createElement('div');
    card1.className = 'drive-file-card';
    card1.innerHTML = `<div class="file-name-title">Log A</div><div class="meta-item"><span>2026-01-10T10:00:00Z</span></div>`;

    const card2 = document.createElement('div');
    card2.className = 'drive-file-card';
    card2.innerHTML = `<div class="file-name-title">Log B</div><div class="meta-item"><span>2026-01-15T10:00:00Z</span></div>`;

    Drive.masterCards = [card1, card2];
  });

  test('renderGroupedCards creates a single month header for same-month logs', () => {
    const container = document.getElementById('driveFileContainer');
    Drive.initSearch(); // Triggers the render sequence

    const headers = container.querySelectorAll('.month-header');
    const cards = container.querySelectorAll('.drive-file-card');

    // Should only have one "January 2026" header for both cards
    expect(headers).toHaveLength(1);
    expect(headers[0].textContent).toContain('January 2026');
    expect(cards).toHaveLength(2);
  });

  test('Clicking month header toggles the visibility of the card list', () => {
    Drive.initSearch();
    const container = document.getElementById('driveFileContainer');
    const header = container.querySelector('.month-header');
    const list = container.querySelector('.month-list');

    // Initial state: visible
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
});
