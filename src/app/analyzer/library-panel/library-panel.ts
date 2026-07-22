import { Component, inject, signal } from '@angular/core';
import { AppStateService } from '../../core/app-state.service';
import { ProjectManagerService } from '../../core/project-manager.service';

/**
 * Port of the library section of legacy/src/projectmanager.js
 * (`renderLibrary`/`#generateLibraryRow`) plus a compact "Recent Activity"
 * view over the project's action history. Project renaming is included
 * since it's a one-line addition once the library UI exists.
 */
@Component({
  selector: 'app-library-panel',
  imports: [],
  templateUrl: './library-panel.html',
  styleUrl: './library-panel.css',
})
export class LibraryPanel {
  protected readonly appState = inject(AppStateService);
  protected readonly projectManager = inject(ProjectManagerService);

  protected readonly editingName = signal(false);
  protected readonly nameDraft = signal('');
  protected readonly showHistory = signal(false);

  protected isLoaded(dbId: number): boolean {
    return this.appState.files().some((f) => f.dbId === dbId);
  }

  protected formatDate(addedAt: number): string {
    return new Date(addedAt).toLocaleDateString();
  }

  protected formatDuration(duration: number): string {
    return duration ? (duration / 60).toFixed(1) : '0.0';
  }

  protected load(dbId: number): void {
    void this.projectManager.loadFromLibrary(dbId);
  }

  protected delete(dbId: number): void {
    if (!confirm('Permanently delete this log?')) return;
    void this.projectManager.deleteFromLibrary(dbId);
  }

  protected purge(): void {
    if (
      !confirm(
        'WARNING: This will delete ALL logs from the database. Continue?'
      )
    )
      return;
    void this.projectManager.purgeLibrary();
  }

  protected startEditName(): void {
    this.nameDraft.set(this.projectManager.projectName());
    this.editingName.set(true);
  }

  protected saveName(): void {
    this.projectManager.renameProject(this.nameDraft());
    this.editingName.set(false);
  }

  protected toggleHistory(): void {
    this.showHistory.update((v) => !v);
  }

  /** Port of legacy/src/ui.js's `replayProjectHistory` — re-applies this project's history (currently: recreates math channels). */
  protected replayProject(): void {
    void this.projectManager.replayHistory();
  }
}
