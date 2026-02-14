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

    // Initialize DB, then restore session, then render library
    dbManager.init().then(async () => {
      await this.#hydrateActiveFiles();
      this.renderLibrary();
    });

    messenger.on('action:log', (data) => {
      this.logAction(data.type, data.description, data.payload, data.fileIndex);
    });

    // Listen for file parsing to update the library list automatically
    messenger.on('dataprocessor:batch-load-completed', () =>
      this.renderLibrary()
    );
  }

  /**
   * Initialize the Library UI container (Call this from main.js)
   */
  initLibraryUI(containerId) {
    this.#libraryContainer = document.getElementById(containerId);
    this.renderLibrary();
  }

  // =================================================================
  // LIBRARY & STORAGE LOGIC
  // =================================================================

  async renderLibrary() {
    if (!this.#libraryContainer) return;

    const allStoredFiles = await dbManager.getAllFiles();
    // Sort: Newest First
    allStoredFiles.sort((a, b) => b.addedAt - a.addedAt);

    this.#libraryContainer.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
        <h4 style="margin:0; font-size:0.9em; color:#ccc;">Library (${allStoredFiles.length})</h4>
        <button id="lib-purge-btn" style="font-size:10px; background:var(--sidebar-bg); border:1px solid var(--border-color); color:var(--text-color); padding:2px 6px; cursor:pointer; border-radius:3px;">Purge</button>
      </div>
      <div class="library-list" style="max-height: 200px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 4px; background: rgba(0,0,0,0.1);">
        ${allStoredFiles.length === 0 ? '<div style="padding:10px; color:#666; font-size:0.8em; text-align:center;">No files saved.</div>' : ''}
        ${allStoredFiles.map((file) => this.#generateLibraryRow(file)).join('')}
      </div>
    `;

    this.#attachLibraryListeners();
  }

  #generateLibraryRow(file) {
    const isActive = AppState.files.some((f) => f.dbId === file.id);
    const date = new Date(file.addedAt).toLocaleDateString();
    const duration = file.duration ? (file.duration / 60).toFixed(1) : '0.0';

    return `
      <div class="library-item" style="padding: 6px 8px; border-bottom: 1px solid var(--border-color); background: ${isActive ? 'var(--sidebar-bg)' : 'transparent'}; border-left: ${isActive ? '3px solid #4f9' : '3px solid transparent'};">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
          <span style="font-size:11px; font-weight:bold; color:var(--text-color); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:130px;" title="${file.name}">
            ${file.name}
          </span>
          ${
            isActive
              ? '<span style="font-size:9px; color:#4f9; font-weight:bold;">LOADED</span>'
              : `<button class="lib-add-btn" data-id="${file.id}" style="cursor:pointer; background:#2196F3; border:none; color:white; padding:1px 6px; border-radius:3px; font-size:9px;">Open</button>`
          }
        </div>
        <div style="display:flex; justify-content:space-between; font-size:9px; color:#888;">
          <span>${date}</span>
          <span>${duration} min</span>
          <span class="lib-del-btn" data-id="${file.id}" style="cursor:pointer; color:#f44; font-weight:bold; padding:0 4px;" title="Delete">&times;</span>
        </div>
      </div>
    `;
  }

  #attachLibraryListeners() {
    // "Open" Button
    this.#libraryContainer.querySelectorAll('.lib-add-btn').forEach((btn) => {
      btn.onclick = async (e) => {
        const id = parseInt(e.target.dataset.id);
        await this.loadFromLibrary(id);
      };
    });

    // "Delete" Button (X)
    this.#libraryContainer.querySelectorAll('.lib-del-btn').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (confirm('Permanently delete this log?')) {
          const id = parseInt(e.target.dataset.id);
          await dbManager.deleteFile(id);

          // Also remove from active project if it's there
          const activeIndex = AppState.files.findIndex((f) => f.dbId === id);
          if (activeIndex !== -1) {
            messenger.emit(EVENTS.FILE_REMOVED, { index: activeIndex });
            AppState.files.splice(activeIndex, 1);
          }
          this.renderLibrary();
        }
      };
    });

    // "Purge All" Button
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

  /**
   * Loads a file from IndexedDB into the Active Workspace (RAM)
   */
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

      // Update internal project state
      this.registerFile(fileEntry);

      // Refresh UI components
      messenger.emit('dataprocessor:batch-load-completed', {});
      this.renderLibrary();
    }
  }

  /**
   * Restores session on page reload
   */
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

      // Update history if applicable
      let newFileIndex = AppState.files.findIndex((f) => f.name === file.name);
      if (newFileIndex === -1) newFileIndex = AppState.files.length; // Approximate

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
    this.renderLibrary(); // Ensure library shows "Active" status
  }

  onFileRemoved(removedIndex) {
    if (removedIndex === null || removedIndex === undefined) return;

    const fileToRemove = AppState.files[removedIndex];
    if (!fileToRemove) return;

    const resource = this.#findResource(fileToRemove.name, fileToRemove.size);

    if (resource) {
      resource.isActive = false; // Just mark inactive, don't delete from DB
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
    this.renderLibrary(); // Update UI to show "Open" button again
  }

  // --- Helpers & Standard Methods ---

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
