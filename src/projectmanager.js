import { AppState, EVENTS } from './config.js';
import { mathChannels } from './mathchannels.js';
import { messenger } from './bus.js';
import { dbManager } from './dbmanager.js';

class ProjectManager {
  #currentProject;
  #isReplaying;
  #libraryContainer;

  constructor() {
    this.#currentProject =
      this.#loadFromStorage() || this.#createEmptyProject();
    this.#isReplaying = false;
    this.#libraryContainer = null;

    dbManager.init().then(async () => {
      await this.#hydrateActiveFiles();
      this.renderLibrary();
    });

    messenger.on('action:log', (data) => {
      this.logAction(data.type, data.description, data.payload, data.fileIndex);
    });

    messenger.on('dataprocessor:batch-load-completed', () =>
      this.renderLibrary()
    );
  }

  initLibraryUI(containerId) {
    this.#libraryContainer = document.getElementById(containerId);
    this.renderLibrary();
  }

  async renderLibrary() {
    if (!this.#libraryContainer) return;

    const allStoredFiles = await dbManager.getAllFiles();
    allStoredFiles.sort((a, b) => b.addedAt - a.addedAt);

    this.#libraryContainer.innerHTML = `
      <div class="pm-library-header">
        <h4 class="pm-library-title">
          Library <span class="pm-library-count">(${allStoredFiles.length})</span>
        </h4>
        <button id="lib-purge-btn" class="btn-icon-text pm-btn-purge">
          <i class="fas fa-trash-alt"></i> Purge
        </button>
      </div>
      
      <div class="pm-library-list custom-scrollbar">
        ${
          allStoredFiles.length === 0
            ? '<div class="pm-library-empty">No logs saved in library.</div>'
            : allStoredFiles
                .map((file) => this.#generateLibraryRow(file))
                .join('')
        }
      </div>
    `;

    this.#attachLibraryListeners();
  }

  #generateLibraryRow(file) {
    const isActive = AppState.files.some((f) => f.dbId === file.id);
    const date = new Date(file.addedAt).toLocaleDateString();
    const duration = file.duration ? (file.duration / 60).toFixed(1) : '0.0';

    const rowClass = isActive ? 'pm-library-item pm-active' : 'pm-library-item';
    const iconClass = isActive ? 'fa-chart-line' : 'fa-file-alt';

    let actionBtnHtml = '';
    if (isActive) {
      actionBtnHtml = `<span class="pm-status-loaded"><i class="fas fa-check"></i> Loaded</span>`;
    } else {
      actionBtnHtml = `
            <button class="pm-add-btn btn-icon" data-id="${file.id}" title="Load into Project">
                <i class="fas fa-plus"></i>
            </button>`;
    }

    return `
      <div class="${rowClass}">
        
        <div class="pm-col-left">
            <div class="pm-icon">
                <i class="fas ${iconClass}"></i>
            </div>
            <div class="pm-info">
                <span class="pm-name" title="${file.name}">
                    ${file.name}
                </span>
                <span class="pm-meta">
                    ${date} • ${duration} min • ${(file.size || 0).toLocaleString()} pts
                </span>
            </div>
        </div>

        <div class="pm-col-right">
            ${actionBtnHtml}
            <button class="pm-del-btn btn-icon" data-id="${file.id}" title="Delete Permanently">
                <i class="fas fa-times"></i>
            </button>
        </div>

      </div>
    `;
  }

  #attachLibraryListeners() {
    this.#libraryContainer.querySelectorAll('.pm-add-btn').forEach((btn) => {
      btn.onclick = async (e) => {
        const id = parseInt(e.target.dataset.id);
        await this.loadFromLibrary(id);
      };
    });

    this.#libraryContainer.querySelectorAll('.pm-del-btn').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (confirm('Permanently delete this log?')) {
          const id = parseInt(e.target.dataset.id);
          await dbManager.deleteFile(id);

          const activeIndex = AppState.files.findIndex((f) => f.dbId === id);
          if (activeIndex !== -1) {
            messenger.emit(EVENTS.FILE_REMOVED, { index: activeIndex });
            AppState.files.splice(activeIndex, 1);
          }
          this.renderLibrary();
        }
      };
    });

    const purgeBtn = document.getElementById('lib-purge-btn');
    if (purgeBtn) {
      purgeBtn.onclick = async () => {
        if (
          confirm(
            'WARNING: This will delete ALL logs from the database. Continue?'
          )
        ) {
          await dbManager.clearAll();
          window.location.reload();
        }
      };
    }
  }

  async loadFromLibrary(dbId) {
    messenger.emit('ui:set-loading', { message: 'Loading from Library...' });

    const signals = await dbManager.getFileSignals(dbId);
    const allFiles = await dbManager.getAllFiles();
    const meta = allFiles.find((f) => f.id === dbId);

    if (signals && meta) {
      const fileEntry = {
        name: meta.name,
        dbId: meta.id,
        signals: signals,
        startTime: meta.startTime || 0,
        duration: meta.duration || 0,
        availableSignals: meta.availableSignals || [],
        size: meta.size,
        metadata: meta.metadata,
      };

      AppState.files.push(fileEntry);

      this.registerFile(fileEntry);

      messenger.emit('dataprocessor:batch-load-completed', {});
      this.renderLibrary();
    }
  }

  async #hydrateActiveFiles() {
    const activeResources = this.#currentProject.resources.filter(
      (r) => r.isActive
    );
    if (activeResources.length === 0) return;

    messenger.emit('ui:set-loading', { message: 'Restoring Session...' });

    for (const res of activeResources) {
      if (res.dbId && !AppState.files.some((f) => f.dbId === res.dbId)) {
        const signals = await dbManager.getFileSignals(res.dbId);
        const allFiles = await dbManager.getAllFiles();
        const meta = allFiles.find((f) => f.id === res.dbId);

        if (signals && meta) {
          AppState.files.push({
            name: meta.name,
            dbId: meta.id,
            signals: signals,
            startTime: meta.startTime || 0,
            duration: meta.duration || 0,
            availableSignals: meta.availableSignals || [],
            size: meta.size,
            metadata: meta.metadata,
          });
        }
      }
    }

    if (AppState.files.length > 0) {
      messenger.emit('dataprocessor:batch-load-completed', {});
    }
  }

  registerFile(file) {
    const existingResource = this.#findResource(file.name, file.size);

    if (existingResource) {
      existingResource.isActive = true;
      existingResource.dbId = file.dbId;
      existingResource.lastAccessed = Date.now();

      let newFileIndex = AppState.files.findIndex((f) => f.name === file.name);
      if (newFileIndex === -1) newFileIndex = AppState.files.length;

      if (newFileIndex !== -1) {
        this.#currentProject.history.forEach((item) => {
          if (item.resourceId === existingResource.fileId) {
            item.targetFileIndex = newFileIndex;
            item.description = item.description.replace('(Archived) ', '');
          }
        });
      }
    } else {
      const resource = {
        fileId: crypto.randomUUID(),
        dbId: file.dbId,
        fileName: file.name,
        fileSize: file.size || 0,
        addedAt: Date.now(),
        isActive: true,
      };
      this.#currentProject.resources.push(resource);
    }

    this.#saveToStorage();
    this.renderLibrary();
  }

  onFileRemoved(removedIndex) {
    if (removedIndex === null || removedIndex === undefined) return;

    const fileToRemove = AppState.files[removedIndex];
    if (!fileToRemove) return;

    const resource = this.#findResource(fileToRemove.name, fileToRemove.size);

    if (resource) {
      resource.isActive = false;
    }

    this.#currentProject.history.forEach((item) => {
      if (item.targetFileIndex === removedIndex) {
        item.targetFileIndex = -1;
        if (!item.description.startsWith('(Archived)')) {
          item.description = `(Archived) ${item.description}`;
        }
      } else if (item.targetFileIndex > removedIndex) {
        item.targetFileIndex = item.targetFileIndex - 1;
      }
    });

    this.#saveToStorage();
    this.renderLibrary();
  }

  #createEmptyProject() {
    return {
      id: crypto.randomUUID(),
      name: `Project ${new Date().toLocaleDateString()}`,
      createdAt: Date.now(),
      resources: [],
      history: [],
    };
  }

  #loadFromStorage() {
    const data = localStorage.getItem('current_project');
    return data ? JSON.parse(data) : null;
  }

  #saveToStorage() {
    localStorage.setItem(
      'current_project',
      JSON.stringify(this.#currentProject)
    );
    messenger.emit('project:updated', this.#currentProject);
  }

  #findResource(name, size) {
    return this.#currentProject.resources.find((r) => {
      if (r.fileSize && size) return r.fileName === name && r.fileSize === size;
      return r.fileName === name;
    });
  }

  getProjectName() {
    return this.#currentProject.name;
  }

  renameProject(newName) {
    if (!newName || newName.trim() === '') return;
    this.#currentProject.name = newName.trim();
    this.#saveToStorage();
  }

  getResources() {
    return this.#currentProject.resources;
  }

  logAction(type, description, payload, fileIndex = 0) {
    if (this.#isReplaying) return;
    let resourceId = null;
    const file = AppState.files[fileIndex];
    if (file) {
      const res = this.#findResource(file.name, file.size);
      if (res) resourceId = res.fileId;
    }
    const entry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      actionType: type,
      targetFileIndex: fileIndex,
      resourceId: resourceId,
      description: description,
      payload: payload,
    };
    this.#currentProject.history.push(entry);
    this.#saveToStorage();
  }

  async replayHistory() {
    if (this.#currentProject.history.length === 0) return;
    this.#isReplaying = true;
    let successCount = 0;
    let skipCount = 0;
    const sortedHistory = [...this.#currentProject.history].sort(
      (a, b) => a.timestamp - b.timestamp
    );
    for (const action of sortedHistory) {
      try {
        if (action.targetFileIndex === -1) {
          skipCount++;
          continue;
        }
        if (action.actionType === 'CREATE_MATH_CHANNEL') {
          if (!AppState.files[action.targetFileIndex]) {
            skipCount++;
            continue;
          }
          mathChannels.createChannel(
            action.targetFileIndex,
            action.payload.formulaId,
            action.payload.inputs,
            action.payload.channelName,
            { ...action.payload.options, isReplay: true }
          );
          successCount++;
        }
      } catch (e) {
        console.warn(e);
        skipCount++;
      }
    }
    this.#isReplaying = false;
    messenger.emit('project:replayHistory', {});
  }

  resetProject() {
    this.#currentProject = this.#createEmptyProject();
    if (AppState.files.length > 0) {
      AppState.files.forEach((file) => this.registerFile(file));
    }
    this.#saveToStorage();
    messenger.emit('project:reset');
  }

  getHistory() {
    return this.#currentProject.history;
  }
}

export const projectManager = new ProjectManager();
