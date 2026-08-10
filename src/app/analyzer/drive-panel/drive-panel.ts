import { Component, inject, signal } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { DriveFileEntry, DriveService } from '../../core/drive.service';

/**
 * Cloud Files section of the sidebar. Ports the sign-in/list/load path,
 * tagging, public-link sharing, pagination, and recently-viewed history of
 * legacy/src/drive.js + auth.js (see DriveService doc comment).
 */
@Component({
  selector: 'app-drive-panel',
  imports: [],
  templateUrl: './drive-panel.html',
  styleUrl: './drive-panel.css',
})
export class DrivePanel {
  protected readonly auth = inject(AuthService);
  protected readonly drive = inject(DriveService);

  protected readonly showClientIdInput = signal(false);
  protected readonly clientIdDraft = signal('');
  protected readonly recentExpanded = signal(false);

  protected connect(): void {
    void this.drive.connectAndScan();
  }

  protected disconnect(): void {
    this.auth.signOut();
  }

  protected rescan(): void {
    void this.drive.listFiles();
  }

  protected onSearchInput(event: Event): void {
    this.drive.setSearchTerm((event.target as HTMLInputElement).value);
  }

  protected toggleSortOrder(): void {
    this.drive.toggleSortOrder();
  }

  protected onMonthFilterChange(event: Event): void {
    this.drive.setSelectedMonth((event.target as HTMLSelectElement).value);
  }

  protected onTagFilterChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.drive.setSelectedTag(value || null);
  }

  protected onDateStartChange(event: Event): void {
    this.drive.setDateStart((event.target as HTMLInputElement).value);
  }

  protected onDateEndChange(event: Event): void {
    this.drive.setDateEnd((event.target as HTMLInputElement).value);
  }

  protected clearFilters(): void {
    this.drive.clearFilters();
  }

  protected loadFile(entry: DriveFileEntry): void {
    void this.drive.loadFile(entry.file.name, entry.file.id);
  }

  protected addTag(entry: DriveFileEntry, event: Event): void {
    event.stopPropagation();
    const tag = window.prompt('Enter a new tag (e.g., Track, Commute, Rain):');
    if (tag) void this.drive.addTag(entry, tag);
  }

  /** Port of legacy/src/drive.js's `_getTagStyle` — deterministic hue per tag name. */
  protected tagStyle(tag: string): string {
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
      hash = tag.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `background: hsla(${hue}, 70%, 50%, 0.15); color: var(--text-color); border: 1px solid hsla(${hue}, 70%, 50%, 0.3);`;
  }

  protected filterByTag(tag: string, event: Event): void {
    event.stopPropagation();
    this.drive.setSelectedTag(this.drive.selectedTag() === tag ? null : tag);
  }

  protected shareFile(entry: DriveFileEntry, event: Event): void {
    event.stopPropagation();
    void this.drive.makeFilePublicAndCopyLink(entry.file.id);
  }

  protected onPageSizeChange(event: Event): void {
    this.drive.setItemsPerPage(
      parseInt((event.target as HTMLSelectElement).value, 10)
    );
  }

  protected toggleRecentExpanded(): void {
    this.recentExpanded.update((v) => !v);
  }

  protected clearRecentHistory(event: Event): void {
    event.stopPropagation();
    this.drive.clearRecentHistory();
  }

  protected pageRangeLabel(): string {
    const total = this.drive.filteredSortedFiles().length;
    if (total === 0) return '0-0';
    const size = this.drive.itemsPerPage();
    const start = (this.drive.currentPage() - 1) * size + 1;
    const end = Math.min(this.drive.currentPage() * size, total);
    return `${start}-${end}`;
  }

  protected sizeKb(size: string | undefined): string {
    return size ? (Number(size) / 1024).toFixed(0) : '?';
  }

  protected durationFor(entry: DriveFileEntry): string {
    return this.drive.formatDuration(Number(entry.meta.length));
  }

  protected userLabel(): string {
    const user = this.auth.user();
    return user?.displayName || user?.emailAddress || 'Connected';
  }

  protected toggleClientIdInput(): void {
    this.showClientIdInput.update((v) => !v);
  }

  protected onClientIdInput(event: Event): void {
    this.clientIdDraft.set((event.target as HTMLInputElement).value);
  }

  protected saveClientId(): void {
    this.auth.saveClientId(this.clientIdDraft());
    this.clientIdDraft.set('');
    this.showClientIdInput.set(false);
  }
}
