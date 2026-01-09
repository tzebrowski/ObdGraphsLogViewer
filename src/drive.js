import { DOM } from './config.js';
import { UI } from './ui.js';
import { DataProcessor } from './dataprocesssor.js';
import { Alert } from './alert.js';

/**
 * Utility for debouncing function execution to improve performance during filtering.
 */
const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

/**
 * Drive Module - Handles Google Drive file interactions, filtering, and UI rendering.
 */
export const Drive = {
  activeLoadToken: 0,
  PATH_CONFIG: { root: 'mygiulia', sub: 'trips' },
  masterCards: [],
  _state: {
    sortOrder: 'desc',
    filters: { term: '', start: null, end: null },
  },

  // --- Core Drive Operations ---

  async findFolderId(name, parentId = 'root') {
    try {
      const variants = [
        name,
        name.toLowerCase(),
        name.charAt(0).toUpperCase() + name.slice(1),
      ];
      const nameQuery = variants.map((v) => `name = '${v}'`).join(' or ');
      const query = `mimeType='application/vnd.google-apps.folder' and (${nameQuery}) and '${parentId}' in parents and trashed=false`;

      const response = await gapi.client.drive.files.list({
        q: query,
        fields: 'files(id, name)',
        pageSize: 1,
      });
      return response.result.files.length > 0
        ? response.result.files[0].id
        : null;
    } catch (error) {
      console.error(`Drive: Error locating folder "${name}":`, error);
      return null;
    }
  },

  async listFiles() {
    const listEl = DOM.get('driveList');
    if (!listEl) return;

    listEl.style.display = 'block';
    listEl.innerHTML = this.TEMPLATES.searchInterface();

    try {
      const rootId = await this.findFolderId(this.PATH_CONFIG.root);
      const subFolderId = rootId
        ? await this.findFolderId(this.PATH_CONFIG.sub, rootId)
        : null;

      if (!subFolderId) {
        this._renderError('Required folders not found.');
        return;
      }

      await this.fetchJsonFiles(subFolderId);
    } catch (error) {
      this.handleApiError(error, document.getElementById('driveFileContainer'));
    }
  },

  async fetchJsonFiles(
    folderId,
    listEl = document.getElementById('driveFileContainer')
  ) {
    if (!listEl) return;

    try {
      const res = await gapi.client.drive.files.list({
        pageSize: 50,
        fields: 'files(id, name, size, modifiedTime)',
        q: `'${folderId}' in parents and name contains '.json' and trashed=false`,
        orderBy: 'modifiedTime desc',
      });

      const files = res.result.files || [];
      if (files.length === 0) {
        listEl.innerHTML = '<div class="status-msg">No log files found.</div>';
        return;
      }

      listEl.innerHTML = files
        .map((f) => {
          const meta = this.getFileMetadata(f.name);
          return this.TEMPLATES.fileCard(f, meta);
        })
        .join('');

      this.masterCards = Array.from(
        listEl.querySelectorAll('.drive-file-card')
      );
      this.initSearch();
    } catch (error) {
      this.handleApiError(error, listEl);
    }
  },

  async loadFile(fileName, id, element) {
    document
      .querySelectorAll('.drive-file-card')
      .forEach((r) => r.classList.remove('active'));
    element?.classList.add('active');

    let recent = JSON.parse(localStorage.getItem('recent_logs') || '[]');
    recent = [id, ...recent.filter((i) => i !== id)].slice(0, 3);
    localStorage.setItem('recent_logs', JSON.stringify(recent));

    this.refreshUI();

    const currentToken = ++this.activeLoadToken;
    UI.setLoading(true, 'Fetching from Drive...', () => {
      this.activeLoadToken++;
      UI.setLoading(false);
    });

    try {
      const response = await gapi.client.drive.files.get({
        fileId: id,
        alt: 'media',
      });
      if (currentToken !== this.activeLoadToken) return;
      DataProcessor.process(response.result, fileName);
    } catch (error) {
      if (currentToken === this.activeLoadToken)
        Alert.showAlert(
          `Drive Error: ${error.result?.error?.message || error.message}`
        );
    } finally {
      if (currentToken === this.activeLoadToken) UI.setLoading(false);
    }
  },

  // --- Search & Filtering Logic ---

  initSearch() {
    const inputs = {
      text: document.getElementById('driveSearchInput'),
      clearText: document.getElementById('clearDriveSearchText'),
      start: document.getElementById('driveDateStart'),
      end: document.getElementById('driveDateEnd'),
      sortBtn: document.getElementById('driveSortToggle'),
    };

    const debouncedRefresh = debounce(() => this.refreshUI(), 250);

    const updateHandler = (immediate = false) => {
      this._state.filters = {
        term: inputs.text?.value.toLowerCase().trim() || '',
        start: inputs.start?.value
          ? new Date(inputs.start.value).setHours(0, 0, 0, 0)
          : null,
        end: inputs.end?.value
          ? new Date(inputs.end.value).setHours(23, 59, 59, 999)
          : null,
      };

      if (inputs.clearText)
        inputs.clearText.style.display = this._state.filters.term
          ? 'block'
          : 'none';

      if (immediate) this.refreshUI();
      else debouncedRefresh();
    };

    inputs.clearText?.addEventListener('click', () => {
      if (inputs.text) inputs.text.value = '';
      updateHandler(true);
    });
    document
      .getElementById('clearDriveFilters')
      ?.addEventListener('click', () => {
        if (inputs.start) inputs.start.value = '';
        if (inputs.end) inputs.end.value = '';
        updateHandler(true);
      });

    [inputs.text, inputs.start, inputs.end].forEach((el) =>
      el?.addEventListener('input', () => updateHandler(el.type !== 'text'))
    );

    inputs.sortBtn?.addEventListener('click', () => {
      this._state.sortOrder = this._state.sortOrder === 'desc' ? 'asc' : 'desc';
      inputs.sortBtn.innerHTML = this.TEMPLATES.sortBtnContent(
        this._state.sortOrder
      );
      this.refreshUI();
    });

    this.refreshUI();
  },

  refreshUI() {
    const container = document.getElementById('driveFileContainer');
    if (!container) return;

    const filtered = this.masterCards.filter((card) =>
      this._applyFilters(card)
    );

    filtered.sort((a, b) => {
      const diff = this.parseDateFromCard(a) - this.parseDateFromCard(b);
      return this._state.sortOrder === 'desc' ? -diff : diff;
    });

    container.innerHTML = '';
    const isFiltering =
      this._state.filters.term ||
      this._state.filters.start ||
      this._state.filters.end;

    if (!isFiltering) this.renderRecentSection(container);
    this.renderGroupedCards(container, filtered);

    const countEl = document.getElementById('driveResultCount');
    if (countEl)
      countEl.innerText = `Showing ${filtered.length} of ${this.masterCards.length} logs`;
  },

  _applyFilters(card) {
    const { term, start, end } = this._state.filters;
    const fileDate = this.parseDateFromCard(card);
    const titleEl = card.querySelector('.file-name-title');
    const name = (titleEl?.textContent || '').toLowerCase();

    const matchesText = name.includes(term);
    const matchesDate =
      (!start || fileDate >= start) && (!end || fileDate <= end);

    return matchesText && matchesDate;
  },

  // --- Rendering Helpers ---

  renderGroupedCards(container, cards) {
    let lastMonth = '';
    let currentGroup = null;

    cards.forEach((card) => {
      const monthYear = new Date(this.parseDateFromCard(card)).toLocaleString(
        'en-US',
        { month: 'long', year: 'numeric' }
      );

      if (monthYear !== lastMonth) {
        currentGroup = this.createMonthGroup(monthYear);
        container.appendChild(currentGroup);
        lastMonth = monthYear;
      }
      card.style.display = 'flex';
      currentGroup.querySelector('.month-list').appendChild(card);
    });
  },

  renderRecentSection(container) {
    const recentIds = JSON.parse(localStorage.getItem('recent_logs') || '[]');
    if (recentIds.length === 0) return;

    const section = document.createElement('div');
    section.className = 'recent-section';
    section.innerHTML = this.TEMPLATES.recentSectionHeader();

    const list = document.createElement('div');
    recentIds.forEach((id) => {
      const original = this.masterCards.find((c) =>
        c.getAttribute('onclick')?.includes(id)
      );
      if (original) {
        const clone = original.cloneNode(true);
        clone.style.borderLeft = '3px solid #4285F4';
        clone.style.marginBottom = '8px';
        list.appendChild(clone);
      }
    });

    section.appendChild(list);
    container.appendChild(section);

    document
      .getElementById('clearRecentHistory')
      ?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.clearRecentHistory();
      });
  },

  createMonthGroup(monthYear) {
    const group = document.createElement('div');
    group.className = 'month-group';
    group.innerHTML = this.TEMPLATES.monthGroup(monthYear);

    const header = group.querySelector('.month-header');
    const list = group.querySelector('.month-list');
    header.onclick = () => {
      const isCollapsed = list.style.display === 'none';
      list.style.display = isCollapsed ? 'block' : 'none';
      header.querySelector('.toggle-icon').className = isCollapsed
        ? 'fas fa-chevron-down toggle-icon'
        : 'fas fa-chevron-right toggle-icon';
    };
    return group;
  },

  // --- Utilities & Metadata ---

  getFileMetadata(fileName) {
    const match = fileName.match(/-(\d+)-(\d+)\.json$/);
    if (!match) return null;
    const date = new Date(parseInt(match[1]));
    return { date: date.toISOString(), length: match[2] };
  },

  parseDateFromCard(card) {
    const dateEl =
      card?.querySelector('.meta-item span') ||
      card?.querySelector('.meta-item');
    if (!dateEl) return 0;
    const ts = Date.parse(dateEl.textContent.trim());
    return isNaN(ts) ? 0 : ts;
  },

  handleApiError(error, listEl) {
    if (error.status === 401 || error.status === 403)
      gapi.client.setToken(null);
    if (listEl) {
      const msg =
        error.result?.error?.message || error.message || 'Unknown error';
      listEl.innerHTML = `<div class="error-msg">Drive error: ${error.status === 401 ? 'Session expired' : msg}</div>`;
    }
  },

  _renderError(msg) {
    const container = document.getElementById('driveFileContainer');
    if (container) container.innerHTML = `<div class="error-msg">${msg}</div>`;
  },

  clearRecentHistory() {
    if (confirm('Clear recently viewed history?')) {
      localStorage.removeItem('recent_logs');
      this.refreshUI();
    }
  },

  // --- HTML Templates ---

  TEMPLATES: {
    searchInterface: () => `
      <div class="drive-search-container" style="padding: 10px; position: sticky; top: 0; background: var(--sidebar-bg); z-index: 5; border-bottom: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 8px;">
        <div style="position: relative; display: flex; align-items: center;">
          <i class="fas fa-search" style="position: absolute; left: 10px; color: var(--text-muted); font-size: 0.9em;"></i>
          <input type="text" id="driveSearchInput" placeholder="Filter by name..." style="width: 100%; padding: 8px 30px; border-radius: 6px; border: 1px solid var(--border-color); font-size: 0.9em; box-sizing: border-box;">
          <i class="fas fa-times-circle" id="clearDriveSearchText" style="position: absolute; right: 10px; color: var(--text-muted); cursor: pointer; display: none;" title="Clear search"></i>
        </div>
        <div style="display: flex; align-items: center; gap: 5px; font-size: 0.75em;">
          <input type="date" id="driveDateStart" style="flex: 1; padding: 4px; border-radius: 4px; border: 1px solid var(--border-color);">
          <span>to</span>
          <input type="date" id="driveDateEnd" style="flex: 1; padding: 4px; border-radius: 4px; border: 1px solid var(--border-color);">
          <button id="clearDriveFilters" class="btn-icon" title="Clear Date Range"><i class="fas fa-calendar-times"></i></button>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div id="driveResultCount" style="font-size: 0.75em; color: var(--text-muted); font-weight: bold;"></div>
          <button id="driveSortToggle" class="btn btn-sm" style="font-size: 0.75em; padding: 2px 8px; display: flex; align-items: center; gap: 4px;">
            <i class="fas fa-sort-amount-down"></i> Newest
          </button>
        </div>
      </div>
      <div id="driveFileContainer" class="status-msg">Searching for logs...</div>
    `,
    fileCard: (file, meta) => `
      <div class="drive-file-card" onclick="Drive.loadFile('${file.name}','${file.id}', this)">
        <div class="file-card-icon"><i class="fab fa-google-drive"></i></div>
        <div class="file-card-body">
          <div class="file-name-title">${file.name}</div>
          <div class="file-card-meta-grid">
            <div class="meta-item"><i class="far fa-calendar-alt"></i> <span>${meta?.date || 'N/A'}</span></div>
            <div class="meta-item"><i class="fas fa-history"></i> <span>${meta?.length || 'N/A'}s</span></div>
            <div class="meta-item"><i class="fas fa-hdd"></i> <span>${file.size ? (file.size / 1024).toFixed(0) : '?'} KB</span></div>
          </div>
        </div>
      </div>
    `,
    monthGroup: (monthYear) => `
      <div class="month-header" style="padding: 8px 12px; font-size: 0.75em; font-weight: 800; color: #e31837; background: rgba(227, 24, 55, 0.05); border-left: 3px solid #e31837; margin: 10px 0 5px 0; text-transform: uppercase; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
        <span>${monthYear}</span> <i class="fas fa-chevron-down toggle-icon"></i>
      </div>
      <div class="month-list"></div>
    `,
    recentSectionHeader: () => `
      <div class="month-header" style="display: flex; justify-content: space-between;">
        <span><i class="fas fa-history" style="margin-right: 8px;"></i> Recently Viewed</span>
        <span id="clearRecentHistory" style="font-size: 0.8em; cursor: pointer; opacity: 0.8;" title="Clear History">
          <i class="fas fa-trash-alt"></i> Clear
        </span>
      </div>
    `,
    sortBtnContent: (order) => `
      <i class="fas fa-sort-amount-${order === 'desc' ? 'down' : 'up'}"></i> 
      ${order === 'desc' ? 'Newest' : 'Oldest'}
    `,
  },
};
