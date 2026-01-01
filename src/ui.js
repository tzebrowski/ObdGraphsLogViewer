import { AppState, DOM, DEFAULT_SIGNALS, getChartColors } from './config.js';
import { DataProcessor } from './dataprocesssor.js';
import { DragnDrop } from './dragndrop.js';
import { Preferences } from './preferences.js';

export const UI = {
  STORAGE_KEY: 'sidebar_collapsed_states',

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

  toggleItem(i) {
    const p = DOM.get(i);
    if (!p) return;

    const isHidden = p.style.display === 'none' || p.style.display === '';
    p.style.display = isHidden ? 'block' : 'none';

    if (AppState.chartInstance) AppState.chartInstance.resize();
  },

  init() {
    UI.initResizer();
    UI.initVersionInfo();
    UI.initSidebarSectionsCollapse();
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

  initResizer() {
    const resizer = UI.elements.resizer;
    const sidebar = UI.elements.sidebar;
    let isResizing = false;

    if (!resizer || !sidebar) return;

    resizer.addEventListener('mousedown', () => {
      isResizing = true;
      document.body.style.cursor = 'col-resize';
      // Add a temporary overlay to prevent iframe/chart interference while dragging
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;

      // Calculate new width based on mouse position
      let newWidth = e.clientX;

      // Constraints (matches CSS min/max)
      if (newWidth >= 250 && newWidth <= 600) {
        sidebar.style.width = `${newWidth}px`;

        // Trigger chart resize in real-time or debounced
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
    const el = UI.elements;
    if (el.sidebar) {
      el.sidebar.classList.toggle('collapsed');
      setTimeout(() => AppState.chartInstance?.resize(), 350);
    }
    DragnDrop.toggleDropZone();
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

  renderSignalList() {
    const container = document.getElementById('signalList');
    if (!container) return;
    container.innerHTML = '';

    // Use available signals from the primary file or the global state
    const signals = AppState.availableSignals || [];
    const fragment = document.createDocumentFragment();

    signals.forEach((signal, idx) => {
      const isImportant = DEFAULT_SIGNALS.some((k) => signal.includes(k));
      const chartColors = getChartColors();
      const color = chartColors[idx % chartColors.length];

      const label = document.createElement('label');
      label.className = 'signal-item';

      label.innerHTML = `
                <span class="color-dot" style="color: ${color}; background-color: ${color}"></span>
                <input type="checkbox" id="chk-${idx}" data-key="${signal}" ${isImportant ? 'checked' : ''}>
                <label for="chk-${idx}">${signal}</label>
            `;

      fragment.appendChild(label);
    });

    container.appendChild(fragment);

    // Event Delegation for checkboxes
    container.onchange = (e) => {
      if (e.target.tagName === 'INPUT') {
        this.syncSignalVisibility(
          e.target.getAttribute('data-key'),
          e.target.checked
        );
      }
    };
  },

  syncSignalVisibility(key, isVisible) {
    // Loop through ALL active chart instances to update visibility
    AppState.chartInstances.forEach((chart) => {
      const dataset = chart.data.datasets.find((d) => d.label === key);
      if (dataset) {
        dataset.hidden = !isVisible;
      }
    });

    // Trigger a batch update for all charts without re-animating
    AppState.chartInstances.forEach((chart) => chart.update('none'));
  },

  toggleAllSignals(shouldCheck) {
    const container = document.getElementById('signalList');
    if (!container) return;

    container
      .querySelectorAll('input')
      .forEach((i) => (i.checked = shouldCheck));

    AppState.chartInstances.forEach((chart) => {
      chart.data.datasets.forEach((ds) => (ds.hidden = !shouldCheck));
      chart.update('none');
    });
  },

  loadSampleData: async () => {
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

      InfoPage.toggleInfo();

      btn.innerText = originalText;
      btn.disabled = false;
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to load sample data.');
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

    localStorage.setItem('preferred-theme', theme);
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
