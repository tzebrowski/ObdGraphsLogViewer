import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { UI, InfoPage } from '../../src/ui.js';
import { AppState } from '../../src/config.js';
import { Preferences } from '../../src/preferences.js';

Preferences.savePreferences = jest.fn();
Preferences.customPalette = jest.fn();

describe('UI Module Expanded Tests', () => {
  beforeEach(() => {
    // Comprehensive DOM setup for all UI features
    document.body.innerHTML = `
      <div id="sidebar" class="sidebar">
        <div class="control-group">
          <h3 class="group-header">Section 1</h3>
          <div id="item1"></div>
        </div>
      </div>
      <div id="resizer"></div>
      <div id="chartContainer"></div>
      <div id="mainContent"></div>
      <div id="signalList"></div>
      <div id="appVersion"></div>
      <div id="infoModal" style="display: none;">
        <button id="closeInfoBtn"></button>
        <button id="showInfoBtn"></button>
        <input type="checkbox" id="hideInfoCheckbox" />
      </div>
      <div id="loadingOverlay"><span id="loadingText"></span><button id="cancelLoadBtn"></button></div>
    `;

    // Reset AppState
    AppState.chartInstances = [];
    AppState.version = {
      tag: 'v1.0.0',
      repoUrl: 'https://github.com/test/repo',
    };

    // Mock localStorage
    const store = {};
    global.localStorage = {
      getItem: jest.fn((key) => store[key] || null),
      setItem: jest.fn((key, val) => {
        store[key] = val.toString();
      }),
      removeItem: jest.fn((key) => {
        delete store[key];
      }),
      clear: jest.fn(() => {
        for (let k in store) delete store[k];
      }),
    };

    // Robust LocalStorage Mocking
    const localStorageMock = (function () {
      let store = {};
      return {
        getItem: jest.fn((key) => store[key] || null),
        setItem: jest.fn((key, value) => {
          store[key] = value.toString();
        }),
        removeItem: jest.fn((key) => {
          delete store[key];
        }),
        clear: jest.fn(() => {
          store = {};
        }),
      };
    })();

    // Use defineProperty to bypass JSDOM read-only restrictions
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });

    jest.clearAllMocks();
  });

  /** 1. Test Sidebar Collapse & Persistence  **/
  test('initSidebarSectionsCollapse toggles class and saves state', () => {
    UI.initSidebarSectionsCollapse();
    const header = document.querySelector('.group-header');
    const group = document.querySelector('.control-group');

    // Simulate click on header
    header.click();
    expect(group.classList.contains('collapsed')).toBe(true);
    expect(localStorage.setItem).toHaveBeenCalledWith(
      UI.STORAGE_KEY,
      expect.any(String)
    );

    // Toggle back
    header.click();
    expect(group.classList.contains('collapsed')).toBe(false);
  });

  test('restoreSidebarState applies saved classes', () => {
    localStorage.setItem(UI.STORAGE_KEY, JSON.stringify([true]));
    UI.restoreSidebarState();
    const group = document.querySelector('.control-group');
    expect(group.classList.contains('collapsed')).toBe(true);
  });

  /** 2. Test Mobile UI & Backdrops **/
  test('initMobileUI creates backdrop and handles clicks', () => {
    UI.initMobileUI();
    const backdrop = document.querySelector('.sidebar-backdrop');
    expect(backdrop).toBeTruthy();

    const sidebar = document.getElementById('sidebar');
    sidebar.classList.add('active');
    backdrop.classList.add('active');

    backdrop.click();
    expect(sidebar.classList.contains('active')).toBe(false);
    expect(backdrop.classList.contains('active')).toBe(false);
  });

  /** 3. Test Theme Switching **/
  test('setTheme updates body class and chart instances', () => {
    const mockChart = {
      options: {
        scales: {
          x: { ticks: { color: '' }, grid: { color: '' } },
          y: { ticks: { color: '' }, grid: { color: '' } },
        },
        plugins: { legend: { labels: { color: '' } } },
      },
      update: jest.fn(),
    };
    AppState.chartInstances = [mockChart];

    UI.setTheme('dark');
    expect(document.body.classList.contains('dark-theme')).toBe(true);
    expect(mockChart.options.scales.x.ticks.color).toBe('#F8F9FA');
    expect(mockChart.update).toHaveBeenCalled();
  });

  /** 4. Test Version Info **/
  test('initVersionInfo renders dev tag correctly', () => {
    AppState.version.tag = 'dev';
    UI.initVersionInfo();
    expect(document.getElementById('appVersion').innerText).toBe(
      'v.development'
    );
  });

  test('initVersionInfo renders release link correctly', () => {
    AppState.version.tag = 'v2.1.0';
    UI.initVersionInfo();

    const link = document.querySelector('#appVersion a');
    expect(link.getAttribute('href')).toContain('v2.1.0');

    // Change .innerText to .textContent
    expect(link.textContent.trim()).toBe('v2.1.0');
  });

  /** 5. Test InfoPage Logic **/
  test('InfoPage open/close/toggle visibility', () => {
    const modal = document.getElementById('infoModal');

    InfoPage.open();
    expect(modal.style.display).toBe('flex');

    InfoPage.close();
    expect(modal.style.display).toBe('none');

    InfoPage.toggleInfo();
    expect(modal.style.display).toBe('flex');
  });

  test('InfoPage init handles "Hide Forever" preference', () => {
    const hideCheckbox = document.getElementById('hideInfoCheckbox');
    const closeBtn = document.getElementById('closeInfoBtn');

    Object.defineProperty(Preferences, 'prefs', {
      get: jest.fn(() => ({ useCustomPalette: true })),
      configurable: true, // allows us to change it again in other tests
    });

    InfoPage.init();

    // Simulate checking "Don't show again" and closing
    hideCheckbox.checked = true;
    closeBtn.click();

    expect(localStorage.setItem).toHaveBeenCalledWith(
      InfoPage.STORAGE_KEY,
      'true'
    );
    expect(document.getElementById('infoModal').style.display).toBe('none');
  });

  /** 6. Test FullScreen Toggle **/
  test('toggleFullScreen attempts to request fullscreen', () => {
    const content = document.getElementById('mainContent');
    content.requestFullscreen = jest.fn().mockResolvedValue();

    UI.toggleFullScreen();
    expect(content.requestFullscreen).toHaveBeenCalled();
  });
});
