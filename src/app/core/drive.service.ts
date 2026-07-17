import { Injectable, computed, effect, signal } from '@angular/core';
import { AppStateService } from './app-state.service';
import { AuthService } from './auth.service';
import { DataProcessorService } from './data-processor.service';
import { EventBusService } from './event-bus.service';
import { DriveApiFile } from './google-api.types';
import { EVENTS, FileTagAddedEvent } from './models';

const DRIVE_ROOT_FOLDER = 'mygiulia';
const DRIVE_SUB_FOLDER = 'trips';
const RECENT_KEY = 'recent_logs';
const RECENT_LIMIT = 3;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export interface DriveFileEntry {
  file: DriveApiFile;
  meta: { date: string; length: string };
  timestamp: number;
  tags?: string[];
}

export type DriveSortOrder = 'asc' | 'desc';

function readRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Port of legacy/src/drive.js's data layer: folder lookup, paginated file
 * listing, search/sort, tagging (appProperties), public-link sharing,
 * client-side pagination over the fetched list, and the localStorage
 * "recently viewed" history. Month/date-range filtering are a tracked gap.
 *
 * Tagging and sharing call Drive *write* endpoints (files.update,
 * permissions.create) against files discovered via folder-scanning, which
 * requires the full `drive` OAuth scope (see AuthService) — legacy
 * requested only `drive.readonly` while still calling these endpoints, so
 * they silently failed there at runtime.
 */
@Injectable({ providedIn: 'root' })
export class DriveService {
  readonly files = signal<DriveFileEntry[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly searchTerm = signal('');
  readonly sortOrder = signal<DriveSortOrder>('desc');
  readonly selectedTag = signal<string | null>(null);

  readonly currentPage = signal(1);
  readonly itemsPerPage = signal<number>(PAGE_SIZE_OPTIONS[2]);
  readonly pageSizeOptions = PAGE_SIZE_OPTIONS;

  readonly recentIds = signal<string[]>(readRecentIds());

  readonly filteredSortedFiles = computed(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const tag = this.selectedTag();
    let filtered = this.files();
    if (term) {
      filtered = filtered.filter(
        (item) =>
          item.file.name.toLowerCase().includes(term) ||
          (item.tags ?? []).some((t) => t.toLowerCase().includes(term))
      );
    }
    if (tag) {
      filtered = filtered.filter((item) => (item.tags ?? []).includes(tag));
    }

    const sorted = [...filtered].sort((a, b) => a.timestamp - b.timestamp);
    return this.sortOrder() === 'desc' ? sorted.reverse() : sorted;
  });

  readonly totalPages = computed(() =>
    Math.max(
      1,
      Math.ceil(this.filteredSortedFiles().length / this.itemsPerPage())
    )
  );

  readonly paginatedFiles = computed(() => {
    const page = Math.min(this.currentPage(), this.totalPages());
    const size = this.itemsPerPage();
    const start = (page - 1) * size;
    return this.filteredSortedFiles().slice(start, start + size);
  });

  readonly recentEntries = computed(() => {
    const byId = new Map(this.files().map((entry) => [entry.file.id, entry]));
    return this.recentIds()
      .map((id) => byId.get(id))
      .filter((entry): entry is DriveFileEntry => entry !== undefined);
  });

  private activeLoadToken = 0;

  constructor(
    private readonly auth: AuthService,
    private readonly appState: AppStateService,
    private readonly dataProcessor: DataProcessorService,
    private readonly bus: EventBusService
  ) {
    effect(() => {
      if (!this.auth.isLoggedIn()) {
        this.files.set([]);
        this.error.set(null);
      }
    });

    this.bus
      .on<FileTagAddedEvent>(EVENTS.FILE_TAG_ADDED)
      .subscribe(({ fileName, tag }) => this.syncTagFromChart(fileName, tag));
  }

  /**
   * Port of legacy/src/drive.js's `_syncTagFromChart`: when a tag is added
   * from the chart card (AppStateService.addFileTag) for a file that's also
   * present in the Drive listing (matched by name), mirror it to Drive too.
   */
  private syncTagFromChart(fileName: string, tag: string): void {
    const entry = this.files().find((f) => f.file.name === fileName);
    if (!entry) return;
    void this.addTag(entry, tag);
  }

  setSearchTerm(term: string): void {
    this.searchTerm.set(term);
    this.currentPage.set(1);
  }

  toggleSortOrder(): void {
    this.sortOrder.set(this.sortOrder() === 'desc' ? 'asc' : 'desc');
  }

  setSelectedTag(tag: string | null): void {
    this.selectedTag.set(tag);
    this.currentPage.set(1);
  }

  setItemsPerPage(size: number): void {
    this.itemsPerPage.set(size);
    this.currentPage.set(1);
  }

  prevPage(): void {
    this.currentPage.update((page) => Math.max(1, page - 1));
  }

  nextPage(): void {
    this.currentPage.update((page) => Math.min(this.totalPages(), page + 1));
  }

  /** Port of legacy/src/drive.js's `promptAddTag`/`_syncTagFromChart` — no remove-tag UI exists in legacy either. */
  async addTag(entry: DriveFileEntry, rawTag: string): Promise<void> {
    const tag = rawTag.trim().toLowerCase();
    if (!tag) return;

    const currentTags = entry.tags ?? [];
    if (currentTags.includes(tag)) {
      this.appState.showAlert('This tag is already applied to this log.');
      return;
    }

    const updatedTags = [...currentTags, tag];
    this.setEntryTags(entry.file.id, updatedTags);

    try {
      await window.gapi!.client.drive.files.update({
        fileId: entry.file.id,
        appProperties: { tags: updatedTags.join(',') },
      });
    } catch (error) {
      console.error('Error saving tag:', error);
      this.setEntryTags(entry.file.id, currentTags);
      this.appState.showAlert(
        `Failed to save tag to Google Drive: ${(error as Error).message}`
      );
    }
  }

  /** Port of legacy/src/drive.js's `makeFilePublicAndCopyLink`. */
  async makeFilePublicAndCopyLink(fileId: string): Promise<void> {
    this.appState.loading.set(true);
    this.appState.loadingMessage.set('Generating shareable app link...');

    try {
      await window.gapi!.client.drive.permissions.create({
        fileId,
        resource: { role: 'reader', type: 'anyone' },
      });

      const baseUrl = window.location.origin + window.location.pathname;
      const appLink = `${baseUrl}?fileId=${fileId}#analyzer`;

      if (navigator.clipboard) {
        await navigator.clipboard.writeText(appLink);
        this.appState.showAlert(
          'Success! App link copied to your clipboard. Anyone with this link can view the log in the app.'
        );
      } else {
        this.appState.showAlert(`Success! Shareable Link: ${appLink}`);
      }
    } catch (error) {
      console.error('Error making file public:', error);
      this.appState.showAlert(
        `Failed to create public link: ${(error as Error).message}`
      );
    } finally {
      this.appState.loading.set(false);
    }
  }

  clearRecentHistory(): void {
    localStorage.removeItem(RECENT_KEY);
    this.recentIds.set([]);
  }

  private setEntryTags(fileId: string, tags: string[]): void {
    this.files.update((files) =>
      files.map((entry) =>
        entry.file.id === fileId ? { ...entry, tags } : entry
      )
    );
  }

  private recordRecentlyViewed(id: string): void {
    const next = [id, ...this.recentIds().filter((i) => i !== id)].slice(
      0,
      RECENT_LIMIT
    );
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    this.recentIds.set(next);
  }

  /** Signs in (if needed) and scans the Drive `mygiulia/trips` folder for logs. */
  async connectAndScan(): Promise<void> {
    await this.auth.signIn();
    if (this.auth.isLoggedIn()) {
      await this.listFiles();
    }
  }

  async listFiles(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.files.set([]);

    try {
      const rootId = await this.findFolderId(DRIVE_ROOT_FOLDER);
      const subFolderId = rootId
        ? await this.findFolderId(DRIVE_SUB_FOLDER, rootId)
        : null;

      if (!subFolderId) {
        this.error.set(
          `Required Drive folders not found ("${DRIVE_ROOT_FOLDER}/${DRIVE_SUB_FOLDER}").`
        );
        return;
      }

      await this.fetchJsonFiles(subFolderId);
    } catch (error) {
      this.handleApiError(error);
    } finally {
      this.loading.set(false);
    }
  }

  async loadFile(fileName: string, id: string): Promise<void> {
    const currentToken = ++this.activeLoadToken;
    this.appState.loading.set(true);
    this.appState.loadingMessage.set('Downloading log...');
    this.recordRecentlyViewed(id);

    try {
      const accessToken = this.auth.getAccessToken();
      if (!accessToken) throw new Error('Drive session token not found.');

      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
      if (currentToken !== this.activeLoadToken) return;

      let dataToProcess: unknown;
      if (fileName.endsWith('.gz')) {
        const blob = await response.blob();
        const ds = new DecompressionStream('gzip');
        const decompressedStream = blob.stream().pipeThrough(ds);
        dataToProcess = JSON.parse(
          await new Response(decompressedStream).text()
        );
      } else {
        dataToProcess = await response.json();
      }

      await this.dataProcessor.processExternal(dataToProcess, fileName);
    } catch (error) {
      if (currentToken === this.activeLoadToken) {
        console.error('Drive download error:', error);
        this.appState.showAlert(`Download Error: ${(error as Error).message}`);
      }
    } finally {
      if (currentToken === this.activeLoadToken) {
        this.appState.loading.set(false);
      }
    }
  }

  formatDate(isoString: string | undefined): string {
    if (!isoString || isoString === 'Unknown') return 'N/A';
    try {
      return new Date(isoString).toLocaleString('en-US', {
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

  formatDuration(seconds: number | undefined): string {
    if (!seconds || isNaN(seconds)) return 'N/A';
    const sec = Math.trunc(seconds);
    if (sec < 60) return `${sec}s`;

    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m < 60) return `${m}m ${s}s`;

    const h = Math.floor(m / 60);
    const remainingM = m % 60;
    return `${h}h ${remainingM}m`;
  }

  private async findFolderId(
    name: string,
    parentId = 'root'
  ): Promise<string | null> {
    try {
      const variants = [
        name,
        name.toLowerCase(),
        name.charAt(0).toUpperCase() + name.slice(1),
      ];
      const nameQuery = variants.map((v) => `name = '${v}'`).join(' or ');
      const query = `mimeType='application/vnd.google-apps.folder' and (${nameQuery}) and '${parentId}' in parents and trashed=false`;

      const response = await window.gapi!.client.drive.files.list({
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

  private async fetchJsonFiles(folderId: string): Promise<void> {
    let pageToken: string | null | undefined = null;
    let hasMore = true;
    const collected: DriveFileEntry[] = [];

    while (hasMore) {
      const res = await window.gapi!.client.drive.files.list({
        pageSize: 100,
        fields:
          'nextPageToken, files(id, name, size, modifiedTime, appProperties)',
        q: `'${folderId}' in parents and (name contains '.json' or name contains '.gz' or name contains '.jsonl') and trashed=false`,
        orderBy: 'modifiedTime desc',
        pageToken,
      });

      const files = res.result.files || [];
      files.forEach((f) => {
        collected.push({
          file: f,
          meta: this.getFileMetadata(f.name),
          timestamp: this.extractTimestamp(f.name),
          tags: f.appProperties?.['tags']
            ? f.appProperties['tags'].split(',').filter(Boolean)
            : [],
        });
      });

      pageToken = res.result.nextPageToken;
      hasMore = !!pageToken;
      this.files.set([...collected]);
    }
  }

  private getFileMetadata(fileName: string): { date: string; length: string } {
    const match = fileName.match(/-(\d+)-(\d+)(?:\.[a-zA-Z0-9]+)+$/);
    if (!match) return { date: 'Unknown', length: '?' };
    const date = new Date(parseInt(match[1], 10));
    return { date: date.toISOString(), length: match[2] };
  }

  private extractTimestamp(fileName: string): number {
    const match = fileName.match(/-(\d+)-(\d+)(?:\.[a-zA-Z0-9]+)+$/);
    return match ? parseInt(match[1], 10) : 0;
  }

  private handleApiError(error: unknown): void {
    const err = error as {
      status?: number;
      result?: { error?: { message?: string } };
      message?: string;
    };
    if (err.status === 401 || err.status === 403) {
      window.gapi?.client?.setToken(null);
      this.auth.signOut();
    }
    const msg = err.result?.error?.message || err.message || 'Unknown error';
    this.error.set(
      err.status === 401
        ? 'Session expired. Please sign in again.'
        : `Drive error: ${msg}`
    );
  }
}
