import { DOM } from './config.js';
import { UI } from './ui.js';
import { DataProcessor } from './dataprocesssor.js';
import { Alert } from './alert.js';

export const Drive = {
  activeLoadToken: 0,

  PATH_CONFIG: {
    root: 'mygiulia',
    sub: 'trips',
  },

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
    listEl.innerHTML = `
    <div class="drive-search-container" style="padding: 10px; position: sticky; top: 0; background: var(--sidebar-bg); z-index: 5; border-bottom: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 8px;">
      <div style="position: relative; display: flex; align-items: center;">
        <i class="fas fa-search" style="position: absolute; left: 10px; color: var(--text-muted); font-size: 0.9em;"></i>
        <input type="text" id="driveSearchInput" placeholder="Filter by name..." 
              style="width: 100%; padding: 8px 30px; border-radius: 6px; border: 1px solid var(--border-color); font-size: 0.9em; box-sizing: border-box;">
      </div>
      <div style="display: flex; align-items: center; gap: 5px; font-size: 0.75em;">
        <input type="date" id="driveDateStart" style="flex: 1; padding: 4px; border-radius: 4px; border: 1px solid var(--border-color);">
        <span>to</span>
        <input type="date" id="driveDateEnd" style="flex: 1; padding: 4px; border-radius: 4px; border: 1px solid var(--border-color);">
        <button id="clearDriveFilters" class="btn-icon" title="Clear Filters"><i class="fas fa-times"></i></button>
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

    try {
      const rootId = await this.findFolderId(Drive.PATH_CONFIG.root);
      if (!rootId) {
        document.getElementById('driveFileContainer').innerHTML =
          `<div class="error-msg">Folder "${Drive.PATH_CONFIG.root}" not found.</div>`;
        return;
      }

      const subFolderId = await this.findFolderId(
        Drive.PATH_CONFIG.sub,
        rootId
      );
      if (!subFolderId) {
        document.getElementById('driveFileContainer').innerHTML =
          `<div class="error-msg">Subfolder "${Drive.PATH_CONFIG.sub}" not found.</div>`;
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

  parseDateFromCard: (card) => {
    const dateStr = card.querySelector('.meta-item span')?.innerText || '';
    if (!dateStr || dateStr === 'N/A') return 0;
    const [datePart, timePart] = dateStr.split(' ');
    const [d, m, y] = datePart.split('-');
    const [hh, mm] = timePart.split(':');
    return new Date(y, m - 1, d, hh, mm).getTime();
  },

  initSearch() {
    const textInput = document.getElementById('driveSearchInput');
    const startInput = document.getElementById('driveDateStart');
    const endInput = document.getElementById('driveDateEnd');
    const clearBtn = document.getElementById('clearDriveFilters');
    const sortBtn = document.getElementById('driveSortToggle');

    let currentSortOrder = 'desc';

    const filterAndSortFiles = () => {
      const term = textInput.value.toLowerCase().trim();
      const startDate = startInput.value
        ? new Date(startInput.value).setHours(0, 0, 0, 0)
        : null;
      const endDate = endInput.value
        ? new Date(endInput.value).setHours(23, 59, 59, 999)
        : null;

      const container = document.getElementById('driveFileContainer');
      const cards = Array.from(container.querySelectorAll('.drive-file-card'));
      let matchCount = 0;

      cards.forEach((card) => {
        const fileName =
          card.querySelector('.file-name-title')?.innerText.toLowerCase() || '';
        const dateStr = card.querySelector('.meta-item span')?.innerText || '';
        const [d, m, y] = dateStr.split(' ')[0].split('-');
        const fileDate = new Date(y, m - 1, d).getTime();

        const matchesText = fileName.includes(term);
        const matchesDate =
          (!startDate || fileDate >= startDate) &&
          (!endDate || fileDate <= endDate);

        const isVisible = matchesText && matchesDate;
        card.style.display = isVisible ? 'flex' : 'none';
        if (isVisible) matchCount++;
      });

      cards.sort((a, b) => {
        const dateA = Drive.parseDateFromCard(a);
        const dateB = Drive.parseDateFromCard(b);
        return currentSortOrder === 'desc' ? dateB - dateA : dateA - dateB;
      });

      container.querySelectorAll('.month-group').forEach((g) => g.remove());
      let currentGroup = null;
      let lastMonth = '';

      cards.forEach((card) => {
        if (card.style.display !== 'none') {
          const dateStr =
            card.querySelector('.meta-item span')?.innerText || '';
          const [d, m, y] = dateStr.split(' ')[0].split('-');
          const monthYear = new Date(y, m - 1, d).toLocaleString('default', {
            month: 'long',
            year: 'numeric',
          });

          if (monthYear !== lastMonth) {
            currentGroup = document.createElement('div');
            currentGroup.className = 'month-group';

            const header = document.createElement('div');
            header.className = 'month-header';
            header.style.cssText = `
            padding: 8px 12px; font-size: 0.75em; font-weight: 800; color: #e31837; 
            background: rgba(227, 24, 55, 0.05); border-left: 3px solid #e31837;
            margin: 10px 0 5px 0; text-transform: uppercase; cursor: pointer;
            display: flex; justify-content: space-between; align-items: center;
          `;
            header.innerHTML = `<span>${monthYear}</span> <i class="fas fa-chevron-down toggle-icon"></i>`;

            const list = document.createElement('div');
            list.className = 'month-list';

            header.onclick = () => {
              const isCollapsed = list.style.display === 'none';
              list.style.display = isCollapsed ? 'block' : 'none';
              header.querySelector('.toggle-icon').className = isCollapsed
                ? 'fas fa-chevron-down toggle-icon'
                : 'fas fa-chevron-right toggle-icon';
            };

            currentGroup.appendChild(header);
            currentGroup.appendChild(list);
            container.appendChild(currentGroup);
            lastMonth = monthYear;
          }
          currentGroup.querySelector('.month-list').appendChild(card);
        }
      });

      const countEl = document.getElementById('driveResultCount');
      if (countEl) {
        countEl.innerText = `Showing ${matchCount} of ${cards.length} logs`;
      }
    };

    [textInput, startInput, endInput].forEach((el) =>
      el.addEventListener('input', filterAndSortFiles)
    );
    sortBtn?.addEventListener('click', () => {
      currentSortOrder = currentSortOrder === 'desc' ? 'asc' : 'desc';
      sortBtn.innerHTML =
        currentSortOrder === 'desc'
          ? '<i class="fas fa-sort-amount-down"></i> Newest'
          : '<i class="fas fa-sort-amount-up"></i> Oldest';
      filterAndSortFiles();
    });

    clearBtn?.addEventListener('click', () => {
      textInput.value = '';
      startInput.value = '';
      endInput.value = '';
      filterAndSortFiles();
    });

    filterAndSortFiles();
  },

  async fetchJsonFiles(folderId, listEl) {
    try {
      const res = await gapi.client.drive.files.list({
        pageSize: 25,
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
    } catch (error) {
      this.handleApiError(error, listEl);
    }
  },

  getFileMetadata(fileName) {
    const regex = /-(\d+)-(\d+)\.json$/;
    const match = fileName.match(regex);

    if (!match) return null;

    const date = new Date(parseInt(match[1]));
    const pad = (num) => num.toString().padStart(2, '0');

    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1);
    const year = date.getFullYear();
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());

    const formattedDate = `${day}-${month}-${year} ${hours}:${minutes}`;

    return {
      date: formattedDate,
      length: match[2],
    };
  },

  renderFileRow(file) {
    const size = file.size ? (file.size / 1024).toFixed(0) + ' KB' : 'Unknown';
    const metadata = this.getFileMetadata(file.name);
    const date = metadata ? metadata.date : 'N/A';
    const length = metadata ? metadata.length : 'N/A';

    return `
    <div class="drive-file-card" onclick="loadFile('${file.name}','${file.id}', this)">
      <div class="file-card-icon">
        <i class="fab fa-google-drive"></i>
      </div>
      <div class="file-card-body">
        <div class="file-name-title">${file.name}</div>
        <div class="file-card-meta-grid">
          <div class="meta-item">
            <i class="far fa-calendar-alt"></i> <span>${date}</span>
          </div>
          <div class="meta-item">
            <i class="fas fa-history"></i> <span>${length}s</span>
          </div>
          <div class="meta-item">
            <i class="fas fa-hdd"></i> <span>${size}</span>
          </div>
        </div>
      </div>
    </div>`;
  },

  async loadFile(fileName, id, element) {
    if (element) {
      document
        .querySelectorAll('.drive-file-row')
        .forEach((r) => r.classList.remove('active'));
      element.classList.add('active');
    }

    const currentToken = ++this.activeLoadToken;
    const cancelTask = () => {
      this.activeLoadToken++;
      UI.setLoading(false);
      const fileInfo = DOM.get('fileInfo');
      if (fileInfo) fileInfo.innerText = 'Load cancelled.';
    };

    UI.setLoading(true, 'Fetching from Drive...', cancelTask);
    const fileInfo = DOM.get('fileInfo');
    if (fileInfo) fileInfo.innerText = 'Downloading...';

    try {
      const response = await gapi.client.drive.files.get({
        fileId: id,
        alt: 'media',
      });
      if (currentToken !== this.activeLoadToken) return;

      UI.setLoading(true, 'Processing Log...', null);

      setTimeout(() => {
        if (currentToken !== this.activeLoadToken) return;
        try {
          DataProcessor.process(response.result, fileName);
          const fileInfoFinish = DOM.get('fileInfo');
          if (fileInfoFinish)
            fileInfoFinish.innerText = 'Drive log loaded successfully.';
        } catch (err) {
          console.error(
            `The file content is not a valid log format. Error ${err.message}`
          );
          Alert.showAlert('The file content is not a valid log format.');
        } finally {
          UI.setLoading(false);
        }
      }, 50);
    } catch (error) {
      if (currentToken !== this.activeLoadToken) return;
      UI.setLoading(false);
      Alert.showAlert(
        `Drive Error: ${error.result?.error?.message || error.message}`
      );
    }
  },

  handleApiError(error, listEl) {
    console.error('Drive API Error:', error);
    if (error.status === 401 || error.status === 403) {
      gapi.client.setToken(null);
      if (listEl)
        listEl.innerHTML =
          '<div class="error-msg">Session expired. Please click "Drive Scan" again.</div>';
    } else {
      if (listEl)
        listEl.innerHTML = `<div class="error-msg">Search failed: ${error.message || 'Unknown error'}</div>`;
    }
  },
};
