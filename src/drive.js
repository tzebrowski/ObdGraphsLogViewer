import { DOM } from './config.js';
import { UI } from './ui.js';
import { dataProcessor } from './dataprocessor.js';
import { Alert } from './alert.js';
import { debounce } from './debounce.js';
import { messenger } from './bus.js';

class DriveManager {
  constructor() {
    this.activeLoadToken = 0;
    this.PATH_CONFIG = { root: 'mygiulia', sub: 'trips' };
    this.fileData = [];

    this._state = {
      sortOrder: 'desc',
      filters: {
        term: '',
        start: null,
        end: null,
        selectedMonth: '',
        selectedTag: '',
      },
      pagination: {
        currentPage: 1,
        itemsPerPage: 50,
      },
    };

    messenger.on('file:tag-added', async (data) => {
      await this._syncTagFromChart(data.fileId, data.tag);
    });

    messenger.on('chart:request-tags', (data) => {
      const fileItem = this.fileData.find(
        (f) => f.file.name === data.fileName || f.file.id === data.fileId
      );
      if (fileItem && fileItem.tags && fileItem.tags.length > 0) {
        fileItem.tags.forEach((tag) => {
          messenger.emit('drive:tag-added', {
            fileId: data.fileName,
            tag: tag,
          });
        });
      }
    });

    this.TEMPLATES = {
      searchInterface: () => `
        <div class="drv-search-container">
          <div style="display: flex; justify-content: flex-end; margin-bottom: 8px; padding: 0 4px;">
            <button id="driveRefreshBtn" class="btn btn-sm drv-sort-btn">
              <i class="fas fa-sync-alt"></i> Refresh View
            </button>
          </div>

          <div class="month-header drv-search-header" style="cursor: pointer; margin-top: 0; margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center;">
            <span><i class="fas fa-filter drv-icon-margin"></i> Filters & Search</span>
            <div style="display: flex; align-items: center; gap: 12px;">
              <span id="clearDriveFilters" class="drv-clear-history" title="Clear Filters" style="display: none; color: var(--brand-red);">
                <i class="fas fa-calendar-times"></i> Clear
              </span>
              <i class="fas fa-chevron-right toggle-icon"></i>
            </div>
          </div>
          <div class="drv-search-content drv-hidden" style="display: none; flex-direction: column; gap: 8px; margin-bottom: 8px;">
            <div class="drv-search-box">
              <i class="fas fa-search drv-search-icon"></i>
              <input type="text" id="driveSearchInput" placeholder="Search names or tags..." class="drv-search-input">
              <i class="fas fa-times-circle drv-clear-icon" id="clearDriveSearchText" title="Clear search"></i>
            </div>
            <div class="drv-date-filters" style="display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; gap: 8px;">
                <select id="driveMonthFilter" class="template-select" style="flex: 1; cursor: pointer;">
                  <option value="">-- All Months --</option>
                </select>
                <select id="driveTagFilter" class="template-select" style="flex: 1; cursor: pointer;">
                  <option value="">-- All Tags --</option>
                </select>
              </div>
              <div style="display: flex; align-items: center; gap: 5px; font-size: 0.85em;">
                <input type="date" id="driveDateStart" class="drv-date-input" style="flex: 1;">
                <span style="color: var(--text-muted);">to</span>
                <input type="date" id="driveDateEnd" class="drv-date-input" style="flex: 1;">
              </div>
            </div>
          </div>
          <div id="driveRecentSlot"></div>
          <div id="driveTopControlsSlot"></div>
        </div>
        <div id="driveFileContainer" class="status-msg">Searching for logs...</div>
      `,
      topControls: (
        current,
        totalPages,
        start,
        end,
        totalItems,
        sortOrder,
        pageSize
      ) => `
        <div style="display: flex; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border-color); margin-bottom: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="font-size: 0.75em; color: var(--text-muted); font-weight: bold;">
              Found ${totalItems} logs
            </div>
            <button id="driveSortToggle" class="btn btn-sm drv-sort-btn">
              <i class="fas fa-sort-amount-${sortOrder === 'desc' ? 'down' : 'up'}"></i> 
              ${sortOrder === 'desc' ? 'Newest' : 'Oldest'}
            </button>
          </div>
          ${
            totalItems > 0
              ? `
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8em;">
            <div style="display: flex; align-items: center; gap: 5px;">
              <span style="color: var(--text-muted);">Show:</span>
              <select id="drivePageSize" style="padding: 2px 4px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-color); cursor: pointer;">
                <option value="10" ${pageSize === 10 ? 'selected' : ''}>10</option>
                <option value="25" ${pageSize === 25 ? 'selected' : ''}>25</option>
                <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
                <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
              </select>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <button id="prevPageBtn" class="btn btn-sm" style="padding: 2px 8px;" ${current === 1 ? 'disabled style="opacity:0.5"' : ''}><i class="fas fa-chevron-left"></i></button>
              <span class="drv-page-info">${start}-${end}</span>
              <button id="nextPageBtn" class="btn btn-sm" style="padding: 2px 8px;" ${current === totalPages || totalPages === 0 ? 'disabled style="opacity:0.5"' : ''}><i class="fas fa-chevron-right"></i></button>
            </div>
          </div>
          `
              : ''
          }
        </div>
      `,
      fileCard: (file, meta, tags = []) => `
        <div class="drive-file-card" onclick="loadFile('${file.name}','${file.id}', this)">
          <div class="file-card-icon"><i class="fab fa-google-drive"></i></div>
          <div class="file-card-body">
            <div class="file-name-title">${file.name}</div>
            <div class="file-card-meta-grid">
              <div class="meta-item"><i class="far fa-calendar-alt"></i> <span>${this.formatDate(meta?.date)}</span></div>
              <div class="meta-item"><i class="fas fa-history"></i> <span>${this.formatDuration(meta?.length)}</span></div>
              <div class="meta-item"><i class="fas fa-hdd"></i> <span>${file.size ? (file.size / 1024).toFixed(0) : '?'} KB</span></div>
            </div>
            <div class="file-card-tags" style="margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">
              ${tags.map((t) => `<span class="existing-tag-pill" data-tag="${t}" title="Click to filter by this tag" style="cursor: pointer; ${this._getTagStyle(t)} padding: 2px 8px; border-radius: 12px; font-size: 0.7em; font-weight: 500; text-transform: capitalize; transition: filter 0.2s;" onmouseover="this.style.filter='brightness(1.2)'" onmouseout="this.style.filter='none'">${t}</span>`).join('')}
              <span class="add-tag-btn" data-id="${file.id}" style="background: transparent; border: 1px dashed var(--text-muted); color: var(--text-muted); padding: 2px 8px; border-radius: 12px; font-size: 0.7em; cursor: pointer; transition: color 0.2s;">
                <i class="fas fa-plus"></i> Tag
              </span>
              <span class="share-file-btn" data-id="${file.id}" style="background: transparent; border: 1px solid #4285f4; color: #4285f4; padding: 2px 8px; border-radius: 12px; font-size: 0.7em; cursor: pointer; transition: background 0.2s; margin-left: auto;" onmouseover="this.style.background='#4285f415'" onmouseout="this.style.background='transparent'" title="Create public app link and copy">
                <i class="fas fa-link"></i> Get Link
              </span>
            </div>
          </div>
        </div>
      `,
      monthGroup: (monthYear) => `
        <div class="drv-month-separator" style="padding: 4px 12px; font-size: 0.75em; font-weight: bold; color: var(--text-muted); border-bottom: 1px solid var(--border-color); margin: 15px 0 5px 0; text-transform: uppercase;">
          <span>${monthYear}</span>
        </div>
        <div class="month-list"></div>
      `,
      recentSectionHeader: () => `
        <div class="month-header drv-recent-header" style="cursor: pointer; margin-bottom: 5px;">
          <span><i class="fas fa-history drv-icon-margin"></i> Recently Viewed</span>
          <div style="display: flex; align-items: center; gap: 12px;">
            <span id="clearRecentHistory" class="drv-clear-history" title="Clear History">
              <i class="fas fa-trash-alt"></i> Clear
            </span>
            <i class="fas fa-chevron-right toggle-icon"></i>
          </div>
        </div>
        <div class="recent-list-container drv-hidden"></div>
      `,
    };
  }

  _getTagStyle(tag) {
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
      hash = tag.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `background: hsla(${hue}, 70%, 50%, 0.15); color: var(--text-color); border: 1px solid hsla(${hue}, 70%, 50%, 0.3);`;
  }

  formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return 'N/A';
    const sec = parseInt(seconds, 10);
    if (sec < 60) return `${sec}s`;

    const m = Math.floor(sec / 60);
    const s = sec % 60;

    if (m < 60) return `${m}m ${s}s`;

    const h = Math.floor(m / 60);
    const remainingM = m % 60;
    return `${h}h ${remainingM}m`;
  }

  formatDate(isoString) {
    if (!isoString || isoString === 'Unknown') return 'N/A';
    try {
      const d = new Date(isoString);
      return d.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
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

    listEl.innerHTML = '<div class="status-msg">Searching for logs...</div>';
    this.fileData = [];

    let pageToken = null;
    let hasMore = true;

    try {
      while (hasMore) {
        const res = await gapi.client.drive.files.list({
          pageSize: 100,
          fields:
            'nextPageToken, files(id, name, size, modifiedTime, appProperties)',
          q: `'${folderId}' in parents and (name contains '.json' or name contains '.gz' or name contains '.jsonl') and trashed=false`,
          orderBy: 'modifiedTime desc',
          pageToken: pageToken,
        });

        const files = res.result.files || [];
        const processedFiles = files.map((f) => {
          let tags = [];
          if (f.appProperties && f.appProperties.tags) {
            tags = f.appProperties.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean);
          }
          return {
            file: f,
            meta: this.getFileMetadata(f.name),
            timestamp: this.extractTimestamp(f.name),
            tags: tags,
          };
        });

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

      this.populateDropdowns();
      this.initSearch();
    } catch (error) {
      this.handleApiError(error, listEl);
    }
  }

  populateDropdowns() {
    const monthSelect = document.getElementById('driveMonthFilter');
    const tagSelect = document.getElementById('driveTagFilter');

    if (!monthSelect || !tagSelect) return;

    const monthsSet = new Set();
    const tagsSet = new Set();

    this.fileData.forEach((item) => {
      const dateObj = new Date(item.timestamp);
      if (!isNaN(dateObj.getTime())) {
        const monthYear = dateObj.toLocaleString('en-US', {
          month: 'long',
          year: 'numeric',
        });
        monthsSet.add(monthYear);
      }

      if (item.tags) {
        item.tags.forEach((t) => tagsSet.add(t));
      }
    });

    const currentMonth = monthSelect.value;
    monthSelect.innerHTML = '<option value="">-- All Months --</option>';
    Array.from(monthsSet)
      .sort((a, b) => new Date(b) - new Date(a))
      .forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        if (m === currentMonth) opt.selected = true;
        monthSelect.appendChild(opt);
      });

    const currentTag = tagSelect.value;
    tagSelect.innerHTML = '<option value="">-- All Tags --</option>';
    Array.from(tagsSet)
      .sort()
      .forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
        if (t === currentTag) opt.selected = true;
        tagSelect.appendChild(opt);
      });
  }

  async promptAddTag(fileId) {
    const newTag = prompt('Enter a new tag (e.g., Track, Commute, Rain):');
    if (!newTag || !newTag.trim()) return;

    const tagClean = newTag.trim().toLowerCase();

    const fileItem = this.fileData.find((f) => f.file.id === fileId);
    if (!fileItem) return;

    const currentTags = fileItem.tags || [];
    if (currentTags.includes(tagClean)) {
      Alert.showAlert('This tag is already applied to this log.');
      return;
    }

    const updatedTags = [...currentTags, tagClean];
    const tagsString = updatedTags.join(',');

    fileItem.tags = updatedTags;
    if (!fileItem.file.appProperties) fileItem.file.appProperties = {};
    fileItem.file.appProperties.tags = tagsString;

    this.populateDropdowns();
    this.refreshUI();

    messenger.emit('drive:tag-added', {
      fileId: fileItem.file.name,
      tag: tagClean,
    });

    try {
      await gapi.client.drive.files.update({
        fileId: fileId,
        appProperties: { tags: tagsString },
      });
    } catch (error) {
      console.error('Error saving tag:', error);
      fileItem.tags = currentTags;
      fileItem.file.appProperties.tags = currentTags.join(',');
      this.populateDropdowns();
      this.refreshUI();
      Alert.showAlert(`Failed to save tag to Google Drive: ${error.message}`);
    }
  }

  async _syncTagFromChart(fileIdentifier, tag) {
    const fileItem = this.fileData.find(
      (f) => f.file.id === fileIdentifier || f.file.name === fileIdentifier
    );
    if (!fileItem) return;

    const currentTags = fileItem.tags || [];
    if (currentTags.includes(tag)) return;

    const updatedTags = [...currentTags, tag];
    const tagsString = updatedTags.join(',');

    fileItem.tags = updatedTags;
    if (!fileItem.file.appProperties) fileItem.file.appProperties = {};
    fileItem.file.appProperties.tags = tagsString;

    this.populateDropdowns();
    this.refreshUI();

    try {
      await gapi.client.drive.files.update({
        fileId: fileItem.file.id,
        appProperties: { tags: tagsString },
      });
    } catch (error) {
      console.error('Drive API Error syncing tag from chart:', error);
      fileItem.tags = currentTags;
      fileItem.file.appProperties.tags = currentTags.join(',');
      this.populateDropdowns();
      this.refreshUI();
    }
  }

  async makeFilePublicAndCopyLink(fileId) {
    try {
      UI.setLoading(true, 'Generating shareable app link...');
      
      await gapi.client.drive.permissions.create({
        fileId: fileId,
        resource: {
          role: 'reader',
          type: 'anyone'
        }
      });

      const baseUrl = window.location.origin + window.location.pathname;
      const appLink = `${baseUrl}?fileId=${fileId}#analyzer`;

      if (navigator.clipboard) {
        await navigator.clipboard.writeText(appLink);
        Alert.showAlert('Success! App link copied to your clipboard. Anyone with this link can view the log in the app.');
      } else {
        Alert.showAlert(`Success! Shareable Link:\n${appLink}`);
      }
      
    } catch (error) {
      console.error('Error making file public:', error);
      Alert.showAlert(`Failed to create public link: ${error.message}`);
    } finally {
      UI.setLoading(false);
    }
  }

  /**
   * Loads an authenticated file from the verified user's layout list
   */
  async loadFile(fileName, id, element) {
    document
      .querySelectorAll('.drive-file-card')
      .forEach((r) => r.classList.remove('active'));
    element.classList.add('active');

    let recent = JSON.parse(localStorage.getItem('recent_logs') || '[]');
    recent = [id, ...recent.filter((i) => i !== id)].slice(0, 3);
    localStorage.setItem('recent_logs', JSON.stringify(recent));

    const slot = document.getElementById('driveRecentSlot');
    if (slot) {
      const oldRecent = slot.querySelector('.recent-section');
      if (oldRecent) oldRecent.remove();

      const isFiltering =
        this._state.filters.term ||
        this._state.filters.selectedMonth ||
        this._state.filters.selectedTag ||
        this._state.filters.start ||
        this._state.filters.end;

      if (!isFiltering) {
        this.renderRecentSection(slot, true);
      }
    }

    const currentToken = ++this.activeLoadToken;
    UI.setLoading(true, 'Downloading log...', () => {
      this.activeLoadToken++;
      UI.setLoading(false);
    });

    try {
      let dataToProcess;
      const tokenObj = window.gapi && gapi.client ? gapi.client.getToken() : null;

      if (!tokenObj) throw new Error("GAPI client session token not found.");

      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
        headers: { 'Authorization': `Bearer ${tokenObj.access_token}` }
      });
      
      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
      if (currentToken !== this.activeLoadToken) return;

      if (fileName.endsWith('.gz')) {
        const blob = await response.blob();
        const ds = new DecompressionStream('gzip');
        const decompressedStream = blob.stream().pipeThrough(ds);
        dataToProcess = JSON.parse(await new Response(decompressedStream).text());
      } else {
        dataToProcess = await response.json();
      }

      const fileItem = this.fileData.find((f) => f.file.id === id);
      if (fileItem && fileItem.tags) {
        dataToProcess._injectedTags = fileItem.tags;
      }
      
      dataProcessor.process(dataToProcess, fileName);
      
    } catch (error) {
      if (currentToken === this.activeLoadToken) {
        console.error('Download error:', error);
        Alert.showAlert(`Download Error: ${error.message}`);
      }
    } finally {
      if (currentToken === this.activeLoadToken) {
        UI.setLoading(false);
      }
    }
  }

  initSearch() {
    const searchHeader = document.querySelector('.drv-search-header');
    const searchContent = document.querySelector('.drv-search-content');
    if (searchHeader && searchContent) {
      searchHeader.onclick = (e) => {
        if (e.target.closest('#driveRefreshBtn')) return;

        const isHidden = searchContent.style.display === 'none';
        if (isHidden) {
          searchContent.style.display = 'flex';
          searchContent.classList.remove('drv-hidden');
          searchHeader.querySelector('.toggle-icon').className =
            'fas fa-chevron-down toggle-icon';
        } else {
          searchContent.style.display = 'none';
          searchContent.classList.add('drv-hidden');
          searchHeader.querySelector('.toggle-icon').className =
            'fas fa-chevron-right toggle-icon';
        }
      };
    }

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
        selectedMonth: document.getElementById('driveMonthFilter')?.value || '',
        selectedTag: document.getElementById('driveTagFilter')?.value || '',
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
      if (clearTextBtn) {
        clearTextBtn.style.display = this._state.filters.term
          ? 'block'
          : 'none';
      }

      const clearFiltersBtn = document.getElementById('clearDriveFilters');
      if (clearFiltersBtn) {
        const hasActiveFilters =
          this._state.filters.term ||
          this._state.filters.selectedMonth ||
          this._state.filters.selectedTag ||
          this._state.filters.start ||
          this._state.filters.end;
        clearFiltersBtn.style.display = hasActiveFilters ? 'block' : 'none';
      }

      this._state.pagination.currentPage = 1;

      if (immediate) this.refreshUI();
      else debouncedRefresh();
    };

    const handleCardAction = (e) => {
      const addBtn = e.target.closest('.add-tag-btn');
      if (addBtn) {
        e.stopPropagation();
        const fileId = addBtn.dataset.id;
        this.promptAddTag(fileId);
        return;
      }

      const shareBtn = e.target.closest('.share-file-btn');
      if (shareBtn) {
        e.stopPropagation();
        const fileId = shareBtn.dataset.id;
        
        if (fileId) {
          this.makeFilePublicAndCopyLink(fileId);
        } else {
          Alert.showAlert('Cannot share this file: Missing File ID.');
        }
        return;
      }

      const existingTag = e.target.closest('.existing-tag-pill');
      if (existingTag) {
        e.stopPropagation();
        const tagValue = existingTag.dataset.tag;
        const tagFilter = document.getElementById('driveTagFilter');

        if (tagFilter) {
          tagFilter.value = tagValue;
          updateHandler(true);

          if (searchContent && searchContent.style.display === 'none') {
            searchHeader.click();
          }
        }
      }
    };

    const container = document.getElementById('driveFileContainer');
    const recentSlot = document.getElementById('driveRecentSlot');
    if (container) container.addEventListener('click', handleCardAction);
    if (recentSlot) recentSlot.addEventListener('click', handleCardAction);

    safeAddEvent('clearDriveSearchText', 'click', () => {
      const input = document.getElementById('driveSearchInput');
      if (input) input.value = '';
      updateHandler(true);
    });

    safeAddEvent('clearDriveFilters', 'click', (e) => {
      e.stopPropagation();
      const input = document.getElementById('driveSearchInput');
      const selectMonth = document.getElementById('driveMonthFilter');
      const selectTag = document.getElementById('driveTagFilter');
      const start = document.getElementById('driveDateStart');
      const end = document.getElementById('driveDateEnd');
      if (input) input.value = '';
      if (selectMonth) selectMonth.value = '';
      if (selectTag) selectTag.value = '';
      if (start) start.value = '';
      if (end) end.value = '';
      updateHandler(true);
    });

    safeAddEvent('driveRefreshBtn', 'click', (e) => {
      e.stopPropagation();
      const icon = e.currentTarget.querySelector('.fa-sync-alt');
      if (icon) icon.classList.add('fa-spin');
      this.listFiles();
    });

    safeAddEvent('driveSearchInput', 'input', () => updateHandler(false));
    safeAddEvent('driveMonthFilter', 'change', () => updateHandler(true));
    safeAddEvent('driveTagFilter', 'change', () => updateHandler(true));
    safeAddEvent('driveDateStart', 'input', () => updateHandler(true));
    safeAddEvent('driveDateEnd', 'input', () => updateHandler(true));

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

    const slot = document.getElementById('driveTopControlsSlot');
    if (slot) {
      const start = filtered.length === 0 ? 0 : startIdx + 1;
      const end = Math.min(
        this._state.pagination.currentPage * itemsPerPage,
        filtered.length
      );

      slot.innerHTML = this.TEMPLATES.topControls(
        this._state.pagination.currentPage,
        totalPages,
        start,
        end,
        filtered.length,
        this._state.sortOrder,
        itemsPerPage
      );

      slot.querySelector('#driveSortToggle')?.addEventListener('click', () => {
        this._state.sortOrder =
          this._state.sortOrder === 'desc' ? 'asc' : 'desc';
        this.refreshUI();
      });

      slot.querySelector('#drivePageSize')?.addEventListener('change', (e) => {
        this._state.pagination.itemsPerPage = parseInt(e.target.value, 10);
        this._state.pagination.currentPage = 1;
        this.refreshUI();
      });

      slot.querySelector('#prevPageBtn')?.addEventListener('click', () => {
        if (this._state.pagination.currentPage > 1) {
          this._state.pagination.currentPage--;
          this.refreshUI();
        }
      });

      slot.querySelector('#nextPageBtn')?.addEventListener('click', () => {
        if (this._state.pagination.currentPage < totalPages) {
          this._state.pagination.currentPage++;
          this.refreshUI();
        }
      });
    }

    const recentSlot = document.getElementById('driveRecentSlot');
    if (recentSlot) {
      recentSlot.innerHTML = '';
      const isFiltering =
        this._state.filters.term ||
        this._state.filters.selectedMonth ||
        this._state.filters.selectedTag ||
        this._state.filters.start ||
        this._state.filters.end;

      if (!isFiltering) {
        this.renderRecentSection(recentSlot);
      }
    }

    container.innerHTML = '';
    this.renderGroupedCards(container, paginatedItems);
  }

  _applyFilters(item) {
    const { term, selectedMonth, selectedTag, start, end } =
      this._state.filters;
    const fileDate = item.timestamp;
    const name = item.file.name.toLowerCase();

    const matchesText =
      name.includes(term) ||
      (item.tags && item.tags.some((t) => t.toLowerCase().includes(term)));
    const matchesDateRange =
      (!start || fileDate >= start) && (!end || fileDate <= end);

    let matchesMonth = true;
    if (selectedMonth) {
      const dateObj = new Date(item.timestamp);
      const itemMonthYear = dateObj.toLocaleString('en-US', {
        month: 'long',
        year: 'numeric',
      });
      matchesMonth = itemMonthYear === selectedMonth;
    }

    let matchesTag = true;
    if (selectedTag) {
      matchesTag = item.tags && item.tags.includes(selectedTag);
    }

    return matchesText && matchesDateRange && matchesMonth && matchesTag;
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
      tempDiv.innerHTML = this.TEMPLATES.fileCard(
        item.file,
        item.meta,
        item.tags
      );
      const cardEl = tempDiv.firstElementChild;

      currentGroup.querySelector('.month-list').appendChild(cardEl);
    });
  }

  renderRecentSection(container, prepend = false) {
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
    const header = section.querySelector('.drv-recent-header');

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

    recentItems.forEach((item) => {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = this.TEMPLATES.fileCard(
        item.file,
        item.meta,
        item.tags
      );
      const card = tempDiv.firstElementChild;
      card.classList.add('drv-recent-card');
      list.appendChild(card);
    });

    if (prepend) {
      container.prepend(section);
    } else {
      container.appendChild(section);
    }

    document
      .getElementById('clearRecentHistory')
      ?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.clearRecentHistory();
      });
  }

  createMonthGroup(monthYear) {
    const group = document.createElement('div');
    group.className = 'month-group';
    group.innerHTML = this.TEMPLATES.monthGroup(monthYear);
    return group;
  }

  getFileMetadata(fileName) {
    const match = fileName.match(/-(\d+)-(\d+)(?:\.[a-zA-Z0-9]+)+$/);
    if (!match) return { date: 'Unknown', length: '?' };

    const date = new Date(parseInt(match[1]));

    return { date: date.toISOString(), length: match[2] };
  }

  extractTimestamp(fileName) {
    const match = fileName.match(/-(\d+)-(\d+)(?:\.[a-zA-Z0-9]+)+$/);
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