import { DOM } from './config.js';
import { UI } from './ui.js';
import { DataProcessor } from './dataprocesssor.js';
import { Alert } from './alert.js';

export const Drive = {
  activeLoadToken: 0,
  PATH_CONFIG: { root: 'mygiulia', sub: 'trips' },
  masterCards: [],

  async findFolderId(name, parentId = 'root') {
    try {
      const query = `mimeType='application/vnd.google-apps.folder' and 
                     (name = '${name}' or name = '${name.toLowerCase()}' or name = '${name.charAt(0).toUpperCase() + name.slice(1)}') 
                     and '${parentId}' in parents and trashed=false`;

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
    listEl.innerHTML = this.getSearchInterfaceTemplate();

    try {
      const rootId = await this.findFolderId(this.PATH_CONFIG.root);
      const subFolderId = rootId
        ? await this.findFolderId(this.PATH_CONFIG.sub, rootId)
        : null;

      if (!subFolderId) {
        document.getElementById('driveFileContainer').innerHTML =
          `<div class="error-msg">Required folders (${this.PATH_CONFIG.root}/${this.PATH_CONFIG.sub}) not found.</div>`;
        return;
      }

      await this.fetchJsonFiles(
        subFolderId,
        document.getElementById('driveFileContainer')
      );
      this.initSearch();
    } catch (error) {
      this.handleApiError(error, document.getElementById('driveFileContainer'));
    }
  },

  initSearch() {
    const container = document.getElementById('driveFileContainer');
    const inputs = {
      text: document.getElementById('driveSearchInput'),
      clearText: document.getElementById('clearDriveSearchText'),
      start: document.getElementById('driveDateStart'),
      end: document.getElementById('driveDateEnd'),
      sortBtn: document.getElementById('driveSortToggle'),
    };

    let state = { sortOrder: 'desc' };

    const updateUI = () => {
      const term = inputs.text.value.toLowerCase().trim();

      if (inputs.clearText) {
        inputs.clearText.style.display = term.length > 0 ? 'block' : 'none';
      }

      const filters = {
        term: term,
        start: inputs.start.value
          ? new Date(inputs.start.value).setHours(0, 0, 0, 0)
          : null,
        end: inputs.end.value
          ? new Date(inputs.end.value).setHours(23, 59, 59, 999)
          : null,
      };

      let matchCount = 0;

      this.masterCards.forEach((card) => {
        const fileDate = this.parseDateFromCard(card);
        const titleEl = card.querySelector('.file-name-title');
        const name = (
          titleEl?.innerText ||
          titleEl?.textContent ||
          ''
        ).toLowerCase();
        const matchesText = name.includes(filters.term);

        const matchesDate =
          (!filters.start || fileDate >= filters.start) &&
          (!filters.end || fileDate <= filters.end);

        const isVisible = matchesText && matchesDate;
        card.style.display = isVisible ? 'flex' : 'none';
        if (isVisible) matchCount++;
      });

      container.innerHTML = '';

      const isFiltering =
        inputs.text.value || inputs.start.value || inputs.end.value;
      if (!isFiltering) {
        this.renderRecentSection(container);
      }

      this.masterCards.sort((a, b) => {
        const diff = this.parseDateFromCard(a) - this.parseDateFromCard(b);
        return state.sortOrder === 'desc' ? -diff : diff;
      });

      this.renderGroupedCards(container, this.masterCards, true);

      const countEl = document.getElementById('driveResultCount');
      if (countEl)
        countEl.innerText = `Showing ${matchCount} of ${this.masterCards.length} logs`;
    };

    inputs.clearText?.addEventListener('click', () => {
      inputs.text.value = '';
      updateUI();
    });

    document
      .getElementById('clearDriveFilters')
      ?.addEventListener('click', () => {
        inputs.start.value = '';
        inputs.end.value = '';
        updateUI();
      });

    [inputs.text, inputs.start, inputs.end].forEach((el) =>
      el.addEventListener('input', updateUI)
    );

    inputs.sortBtn?.addEventListener('click', () => {
      state.sortOrder = state.sortOrder === 'desc' ? 'asc' : 'desc';
      inputs.sortBtn.innerHTML = `<i class="fas fa-sort-amount-${state.sortOrder === 'desc' ? 'down' : 'up'}"></i> 
                                  ${state.sortOrder === 'desc' ? 'Newest' : 'Oldest'}`;
      updateUI();
    });

    updateUI();
  },

  renderGroupedCards(container, cards, append = false) {
    if (!append) {
      container.innerHTML = '';
    }

    let lastMonth = '';
    let currentGroup = null;

    cards
      .filter((c) => c.style.display !== 'none')
      .forEach((card) => {
        const monthYear = new Date(this.parseDateFromCard(card)).toLocaleString(
          'en-US',
          { month: 'long', year: 'numeric' }
        );

        if (monthYear !== lastMonth) {
          currentGroup = this.createMonthGroup(monthYear);
          container.appendChild(currentGroup);
          lastMonth = monthYear;
        }
        currentGroup.querySelector('.month-list').appendChild(card);
      });
  },

  createMonthGroup(monthYear) {
    const group = document.createElement('div');
    group.className = 'month-group';
    group.innerHTML = `
      <div class="month-header" style="padding: 8px 12px; font-size: 0.75em; font-weight: 800; color: #e31837; 
           background: rgba(227, 24, 55, 0.05); border-left: 3px solid #e31837; margin: 10px 0 5px 0; 
           text-transform: uppercase; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
        <span>${monthYear}</span> <i class="fas fa-chevron-down toggle-icon"></i>
      </div>
      <div class="month-list"></div>
    `;

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

  getSearchInterfaceTemplate() {
    return `
    <div class="drive-search-container" style="padding: 10px; position: sticky; top: 0; background: var(--sidebar-bg); z-index: 5; border-bottom: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 8px;">
      <div style="position: relative; display: flex; align-items: center;">
        <i class="fas fa-search" style="position: absolute; left: 10px; color: var(--text-muted); font-size: 0.9em;"></i>
        <input type="text" id="driveSearchInput" placeholder="Filter by name..." 
               style="width: 100%; padding: 8px 30px; border-radius: 6px; border: 1px solid var(--border-color); font-size: 0.9em; box-sizing: border-box;">
        <i class="fas fa-times-circle" id="clearDriveSearchText" 
           style="position: absolute; right: 10px; color: var(--text-muted); cursor: pointer; display: none;" 
           title="Clear search"></i>
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
  `;
  },

  async fetchJsonFiles(folderId, listEl) {
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

      listEl.innerHTML = files.map((f) => this.renderFileRow(f)).join('');

      this.masterCards = Array.from(
        listEl.querySelectorAll('.drive-file-card')
      );

      this.initSearch();
    } catch (error) {
      this.handleApiError(error, listEl);
    }
  },

  renderFileRow(file) {
    const meta = this.getFileMetadata(file.name);
    return `
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
  </div>`;
  },

  getFileMetadata(fileName) {
    const match = fileName.match(/-(\d+)-(\d+)\.json$/);
    if (!match) return null;

    const date = new Date(parseInt(match[1]));
    return {
      date: date.toISOString(),
      length: match[2],
    };
  },

  parseDateFromCard(card) {
    if (!card) return 0;

    const dateEl =
      card.querySelector('.meta-item span') || card.querySelector('.meta-item');
    if (!dateEl) return 0;

    const dateStr = dateEl.textContent.trim();
    const ts = Date.parse(dateStr);

    if (isNaN(ts)) {
      return 0;
    }
    return ts;
  },

  async loadFile(fileName, id, element) {
    document
      .querySelectorAll('.drive-file-card')
      .forEach((r) => r.classList.remove('active'));
    element?.classList.add('active');

    let recent = JSON.parse(localStorage.getItem('recent_logs') || '[]');
    recent = [id, ...recent.filter((i) => i !== id)].slice(0, 3);
    localStorage.setItem('recent_logs', JSON.stringify(recent));

    const searchInput = document.getElementById('driveSearchInput');
    if (searchInput) {
      searchInput.dispatchEvent(new Event('input'));
    }

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

  handleApiError(error, listEl) {
    if (error.status === 401 || error.status === 403)
      gapi.client.setToken(null);
    if (listEl)
      listEl.innerHTML = `<div class="error-msg">Drive error: ${error.status === 401 ? 'Session expired' : error.message || 'Unknown error'}</div>`;
  },

  clearRecentHistory() {
    if (confirm('Clear recently viewed history?')) {
      localStorage.removeItem('recent_logs');

      const searchInput = document.getElementById('driveSearchInput');
      if (searchInput) {
        searchInput.dispatchEvent(new Event('input'));
      }
    }
  },

  renderRecentSection(container) {
    const recentIds = JSON.parse(localStorage.getItem('recent_logs') || '[]');
    if (recentIds.length === 0) return;

    const section = document.createElement('div');
    section.className = 'recent-section';
    section.innerHTML = `
    <div class="month-header" style="color: #4285F4; border-left-color: #4285F4; background: rgba(66, 133, 244, 0.05); margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
      <span><i class="fas fa-history" style="margin-right: 8px;"></i> Recently Viewed</span>
      <span id="clearRecentHistory" style="font-size: 0.8em; cursor: pointer; opacity: 0.8;" title="Clear History">
        <i class="fas fa-trash-alt"></i> Clear
      </span>
    </div>
  `;

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
};
