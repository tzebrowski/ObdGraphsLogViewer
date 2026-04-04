import { DOM } from './config.js';
import { UI } from './ui.js';
import { dataProcessor } from './dataprocessor.js';
import { Alert } from './alert.js';
import { debounce } from './debounce.js';

class DriveManager {
  constructor() {
    this.activeLoadToken = 0;
    this.PATH_CONFIG = { root: 'mygiulia', sub: 'trips' };
    this.fileData = [];

    this._state = {
      sortOrder: 'desc',
      filters: { term: '', start: null, end: null },
      pagination: {
        currentPage: 1,
        itemsPerPage: 10,
      },
    };

    this.TEMPLATES = {
      searchInterface: () => `
        <div class="drv-search-container">
          <div class="drv-search-box">
            <i class="fas fa-search drv-search-icon"></i>
            <input type="text" id="driveSearchInput" placeholder="Filter by name..." class="drv-search-input">
            <i class="fas fa-times-circle drv-clear-icon" id="clearDriveSearchText" title="Clear search"></i>
          </div>
          <div class="drv-date-filters">
            <input type="date" id="driveDateStart" class="drv-date-input">
            <span>to</span>
            <input type="date" id="driveDateEnd" class="drv-date-input">
            <button id="clearDriveFilters" class="btn-icon" title="Clear Date Range"><i class="fas fa-calendar-times"></i></button>
          </div>
          <div class="drv-controls-row">
            <div id="driveResultCount" class="drv-result-count"></div>
            <button id="driveSortToggle" class="btn btn-sm drv-sort-btn">
              <i class="fas fa-sort-amount-down"></i> Newest
            </button>
          </div>
        </div>
        <div id="driveFileContainer" class="status-msg">Searching for logs...</div>
      `,
      fileCard: (file, meta) => `
        <div class="drive-file-card" onclick="loadFile('${file.name}','${file.id}', this)">
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
        <div class="month-header drv-month-header">
          <span>${monthYear}</span> <i class="fas fa-chevron-right toggle-icon"></i>
        </div>
        <div class="month-list drv-hidden"></div>
      `,
      recentSectionHeader: () => `
        <div class="month-header drv-recent-header">
          <span><i class="fas fa-history drv-icon-margin"></i> Recently Viewed</span>
          <span id="clearRecentHistory" class="drv-clear-history" title="Clear History">
            <i class="fas fa-trash-alt"></i> Clear
          </span>
        </div>
        <div class="recent-list-container"></div>
      `,
      sortBtnContent: (order) => `
        <i class="fas fa-sort-amount-${order === 'desc' ? 'down' : 'up'}"></i> 
        ${order === 'desc' ? 'Newest' : 'Oldest'}
      `,
      paginationControls: (current, total, start, end, totalItems) => `
        <div class="pagination-controls drv-pagination">
          <button id="prevPageBtn" class="btn btn-sm" ${current === 1 ? 'disabled style="opacity:0.5"' : ''}>
             <i class="fas fa-chevron-left"></i> Prev
          </button>
          <span class="drv-page-info">
             ${start}-${end} of ${totalItems}
          </span>
          <button id="nextPageBtn" class="btn btn-sm" ${current === total ? 'disabled style="opacity:0.5"' : ''}>
             Next <i class="fas fa-chevron-right"></i>
          </button>
        </div>
      `,
    };
  }

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
  }

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
  }

  async fetchJsonFiles(folderId) {
    const listEl = document.getElementById('driveFileContainer');
    if (!listEl) return;

    listEl.innerHTML =
      '<div class="status-msg">Fetching all logs from Drive...</div>';
    this.fileData = [];

    let pageToken = null;
    let hasMore = true;

    try {
      while (hasMore) {
        const res = await gapi.client.drive.files.list({
          pageSize: 100,
          fields: 'nextPageToken, files(id, name, size, modifiedTime)',
          q: `'${folderId}' in parents and name contains '.json' and trashed=false`,
          orderBy: 'modifiedTime desc',
          pageToken: pageToken,
        });

        const files = res.result.files || [];

        const processedFiles = files.map((f) => ({
          file: f,
          meta: this.getFileMetadata(f.name),
          timestamp: this.extractTimestamp(f.name),
        }));

        this.fileData = [...this.fileData, ...processedFiles];

        pageToken = res.result.nextPageToken;
        if (!pageToken) {
          hasMore = false;
        } else {
          listEl.innerHTML = `<div class="status-msg">Loaded ${this.fileData.length} logs...</div>`;
        }
      }

      if (this.fileData.length === 0) {
        listEl.innerHTML = '<div class="status-msg">No log files found.</div>';
        return;
      }

      this.initSearch();
    } catch (error) {
      this.handleApiError(error, listEl);
    }
  }

  async loadFile(fileName, id, element) {
    document
      .querySelectorAll('.drive-file-card')
      .forEach((r) => r.classList.remove('active'));
    element?.classList.add('active');

    let recent = JSON.parse(localStorage.getItem('recent_logs') || '[]');
    recent = [id, ...recent.filter((i) => i !== id)].slice(0, 3);
    localStorage.setItem('recent_logs', JSON.stringify(recent));

    const currentToken = ++this.activeLoadToken;
    UI.setLoading(true, 'Downloading from Drive...', () => {
      this.activeLoadToken++;
      UI.setLoading(false);
    });

    try {
      let dataToProcess;

      if (fileName.endsWith('.gz')) {
        const tokenObj = gapi.client.getToken();
        if (!tokenObj)
          throw new Error(
            'No active Google session found. Please sign in again.'
          );

        const response = await fetch(
          `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
          {
            headers: { Authorization: `Bearer ${tokenObj.access_token}` },
          }
        );

        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
        const blob = await response.blob();

        if (currentToken !== this.activeLoadToken) return;

        const ds = new DecompressionStream('gzip');
        const decompressedStream = blob.stream().pipeThrough(ds);
        const fileText = await new Response(decompressedStream).text();

        dataToProcess = JSON.parse(fileText);
      }
      
      else {
        const response = await gapi.client.drive.files.get({
          fileId: id,
          alt: 'media',
        });

        if (currentToken !== this.activeLoadToken) return;

        // Handle GAPI optionally parsing JSON strings automatically
        dataToProcess =
          typeof response.result === 'string'
            ? JSON.parse(response.result)
            : response.result;
      }

      dataProcessor.process(dataToProcess, fileName);
    } catch (error) {
      if (currentToken === this.activeLoadToken) {
        Alert.showAlert(`Drive Error: ${error.message}`);
      }
    } finally {
      if (currentToken === this.activeLoadToken) {
        UI.setLoading(false);
      }
    }
  }

  initSearch() {
    const inputs = {
      text: document.getElementById('driveSearchInput'),
      clearText: document.getElementById('clearDriveSearchText'),
      start: document.getElementById('driveDateStart'),
      end: document.getElementById('driveDateEnd'),
      sortBtn: document.getElementById('driveSortToggle'),
    };

    const safeAddEvent = (id, event, handler) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(event, handler);
      return el;
    };

    const debouncedRefresh = debounce(() => this.refreshUI(), 250);

    const updateHandler = (immediate = false) => {
      this._state.filters = {
        term:
          document
            .getElementById('driveSearchInput')
            ?.value.toLowerCase()
            .trim() || '',
        start: document.getElementById('driveDateStart')?.value
          ? new Date(document.getElementById('driveDateStart').value).setHours(
              0,
              0,
              0,
              0
            )
          : null,
        end: document.getElementById('driveDateEnd')?.value
          ? new Date(document.getElementById('driveDateEnd').value).setHours(
              23,
              59,
              59,
              999
            )
          : null,
      };

      const clearTextBtn = document.getElementById('clearDriveSearchText');
      if (clearTextBtn)
        clearTextBtn.style.display = this._state.filters.term
          ? 'block'
          : 'none';

      this._state.pagination.currentPage = 1;

      if (immediate) this.refreshUI();
      else debouncedRefresh();
    };

    safeAddEvent('clearDriveSearchText', 'click', () => {
      const input = document.getElementById('driveSearchInput');
      if (input) input.value = '';
      updateHandler(true);
    });

    safeAddEvent('clearDriveFilters', 'click', () => {
      const start = document.getElementById('driveDateStart');
      const end = document.getElementById('driveDateEnd');
      if (start) start.value = '';
      if (end) end.value = '';
      updateHandler(true);
    });

    ['driveSearchInput', 'driveDateStart', 'driveDateEnd'].forEach((id) =>
      safeAddEvent(id, 'input', () => updateHandler(id !== 'driveSearchInput'))
    );

    safeAddEvent('driveSortToggle', 'click', (e) => {
      const btn = e.currentTarget;
      this._state.sortOrder = this._state.sortOrder === 'desc' ? 'asc' : 'desc';
      btn.innerHTML = this.TEMPLATES.sortBtnContent(this._state.sortOrder);
      this.refreshUI();
    });

    this.refreshUI();
  }

  refreshUI() {
    const container = document.getElementById('driveFileContainer');
    if (!container) return;

    const driveListContainer = document.getElementById('driveListContainer');
    if (!driveListContainer) return;
    driveListContainer.style.display = 'block';

    const filtered = this.fileData.filter((item) => this._applyFilters(item));

    filtered.sort((a, b) => {
      const diff = a.timestamp - b.timestamp;
      return this._state.sortOrder === 'desc' ? -diff : diff;
    });

    const { currentPage, itemsPerPage } = this._state.pagination;
    const totalPages = Math.ceil(filtered.length / itemsPerPage);

    if (currentPage > totalPages && totalPages > 0)
      this._state.pagination.currentPage = totalPages;
    if (currentPage < 1) this._state.pagination.currentPage = 1;

    const startIdx = (this._state.pagination.currentPage - 1) * itemsPerPage;
    const paginatedItems = filtered.slice(startIdx, startIdx + itemsPerPage);

    container.innerHTML = '';

    const isFiltering =
      this._state.filters.term ||
      this._state.filters.start ||
      this._state.filters.end;
    if (!isFiltering && this._state.pagination.currentPage === 1) {
      this.renderRecentSection(container);
    }

    this.renderGroupedCards(container, paginatedItems);
    this.renderPaginationControls(container, filtered.length, totalPages);

    const countEl = document.getElementById('driveResultCount');
    if (countEl) countEl.innerText = `Found ${filtered.length} logs`;
  }

  _applyFilters(item) {
    const { term, start, end } = this._state.filters;
    const fileDate = item.timestamp;
    const name = item.file.name.toLowerCase();

    const matchesText = name.includes(term);
    const matchesDate =
      (!start || fileDate >= start) && (!end || fileDate <= end);

    return matchesText && matchesDate;
  }

  renderGroupedCards(container, items) {
    if (items.length === 0) {
      container.innerHTML +=
        '<div class="status-msg">No logs match your criteria.</div>';
      return;
    }

    let lastMonth = '';
    let currentGroup = null;

    items.forEach((item) => {
      const dateObj = new Date(item.timestamp);
      const validDate = isNaN(dateObj.getTime()) ? new Date() : dateObj;
      const monthYear = validDate.toLocaleString('en-US', {
        month: 'long',
        year: 'numeric',
      });

      if (monthYear !== lastMonth) {
        currentGroup = this.createMonthGroup(monthYear);
        container.appendChild(currentGroup);
        lastMonth = monthYear;
      }

      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = this.TEMPLATES.fileCard(item.file, item.meta);
      const cardEl = tempDiv.firstElementChild;

      currentGroup.querySelector('.month-list').appendChild(cardEl);
    });
  }

  renderRecentSection(container) {
    const recentIds = JSON.parse(localStorage.getItem('recent_logs') || '[]');
    if (recentIds.length === 0) return;

    const recentItems = recentIds
      .map((id) => this.fileData.find((f) => f.file.id === id))
      .filter((item) => item !== undefined);

    if (recentItems.length === 0) return;

    const section = document.createElement('div');
    section.className = 'recent-section';
    section.innerHTML = this.TEMPLATES.recentSectionHeader();
    const list = section.querySelector('.recent-list-container') || section;

    recentItems.forEach((item) => {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = this.TEMPLATES.fileCard(item.file, item.meta);
      const card = tempDiv.firstElementChild;
      card.classList.add('drv-recent-card');
      list.appendChild(card);
    });

    container.appendChild(section);

    document
      .getElementById('clearRecentHistory')
      ?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.clearRecentHistory();
      });
  }

  renderPaginationControls(container, totalItems, totalPages) {
    if (totalItems === 0) return;

    const { currentPage, itemsPerPage } = this._state.pagination;
    const start = (currentPage - 1) * itemsPerPage + 1;
    const end = Math.min(currentPage * itemsPerPage, totalItems);

    const navDiv = document.createElement('div');
    navDiv.innerHTML = this.TEMPLATES.paginationControls(
      currentPage,
      totalPages,
      start,
      end,
      totalItems
    );
    container.appendChild(navDiv);

    navDiv.querySelector('#prevPageBtn')?.addEventListener('click', () => {
      if (currentPage > 1) {
        this._state.pagination.currentPage--;
        this.refreshUI();
      }
    });

    navDiv.querySelector('#nextPageBtn')?.addEventListener('click', () => {
      if (currentPage < totalPages) {
        this._state.pagination.currentPage++;
        this.refreshUI();
      }
    });
  }

  createMonthGroup(monthYear) {
    const group = document.createElement('div');
    group.className = 'month-group';
    group.innerHTML = this.TEMPLATES.monthGroup(monthYear);

    const header = group.querySelector('.month-header');
    const list = group.querySelector('.month-list');

    header.onclick = () => {
      const isHidden =
        list.classList.contains('drv-hidden') || list.style.display === 'none';

      if (isHidden) {
        list.classList.remove('drv-hidden');
        list.style.display = 'block';
        header.querySelector('.toggle-icon').className =
          'fas fa-chevron-down toggle-icon';
      } else {
        list.style.display = 'none';
        header.querySelector('.toggle-icon').className =
          'fas fa-chevron-right toggle-icon';
      }
    };
    return group;
  }

  getFileMetadata(fileName) {
    // Robust regex handles both legacy .json and the new .json.gz / .json.json.gz
    const match = fileName.match(/-(\d+)-(\d+)(?:\.json|\.gz)+$/);
    if (!match) return { date: 'Unknown', length: '?' };

    const date = new Date(parseInt(match[1]));

    // Restored backward compatibility: return standard ISO string
    return { date: date.toISOString(), length: match[2] };
  }

  extractTimestamp(fileName) {
    const match = fileName.match(/-(\d+)-(\d+)(?:\.json|\.gz)+$/);
    return match ? parseInt(match[1]) : 0;
  }

  handleApiError(error, listEl) {
    if (error.status === 401 || error.status === 403)
      gapi.client.setToken(null);
    if (listEl) {
      const msg =
        error.result?.error?.message || error.message || 'Unknown error';
      listEl.innerHTML = `<div class="error-msg">Drive error: ${error.status === 401 ? 'Session expired' : msg}</div>`;
    }
  }

  _renderError(msg) {
    const container = document.getElementById('driveFileContainer');
    if (container) container.innerHTML = `<div class="error-msg">${msg}</div>`;
  }

  clearRecentHistory() {
    if (confirm('Clear recently viewed history?')) {
      localStorage.removeItem('recent_logs');
      this.refreshUI();
    }
  }
}

export const Drive = new DriveManager();
