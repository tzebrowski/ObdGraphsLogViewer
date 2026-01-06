import { AppState, DOM, DEFAULT_SIGNALS } from './config.js';
import { DataProcessor } from './dataprocesssor.js';
import { Preferences } from './preferences.js';
import { Alert } from './alert.js';
import { PaletteManager } from './palettemanager.js';
import { ChartManager } from './chartmanager.js';

export const UI = {
  STORAGE_KEY: 'sidebar_collapsed_states',

  init() {
    UI.initResizer();
    UI.initVersionInfo();
    UI.initSidebarSectionsCollapse();
    UI.initMobileUI();
  },

  get elements() {
    return {
      resizer: document.getElementById('resizer'),
      sidebar: document.getElementById('sidebar'),
      loadingOverlay: document.getElementById('loadingOverlay'),
      loadingText: document.getElementById('loadingText'),
      cancelBtn: document.getElementById('cancelLoadBtn'),
      signalList: document.getElementById('signalList'),
      mainContent: document.getElementById('mainContent'),
      scanResults: document.getElementById('scanResults'),
      scanCount: document.getElementById('scanCount'),
    };
  },

  updateDataLoadedState: (hasData) => {
    const container = document.getElementById('chartContainer');
    if (hasData) {
      container.classList.add('has-data');
    } else {
      container.classList.remove('has-data');
    }
  },

  toggleItem(i) {
    const p = DOM.get(i);
    if (!p) return;

    const isHidden = p.style.display === 'none' || p.style.display === '';
    p.style.display = isHidden ? 'block' : 'none';

    if (AppState.chartInstance) AppState.chartInstance.resize();
  },

  initSidebarSectionsCollapse() {
    UI.restoreSidebarState();
    UI.elements.sidebar.addEventListener('click', (e) => {
      const header =
        e.target.closest('h3') ||
        e.target.closest('.group-header') ||
        e.target.closest('.group-header-row');

      if (header) {
        const group = header.closest('.control-group');

        if (group) {
          if (
            e.target.tagName === 'BUTTON' ||
            e.target.classList.contains('config-link')
          ) {
            return;
          }

          group.classList.toggle('collapsed');
          const prefs = Preferences.prefs;
          if (prefs?.persistence) {
            UI.saveSidebarState();
          }
        }
      }
    });
  },

  initMobileUI: () => {
    const sidebar = UI.elements.sidebar;

    const backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', () => {
      sidebar.classList.remove('active');
      backdrop.classList.remove('active');
    });
  },

  initResizer() {
    const resizer = UI.elements.resizer;
    const sidebar = UI.elements.sidebar;
    let isResizing = false;

    if (!resizer || !sidebar) return;

    resizer.addEventListener('mousedown', () => {
      isResizing = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;

      let newWidth = e.clientX;

      if (newWidth >= 250 && newWidth <= 600) {
        sidebar.style.width = `${newWidth}px`;

        if (AppState.chartInstance) {
          AppState.chartInstance.resize();
        }
      }
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
      }
    });
  },

  saveSidebarState: () => {
    const groups = document.querySelectorAll('.sidebar .control-group');
    const states = Array.from(groups).map((group) =>
      group.classList.contains('collapsed')
    );
    localStorage.setItem(UI.STORAGE_KEY, JSON.stringify(states));
  },

  restoreSidebarState: () => {
    const savedData = localStorage.getItem(UI.STORAGE_KEY);
    if (!savedData) return;

    try {
      const states = JSON.parse(savedData);
      const groups = document.querySelectorAll('.sidebar .control-group');
      groups.forEach((group, index) => {
        if (states[index] === true) {
          group.classList.add('collapsed');
        }
      });
    } catch (e) {
      console.error('Could not restore sidebar state', e);
    }
  },

  setLoading(isLoading, text = 'Loading...', onCancel = null) {
    const { loadingOverlay, loadingText, cancelBtn } = this.elements;
    if (!loadingOverlay || !loadingText) return;

    loadingText.innerText = text;
    loadingOverlay.style.display = isLoading ? 'flex' : 'none';

    if (isLoading && onCancel) {
      cancelBtn.style.display = 'inline-block';
      cancelBtn.onclick = onCancel;
    } else {
      cancelBtn.style.display = 'none';
    }
  },

  resetScannerUI() {
    AppState.activeHighlight = null;
    this.elements.scanResults.innerHTML = '';
    this.elements.scanResults.style.display = 'none';
    this.elements.scanCount.innerText = '';
  },

  toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.querySelector('.sidebar-backdrop');

    if (window.innerWidth <= 768) {
      sidebar.classList.toggle('active');
      backdrop.classList.toggle('active');
    } else {
      sidebar.classList.toggle('collapsed');
    }
  },

  toggleFullScreen() {
    const content = UI.elements.mainContent;
    if (!content) return;

    if (!document.fullscreenElement) {
      content.requestFullscreen().catch((err) => {
        console.error(
          `Error attempting to enable full-screen mode: ${err.message}`
        );
      });
    } else {
      document.exitFullscreen();
    }
  },
  toggleFileSignals(fileIdx, shouldCheck) {
    const inputs = UI.elements.signalList.querySelectorAll(
      `input[data-file-idx="${fileIdx}"]`
    );
    inputs.forEach((i) => (i.checked = shouldCheck));

    const chart = AppState.chartInstances[fileIdx];
    if (chart) {
      chart.data.datasets.forEach((ds) => (ds.hidden = !shouldCheck));
      chart.update('none');
    }
  },

  renderSignalList() {
    const container = UI.elements.signalList;
    if (!container) return;

    const isCustomEnabled = Preferences.prefs.useCustomPalette;

    container.innerHTML = `
    <div class="signal-search-wrapper" style="position: sticky; top: 0; background: var(--card-bg); z-index: 10; padding: 10px 5px; border-bottom: 1px solid var(--border-color);">
      <div style="position: relative; display: flex; align-items: center;">
        <i class="fas fa-search" style="position: absolute; left: 10px; color: var(--text-muted); font-size: 0.9em;"></i>
        <input type="text" id="signalSearchInput" placeholder="Search signals..." 
               style="width: 100%; padding: 8px 30px; border-radius: 6px; border: 1px solid var(--border-color); font-size: 0.9em; box-sizing: border-box;">
        <i class="fas fa-times-circle" id="clearSignalSearch" 
           style="position: absolute; right: 10px; color: var(--text-muted); cursor: pointer; display: none;" 
           title="Clear filter" onclick="clearSignalFilter()"></i>
      </div>
    </div>
    <div id="signalListContent"></div>
  `;

    const contentContainer = document.getElementById('signalListContent');
    const fragment = document.createDocumentFragment();

    AppState.files.forEach((file, fileIdx) => {
      const fileGroup = document.createElement('div');
      fileGroup.className = 'file-group-container';

      const fileHeader = document.createElement('div');
      fileHeader.className = 'file-meta-header';
      fileHeader.style.cssText = `padding: 8px 5px; font-weight: bold; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; cursor: pointer; background: var(--sidebar-bg);`;

      fileHeader.innerHTML = `
      <span style="display: flex; align-items: center; gap: 8px;">
        <i class="fas fa-trash-alt" style="color: var(--brand-red); cursor: pointer;" title="Remove log" onclick="event.stopPropagation(); removeFile(${fileIdx})"></i>
        <i class="fas fa-chevron-down toggle-icon" id="icon-f${fileIdx}"></i>
        <i class="fas fa-file-alt"></i> ${file.name}
      </span>
      <div class="button-row-sm" style="display: flex; gap: 4px;">
        <button class="btn btn-sm" onclick="event.stopPropagation(); UI.toggleFileSignals(${fileIdx}, true)">All</button>
        <button class="btn btn-sm" onclick="event.stopPropagation(); UI.toggleFileSignals(${fileIdx}, false)">None</button>
      </div>
    `;

      const signalListContainer = document.createElement('div');
      signalListContainer.id = `sig-list-f${fileIdx}`;
      signalListContainer.style.paddingLeft = '10px';

      fileHeader.onclick = () => {
        const isHidden = signalListContainer.style.display === 'none';
        signalListContainer.style.display = isHidden ? 'block' : 'none';
        document.getElementById(`icon-f${fileIdx}`).className = isHidden
          ? 'fas fa-chevron-down'
          : 'fas fa-chevron-right';
      };

      file.availableSignals.forEach((signal, sigIdx) => {
        const isImportant = DEFAULT_SIGNALS.some((k) => signal.includes(k));
        const color = PaletteManager.getColorForSignal(fileIdx, sigIdx);
        const signalKey = PaletteManager.getSignalKey(file.name, signal);

        const signalItem = document.createElement('div');
        signalItem.className = 'signal-item';
        signalItem.setAttribute('data-signal-name', signal.toLowerCase());
        signalItem.style.cssText =
          'display: flex; align-items: center; gap: 8px; padding: 2px 5px;';

        const uniqueId = `chk-f${fileIdx}-s${sigIdx}`;

        // Color picker styling
        const pickerStyle = `width: 18px; height: 18px; border: none; padding: 0; background: none; cursor: ${isCustomEnabled ? 'pointer' : 'default'}; opacity: ${isCustomEnabled ? '1' : '0.4'};`;

        signalItem.innerHTML = `
          <input type="color" value="${color}" class="signal-color-picker" 
                 style="${pickerStyle}" ${isCustomEnabled ? '' : 'disabled'}
                 data-signal-key="${signalKey}">
          <input type="checkbox" id="${uniqueId}" data-key="${signal}" data-file-idx="${fileIdx}" ${isImportant ? 'checked' : ''}>
          <label for="${uniqueId}" style="font-size: 0.85em; flex-grow: 1; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${signal}</label>
      `;

        const picker = signalItem.querySelector('.signal-color-picker');
        picker.onchange = (e) => {
          const customMap = Preferences.customPalette;
          customMap[signalKey] = e.target.value;
          Preferences.customPalette = customMap;
          if (typeof ChartManager !== 'undefined') ChartManager.render();
        };

        signalListContainer.appendChild(signalItem);
      });

      fileGroup.appendChild(fileHeader);
      fileGroup.appendChild(signalListContainer);
      fragment.appendChild(fileGroup);
    });

    contentContainer.appendChild(fragment);

    const searchInput = document.getElementById('signalSearchInput');
    const clearBtn = document.getElementById('clearSignalSearch');

    searchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase().trim();
      clearBtn.style.display = term.length > 0 ? 'block' : 'none';

      const groups = contentContainer.querySelectorAll('.file-group-container');
      groups.forEach((group) => {
        let matchCount = 0;
        const items = group.querySelectorAll('.signal-item');

        items.forEach((item) => {
          const attr = item.getAttribute('data-signal-name');
          // FIX: Added safety check for null attribute
          const isMatch = attr && attr.includes(term);
          item.style.display = isMatch ? 'flex' : 'none';
          if (isMatch) matchCount++;
        });

        group.style.display = matchCount > 0 ? 'block' : 'none';
        const sigList = group.querySelector('[id^="sig-list-f"]');
        if (term.length > 0 && matchCount > 0 && sigList)
          sigList.style.display = 'block';
      });
    });

    container.onchange = (e) => {
      if (e.target.tagName === 'INPUT' && e.target.type === 'checkbox') {
        const key = e.target.getAttribute('data-key');
        const fileIdx = parseInt(e.target.getAttribute('data-file-idx'));
        this.syncSignalVisibility(key, e.target.checked, fileIdx);
      }
    };
  },

  clearSignalFilter() {
    const searchInput = document.getElementById('signalSearchInput');
    if (searchInput) {
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input'));
    }
  },

  syncSignalVisibility(key, isVisible, fileIdx) {
    const chart = AppState.chartInstances[fileIdx];
    if (chart) {
      const dataset = chart.data.datasets.find((d) => d.label === key);
      if (dataset) {
        dataset.hidden = !isVisible;
        chart.update('none');
      }
    }
  },

  toggleAllSignals(shouldCheck) {
    const container = UI.elements.signalList;
    if (!container) return;

    container
      .querySelectorAll('input')
      .forEach((i) => (i.checked = shouldCheck));

    AppState.chartInstances.forEach((chart) => {
      chart.data.datasets.forEach((ds) => (ds.hidden = !shouldCheck));
      chart.update('none');
    });
  },

  loadSampleData: async (showInfo) => {
    const sampleUrl =
      'https://raw.githubusercontent.com/tzebrowski/ObdGraphsLogViewer/main/resources/trip-profile_5-1766517188873-589.json';

    try {
      const btn = document.querySelector('.btn-sample');
      const originalText = btn.innerText;
      btn.innerText = '⌛ Downloading & Analyzing...';
      btn.disabled = true;

      const response = await fetch(sampleUrl);
      if (!response.ok) throw new Error('Network response was not ok');
      const data = await response.json();

      DataProcessor.process(data, 'sample-trip-giulia.json');

      if (showInfo) {
        InfoPage.toggleInfo();
      }

      btn.innerText = originalText;
      btn.disabled = false;
    } catch (error) {
      console.error('Error:', error);
      Alert.showAlert('Failed to load sample data.');
      const btn = document.querySelector('.btn-sample');
      btn.innerText = '📂 Load Sample Trip (JSON)';
      btn.disabled = false;
    }
  },

  setTheme: (theme) => {
    const isDark = theme === 'dark';
    const textColor = isDark ? '#F8F9FA' : '#333333';
    const gridColor = isDark
      ? 'rgba(255, 255, 255, 0.1)'
      : 'rgba(0, 0, 0, 0.1)';

    document.body.classList.toggle('dark-theme', isDark);

    document
      .getElementById('btn-theme-light')
      ?.classList.toggle('active', !isDark);
    document
      .getElementById('btn-theme-dark')
      ?.classList.toggle('active', isDark);

    AppState.chartInstances.forEach((chart) => {
      chart.options.scales.x.ticks.color = textColor;
      chart.options.scales.y.ticks.color = textColor;
      chart.options.scales.x.grid.color = gridColor;
      chart.options.scales.y.grid.color = gridColor;
      chart.options.plugins.legend.labels.color = textColor;
      chart.update('none');
    });

    document.querySelectorAll('#signalList label').forEach((el) => {
      el.style.color = textColor;
    });
  },

  initVersionInfo() {
    const container = DOM.get('appVersion');
    if (!container) return;

    const { tag, repoUrl } = AppState.version;

    if (tag === 'dev') {
      container.innerText = 'v.development';
      return;
    }

    const tagHtml = tag
      ? `<a href="${repoUrl}/releases/tag/${tag}" 
              target="_blank" 
              class="version-badge-tag"
              title="View release notes for ${tag}">
              ${tag}
           </a>`
      : '';

    container.innerHTML = `
            <div class="version-container">
                ${tagHtml}
            </div>
        `;
  },
};

export const InfoPage = {
  STORAGE_KEY: 'hide_info_page',

  init: () => {
    const hideCheckbox = DOM.get('hideInfoCheckbox');
    const closeBtn = DOM.get('closeInfoBtn');
    const showBtn = DOM.get('showInfoBtn');

    if (showBtn) {
      showBtn.addEventListener('click', () => {
        if (hideCheckbox) hideCheckbox.checked = false;
        InfoPage.open();
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (hideCheckbox && hideCheckbox.checked) {
          localStorage.setItem(InfoPage.STORAGE_KEY, 'true');
        } else {
          localStorage.removeItem(InfoPage.STORAGE_KEY);
        }
        InfoPage.close();
      });
    }

    const userPrefersHide =
      localStorage.getItem(InfoPage.STORAGE_KEY) === 'true';
    if (!userPrefersHide) {
      InfoPage.open();
    }
  },

  open: () => {
    const modal = DOM.get('infoModal');
    if (modal) modal.style.display = 'flex';
  },

  close: () => {
    const modal = DOM.get('infoModal');
    if (modal) modal.style.display = 'none';
  },

  toggleInfo: () => {
    const modal = document.getElementById('infoModal');
    if (!modal) return;

    const isHidden = modal.style.display === 'none';
    modal.style.display = isHidden ? 'flex' : 'none';
  },
};
