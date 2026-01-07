import { jest, describe, test, expect, beforeEach } from '@jest/globals'; // Add this line
import { Drive } from '../src/drive.js';
import { DOM } from '../src/config.js';

// Mocking global dependencies
global.gapi = {
  client: {
    drive: { files: { list: jest.fn(), get: jest.fn() } },
  },
};

describe('Drive Module - UI Filtering Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    document.body.innerHTML = `
      <div id="driveList"></div>
      ${Drive.getSearchInterfaceTemplate()}
    `;

    DOM.get = jest.fn((id) => document.getElementById(id));

    const card1 = document.createElement('div');
    card1.className = 'drive-file-card';
    card1.innerHTML = `
      <div class="file-name-title">engine_log_warmup</div>
      <div class="meta-item"><span>2026-01-01T10:00:00.000Z</span></div>
    `;

    const card2 = document.createElement('div');
    card2.className = 'drive-file-card';
    card2.innerHTML = `
      <div class="file-name-title">track_session_fast</div>
      <div class="meta-item"><span>2026-01-05T14:00:00.000Z</span></div>
    `;

    Drive.masterCards = [card1, card2];
  });

  test('Internal updateUI filters cards by text input', () => {
    Drive.initSearch();

    const searchInput = document.getElementById('driveSearchInput');

    // Simulate user typing "track"
    searchInput.value = 'track';
    searchInput.dispatchEvent(new Event('input'));

    // Verify Visibility
    expect(
      Drive.masterCards[0].querySelector('.file-name-title').textContent
    ).toBe('track_session_fast');
    expect(Drive.masterCards[0].style.display).toBe('flex');

    expect(
      Drive.masterCards[1].querySelector('.file-name-title').textContent
    ).toBe('engine_log_warmup');
    expect(Drive.masterCards[1].style.display).toBe('none');

    const countEl = document.getElementById('driveResultCount');
    expect(countEl.innerText).toContain('Showing 1 of 2');
  });

  test('Internal updateUI filters by Date Range', () => {
    Drive.initSearch();

    const startInput = document.getElementById('driveDateStart');
    const endInput = document.getElementById('driveDateEnd');

    // Filter to only show the first log (Jan 1st)
    startInput.value = '2026-01-01';
    endInput.value = '2026-01-02';

    // Trigger the internal updateUI
    startInput.dispatchEvent(new Event('input'));

    expect(
      Drive.masterCards[0].querySelector('.file-name-title').textContent
    ).toBe('track_session_fast');
    expect(Drive.masterCards[0].style.display).toBe('none'); // track_session_fast

    expect(
      Drive.masterCards[1].querySelector('.file-name-title').textContent
    ).toBe('engine_log_warmup');
    expect(Drive.masterCards[1].style.display).toBe('flex'); // engine_log_warmup
  });

  test('Clear search button resets visibility', () => {
    Drive.initSearch();
    const searchInput = document.getElementById('driveSearchInput');
    const clearBtn = document.getElementById('clearDriveSearchText');

    searchInput.value = 'nonexistent';
    searchInput.dispatchEvent(new Event('input'));
    expect(Drive.masterCards[0].style.display).toBe('none');

    // Click the clear "X" button
    clearBtn.click();

    expect(searchInput.value).toBe('');
    expect(Drive.masterCards[0].style.display).toBe('flex');
  });
});

describe('Drive Module - Sorting & Filtering', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    document.body.innerHTML = `
      <div id="driveList"></div>
      ${Drive.getSearchInterfaceTemplate()}
    `;

    DOM.get.mockImplementation((id) => document.getElementById(id));

    // Create cards with specific dates to test chronological sorting
    const cardOld = document.createElement('div');
    cardOld.className = 'drive-file-card';
    cardOld.innerHTML = `
      <div class="file-name-title">Old Log</div>
      <div class="meta-item"><span>2025-01-01T10:00:00Z</span></div>
    `;

    const cardNew = document.createElement('div');
    cardNew.className = 'drive-file-card';
    cardNew.innerHTML = `
      <div class="file-name-title">New Log</div>
      <div class="meta-item"><span>2026-01-01T10:00:00Z</span></div>
    `;

    // Master list order doesn't matter; updateUI will re-sort them
    Drive.masterCards = [cardOld, cardNew];
  });

  test('updateUI() sorts cards in descending order (Newest First)', () => {
    Drive.initSearch(); // Triggers initial updateUI()

    const container = document.getElementById('driveFileContainer');
    const renderedCards = container.querySelectorAll('.drive-file-card');

    // In 'desc' mode, "New Log" (2026) must appear before "Old Log" (2025)
    expect(renderedCards[0].querySelector('.file-name-title').textContent).toBe(
      'New Log'
    );
    expect(renderedCards[1].querySelector('.file-name-title').textContent).toBe(
      'Old Log'
    );
  });

  test('Toggling sort button reverses card order', () => {
    Drive.initSearch();
    const sortBtn = document.getElementById('driveSortToggle');

    // Click to change from 'desc' to 'asc'
    sortBtn.click();

    const container = document.getElementById('driveFileContainer');
    const renderedCards = container.querySelectorAll('.drive-file-card');

    // In 'asc' mode, "Old Log" (2025) must appear first
    expect(renderedCards[0].querySelector('.file-name-title').textContent).toBe(
      'Old Log'
    );
    expect(renderedCards[1].querySelector('.file-name-title').textContent).toBe(
      'New Log'
    );
  });
});
