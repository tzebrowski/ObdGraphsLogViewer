import { Component, inject, signal } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { DriveFileEntry, DriveService } from '../../core/drive.service';

/**
 * Cloud Files section of the sidebar. Ports the sign-in/list/load path of
 * legacy/src/drive.js + auth.js; tagging, sharing, and pagination are out of
 * scope for Milestone 2 (see DriveService doc comment).
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

  protected loadFile(entry: DriveFileEntry): void {
    void this.drive.loadFile(entry.file.name, entry.file.id);
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
