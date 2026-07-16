import { Injectable, computed, effect, signal } from '@angular/core';
import { AppStateService } from './app-state.service';
import { AuthService } from './auth.service';
import { DataProcessorService } from './data-processor.service';
import { DriveApiFile } from './google-api.types';

const DRIVE_ROOT_FOLDER = 'mygiulia';
const DRIVE_SUB_FOLDER = 'trips';

export interface DriveFileEntry {
  file: DriveApiFile;
  meta: { date: string; length: string };
  timestamp: number;
}

export type DriveSortOrder = 'asc' | 'desc';

/**
 * Port of legacy/src/drive.js's data layer: folder lookup, paginated file
 * listing, search/sort, and authenticated file download. The legacy
 * tagging (appProperties), public-link sharing, pagination controls, and
 * localStorage "recently viewed" section are dropped for Milestone 2 — out
 * of scope per the milestone plan (auth + listing + signal registry only);
 * they can be reintroduced during the Milestone 4 styling-parity pass.
 */
@Injectable({ providedIn: 'root' })
export class DriveService {
  readonly files = signal<DriveFileEntry[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly searchTerm = signal('');
  readonly sortOrder = signal<DriveSortOrder>('desc');

  readonly filteredSortedFiles = computed(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const filtered = term
      ? this.files().filter((item) =>
          item.file.name.toLowerCase().includes(term)
        )
      : this.files();

    const sorted = [...filtered].sort((a, b) => a.timestamp - b.timestamp);
    return this.sortOrder() === 'desc' ? sorted.reverse() : sorted;
  });

  private activeLoadToken = 0;

  constructor(
    private readonly auth: AuthService,
    private readonly appState: AppStateService,
    private readonly dataProcessor: DataProcessorService
  ) {
    effect(() => {
      if (!this.auth.isLoggedIn()) {
        this.files.set([]);
        this.error.set(null);
      }
    });
  }

  setSearchTerm(term: string): void {
    this.searchTerm.set(term);
  }

  toggleSortOrder(): void {
    this.sortOrder.set(this.sortOrder() === 'desc' ? 'asc' : 'desc');
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
