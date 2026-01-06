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
    // Enhanced Search UI with Date Pickers
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
    </div>
    <div id="driveFileContainer" class="status-msg">Searching for logs...</div>
  `;

    try {
      const rootId = await Drive.findFolderId(Drive.PATH_CONFIG.root);
      if (!rootId) {
        document.getElementById('driveFileContainer').innerHTML =
          `<div class="error-msg">Folder "${Drive.PATH_CONFIG.root}" not found.</div>`;
        return;
      }

      const subFolderId = await Drive.findFolderId(
        Drive.PATH_CONFIG.sub,
        rootId
      );
      if (!subFolderId) {
        document.getElementById('driveFileContainer').innerHTML =
          `<div class="error-msg">Subfolder "${Drive.PATH_CONFIG.sub}" not found.</div>`;
        return;
      }

      await Drive.fetchJsonFiles(
        subFolderId,
        document.getElementById('driveFileContainer')
      );
      this.initSearch();
    } catch (error) {
      Drive.handleApiError(
        error,
        document.getElementById('driveFileContainer')
      );
    }
  },

  initSearch() {
    const textInput = document.getElementById('driveSearchInput');
    const startInput = document.getElementById('driveDateStart');
    const endInput = document.getElementById('driveDateEnd');
    const clearBtn = document.getElementById('clearDriveFilters');

    const filterFiles = () => {
      const term = textInput.value.toLowerCase().trim();
      const startDate = startInput.value
        ? new Date(startInput.value).setHours(0, 0, 0, 0)
        : null;
      const endDate = endInput.value
        ? new Date(endInput.value).setHours(23, 59, 59, 999)
        : null;

      const cards = document.querySelectorAll('.drive-file-card');

      cards.forEach((card) => {
        const fileName =
          card.querySelector('.file-name-title')?.innerText.toLowerCase() || '';
        const dateStr = card.querySelector('.meta-item span')?.innerText || ''; // Format: DD-MM-YYYY HH:mm

        // Convert DD-MM-YYYY to a Date object for comparison
        const [d, m, y] = dateStr.split(' ')[0].split('-');
        const fileDate = new Date(y, m - 1, d).getTime();

        const matchesText = fileName.includes(term);
        const matchesDate =
          (!startDate || fileDate >= startDate) &&
          (!endDate || fileDate <= endDate);

        card.style.display = matchesText && matchesDate ? 'flex' : 'none';
      });
    };

    [textInput, startInput, endInput].forEach((el) =>
      el.addEventListener('input', filterFiles)
    );

    clearBtn?.addEventListener('click', () => {
      textInput.value = '';
      startInput.value = '';
      endInput.value = '';
      filterFiles();
    });
  },

  fetchJsonFiles: async (folderId, listEl) => {
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
      listEl.innerHTML = files.map((f) => Drive.renderFileRow(f)).join('');
    } catch (error) {
      Drive.handleApiError(error, listEl);
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
    const metadata = Drive.getFileMetadata(file.name);
    const date = metadata ? metadata.date : 'N/A';
    const length = metadata ? metadata.length : 'N/A';

    return `
    <div class="drive-file-card" onclick="Drive.loadFile('${file.name}','${file.id}', this)">
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
