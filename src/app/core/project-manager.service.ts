import { Injectable, signal } from '@angular/core';
import { AppStateService } from './app-state.service';
import {
  CreateChannelOptions,
  MathChannelsService,
} from './math-channels.service';
import { DbManagerService, FileMetadata } from './db-manager.service';
import { EventBusService } from './event-bus.service';
import { ActionLogEvent, EVENTS, FileRemovedEvent } from './models';
import { PreferencesService } from './preferences.service';

export interface RegisteredFile {
  name: string;
  dbId: number | null;
  size: number;
  metadata: Record<string, unknown>;
}

export interface ProjectResource {
  fileId: string;
  dbId: number | null;
  fileName: string;
  fileSize: number;
  addedAt: number;
  isActive: boolean;
  lastAccessed?: number;
}

export interface ProjectHistoryEntry {
  id: string;
  timestamp: number;
  actionType: string;
  targetFileIndex: number;
  resourceId: string | null;
  description: string;
  payload: unknown;
}

interface StoredProject {
  id: string;
  name: string;
  createdAt: number;
  resources: ProjectResource[];
  history: ProjectHistoryEntry[];
}

const STORAGE_KEY = 'current_project';

/**
 * Port of legacy/src/projectmanager.js. Two deliberate behavior changes vs.
 * legacy:
 * - `onFileRemoved` bookkeeping now runs for every file removal (any
 *   `AppStateService.removeFileAt` call), not only session-close — legacy's
 *   split (library-delete skipped it, leaving stale resource entries) looks
 *   like an oversight rather than an intentional design choice.
 * - `purgeLibrary()` clears in-memory state instead of a full page reload,
 *   since this is now a proper SPA.
 * `resetProject()` (starting a brand-new project) isn't exposed in the UI
 * yet — no surface for it in Milestone 3a.
 */
@Injectable({ providedIn: 'root' })
export class ProjectManagerService {
  readonly libraryFiles = signal<FileMetadata[]>([]);
  readonly history = signal<ProjectHistoryEntry[]>([]);
  readonly projectName = signal('');

  private resources: ProjectResource[] = [];
  private projectId = '';
  private createdAt = Date.now();
  private isReplaying = false;

  constructor(
    private readonly appState: AppStateService,
    private readonly db: DbManagerService,
    private readonly bus: EventBusService,
    private readonly preferences: PreferencesService,
    private readonly mathChannels: MathChannelsService
  ) {
    this.bus
      .on<FileRemovedEvent>(EVENTS.FILE_REMOVED)
      .subscribe((event) => this.onFileRemoved(event));

    this.bus
      .on<ActionLogEvent>(EVENTS.ACTION_LOG)
      .subscribe((event) => this.appendHistoryEntry(event));

    this.bus.on(EVENTS.BATCH_LOADED).subscribe(() => {
      void this.refreshLibrary();
    });
  }

  async init(): Promise<void> {
    const project = this.loadFromStorageOrCreate();
    this.projectId = project.id;
    this.projectName.set(project.name);
    this.createdAt = project.createdAt;
    this.resources = project.resources;
    this.history.set(project.history ?? []);

    await this.db.init();
    await this.hydrateActiveFiles();
    await this.refreshLibrary();
  }

  registerFile(file: RegisteredFile): void {
    const existing = this.findResource(file.name, file.size);

    if (existing) {
      existing.isActive = true;
      existing.dbId = file.dbId;
      existing.lastAccessed = Date.now();

      const files = this.appState.files();
      let newFileIndex = files.findIndex((f) => f.name === file.name);
      if (newFileIndex === -1) newFileIndex = files.length;

      this.history.update((entries) =>
        entries.map((item) =>
          item.resourceId === existing.fileId
            ? {
                ...item,
                targetFileIndex: newFileIndex,
                description: item.description.replace('(Archived) ', ''),
              }
            : item
        )
      );
    } else {
      this.resources.push({
        fileId: crypto.randomUUID(),
        dbId: file.dbId,
        fileName: file.name,
        fileSize: file.size || 0,
        addedAt: Date.now(),
        isActive: true,
      });
    }

    this.saveToStorage();
    void this.refreshLibrary();
  }

  async loadFromLibrary(dbId: number): Promise<void> {
    this.appState.loading.set(true);
    this.appState.loadingMessage.set('Loading from Library...');

    const restored = await this.restoreFileFromDb(dbId);

    this.appState.loading.set(false);

    if (restored) {
      const file = this.appState.files().find((f) => f.dbId === dbId);
      if (file) {
        this.registerFile({
          name: file.name,
          dbId: file.dbId,
          size: file.size,
          metadata: file.metadata,
        });
      }
      this.bus.emit(EVENTS.BATCH_LOADED);
    }

    await this.refreshLibrary();
  }

  async deleteFromLibrary(dbId: number): Promise<void> {
    await this.db.deleteFile(dbId);

    const activeIndex = this.appState.files().findIndex((f) => f.dbId === dbId);
    if (activeIndex !== -1) {
      this.appState.removeFileAt(activeIndex);
    }

    await this.refreshLibrary();
  }

  async purgeLibrary(): Promise<void> {
    await this.db.clearAll();
    this.appState.clearFiles();
    this.resources = [];
    this.history.set([]);
    this.saveToStorage();
    await this.refreshLibrary();
  }

  renameProject(newName: string): void {
    const trimmed = newName.trim();
    if (!trimmed) return;
    this.projectName.set(trimmed);
    this.saveToStorage();
  }

  async replayHistory(): Promise<void> {
    const entries = this.history();
    if (entries.length === 0) return;

    this.isReplaying = true;
    const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);

    for (const action of sorted) {
      try {
        if (action.targetFileIndex === -1) continue;
        if (action.actionType !== 'CREATE_MATH_CHANNEL') continue;
        if (!this.appState.files()[action.targetFileIndex]) continue;

        const payload = action.payload as {
          formulaId: string;
          inputs: Array<string | number>;
          channelName: string;
          options?: CreateChannelOptions;
        };

        this.mathChannels.createChannel(
          action.targetFileIndex,
          payload.formulaId,
          payload.inputs,
          payload.channelName,
          { ...(payload.options ?? {}), isReplay: true }
        );
      } catch (e) {
        console.warn(e);
      }
    }

    this.isReplaying = false;
  }

  private async refreshLibrary(): Promise<void> {
    const files = await this.db.getAllFiles();
    files.sort((a, b) => b.addedAt - a.addedAt);
    this.libraryFiles.set(files);
  }

  private async restoreFileFromDb(dbId: number): Promise<boolean> {
    const signals = await this.db.getFileSignals(dbId);
    const allFiles = await this.db.getAllFiles();
    const meta = allFiles.find((f) => f.id === dbId);
    if (!signals || !meta) return false;

    this.appState.addFile({
      name: meta.name,
      rawData: [],
      signals,
      startTime: meta.startTime,
      duration: meta.duration,
      availableSignals: meta.availableSignals,
      metadata: meta.metadata,
      size: meta.size,
      dbId: meta.id,
    });
    return true;
  }

  private async hydrateActiveFiles(): Promise<void> {
    const activeResources = this.resources.filter((r) => r.isActive);
    if (activeResources.length === 0) return;

    this.appState.loading.set(true);
    this.appState.loadingMessage.set('Restoring Session...');

    let actuallyLoaded = false;

    for (const res of activeResources) {
      if (
        res.dbId !== null &&
        !this.appState.files().some((f) => f.dbId === res.dbId)
      ) {
        const restored = await this.restoreFileFromDb(res.dbId);
        if (restored) {
          actuallyLoaded = true;
        } else {
          res.isActive = false;
        }
      }
    }

    this.appState.loading.set(false);

    if (actuallyLoaded) {
      this.bus.emit(EVENTS.BATCH_LOADED);
      await this.replayHistory();
    }

    this.saveToStorage();
  }

  private onFileRemoved(event: FileRemovedEvent): void {
    const removedIndex = event.index;
    const resource = this.findResource(event.file.name, event.file.size);
    if (resource) resource.isActive = false;

    this.history.update((entries) =>
      entries.map((item) => {
        if (item.targetFileIndex === removedIndex) {
          return {
            ...item,
            targetFileIndex: -1,
            description: item.description.startsWith('(Archived)')
              ? item.description
              : `(Archived) ${item.description}`,
          };
        }
        if (item.targetFileIndex > removedIndex) {
          return { ...item, targetFileIndex: item.targetFileIndex - 1 };
        }
        return item;
      })
    );

    this.saveToStorage();
  }

  private appendHistoryEntry(event: ActionLogEvent): void {
    if (this.isReplaying) return;

    const file = this.appState.files()[event.fileIndex];
    let resourceId: string | null = null;
    if (file) {
      const res = this.findResource(file.name, file.size);
      if (res) resourceId = res.fileId;
    }

    const entry: ProjectHistoryEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      actionType: event.type,
      targetFileIndex: event.fileIndex,
      resourceId,
      description: event.description,
      payload: event.payload,
    };
    this.history.update((entries) => [...entries, entry]);
    this.saveToStorage();
  }

  private findResource(
    name: string,
    size: number
  ): ProjectResource | undefined {
    return this.resources.find((r) =>
      r.fileSize && size
        ? r.fileName === name && r.fileSize === size
        : r.fileName === name
    );
  }

  private createEmptyProject(): StoredProject {
    return {
      id: crypto.randomUUID(),
      name: `Project ${new Date().toLocaleDateString()}`,
      createdAt: Date.now(),
      resources: [],
      history: [],
    };
  }

  private loadFromStorageOrCreate(): StoredProject {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return this.createEmptyProject();

    try {
      const project = JSON.parse(raw) as StoredProject;
      if (!project || !Array.isArray(project.resources)) {
        return this.createEmptyProject();
      }

      if (!this.preferences.rememberFiles) {
        project.resources.forEach((r) => {
          r.isActive = false;
        });
      }
      return project;
    } catch {
      return this.createEmptyProject();
    }
  }

  private saveToStorage(): void {
    const project: StoredProject = {
      id: this.projectId,
      name: this.projectName(),
      createdAt: this.createdAt,
      resources: this.resources,
      history: this.history(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  }
}
