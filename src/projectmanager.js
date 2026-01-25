import { AppState } from './config.js';
import { UI } from './ui.js';
import { mathChannels } from './mathchannels.js';

class ProjectManager {
  #currentProject;
  #isReplaying;

  constructor() {
    this.#currentProject =
      this.#loadFromStorage() || this.#createEmptyProject();
    this.#isReplaying = false;
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
    if (typeof UI.renderProjectHistory === 'function') {
      UI.renderProjectHistory();
    }
  }

  #findResource(name, size) {
    return this.#currentProject.resources.find((r) => {
      if (r.fileSize && size) {
        return r.fileName === name && r.fileSize === size;
      }
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

  registerFile(file) {
    const existingResource = this.#findResource(file.name, file.size);

    if (existingResource) {
      existingResource.isActive = true;
      existingResource.lastAccessed = Date.now();

      let newFileIndex = AppState.files.findIndex((f) => f.name === file.name);

      if (newFileIndex === -1) {
        newFileIndex = AppState.files.length;
      }

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
        fileName: file.name,
        fileSize: file.size || 0,
        addedAt: Date.now(),
        isActive: true,
      };
      this.#currentProject.resources.push(resource);
    }

    this.#saveToStorage();
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
    if (this.#currentProject.history.length === 0) {
      return;
    }

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
    UI.renderSignalList();
  }

  resetProject() {
    this.#currentProject = this.#createEmptyProject();
    if (AppState.files.length > 0) {
        AppState.files.forEach(file => {
            this.registerFile(file);
        });
    }
    this.#saveToStorage();
  }

  getHistory() {
    return this.#currentProject.history;
  }
}

export const projectManager = new ProjectManager();
