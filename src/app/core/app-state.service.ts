import { Injectable, computed, signal } from '@angular/core';
import { ActiveHighlight, LoadedFile, ViewMode } from './models';

/** Replaces the shared mutable `AppState` object in legacy/src/config.js with signals. */
@Injectable({ providedIn: 'root' })
export class AppStateService {
  readonly files = signal<LoadedFile[]>([]);
  readonly viewMode = signal<ViewMode>('stack');
  readonly activeHighlight = signal<ActiveHighlight | null>(null);
  readonly loading = signal(false);
  readonly loadingMessage = signal('');
  readonly alertMessage = signal<string | null>(null);

  /** Keys are `${fileIdx}::${signalName}`; presence in the set means hidden. */
  readonly hiddenSignalKeys = signal<ReadonlySet<string>>(new Set());

  readonly dataLoaded = computed(() => this.files().length > 0);

  showAlert(message: string): void {
    this.alertMessage.set(message);
  }

  clearAlert(): void {
    this.alertMessage.set(null);
  }

  addFile(file: LoadedFile): void {
    if (this.files().some((f) => f.dbId === file.dbId)) return;
    this.files.update((files) => [...files, file]);
  }

  /** Removes a file from the current session view (does not touch the IndexedDB library). */
  removeFileAt(index: number): void {
    this.files.update((files) => files.filter((_, i) => i !== index));
  }

  clearFiles(): void {
    this.files.set([]);
  }

  private static signalKey(fileIdx: number, signalName: string): string {
    return `${fileIdx}::${signalName}`;
  }

  isSignalVisible(fileIdx: number, signalName: string): boolean {
    return !this.hiddenSignalKeys().has(
      AppStateService.signalKey(fileIdx, signalName)
    );
  }

  setSignalVisible(
    fileIdx: number,
    signalName: string,
    visible: boolean
  ): void {
    const key = AppStateService.signalKey(fileIdx, signalName);
    this.hiddenSignalKeys.update((hidden) => {
      const next = new Set(hidden);
      if (visible) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  setAllSignalsVisibleForFile(
    fileIdx: number,
    signalNames: string[],
    visible: boolean
  ): void {
    this.hiddenSignalKeys.update((hidden) => {
      const next = new Set(hidden);
      signalNames.forEach((name) => {
        const key = AppStateService.signalKey(fileIdx, name);
        if (visible) next.delete(key);
        else next.add(key);
      });
      return next;
    });
  }

  setAllSignalsVisible(visible: boolean): void {
    if (visible) {
      this.hiddenSignalKeys.set(new Set());
      return;
    }
    const next = new Set<string>();
    this.files().forEach((file, fileIdx) => {
      file.availableSignals.forEach((name) =>
        next.add(AppStateService.signalKey(fileIdx, name))
      );
    });
    this.hiddenSignalKeys.set(next);
  }
}
