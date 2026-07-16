import { Component, inject, signal } from '@angular/core';
import { AppStateService } from '../../core/app-state.service';
import { LoadedFile } from '../../core/models';
import { SignalPaletteService } from '../../core/signal-palette.service';
import { AnomalyScanner } from '../anomaly-scanner/anomaly-scanner';
import { DrivePanel } from '../drive-panel/drive-panel';
import { LibraryPanel } from '../library-panel/library-panel';

interface SignalRow {
  name: string;
  isMath: boolean;
}

/**
 * Port of the file-info + signal-list sections of legacy/src/ui.js
 * (renderSignalList/toggleFileSignals/toggleAllSignals), plus the Drive
 * Cloud Files (Milestone 2) and Library/Anomaly Scanner (Milestone 3a) panels.
 */
@Component({
  selector: 'app-sidebar',
  imports: [DrivePanel, LibraryPanel, AnomalyScanner],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar {
  protected readonly appState = inject(AppStateService);
  private readonly palette = inject(SignalPaletteService);

  protected readonly searchTerm = signal('');

  protected signalRows(file: LoadedFile): SignalRow[] {
    const term = this.searchTerm().toLowerCase().trim();
    return file.availableSignals
      .filter((name) => !term || name.toLowerCase().includes(term))
      .map((name) => ({ name, isMath: name.startsWith('Math:') }));
  }

  protected colorFor(
    fileIdx: number,
    signalName: string,
    file: LoadedFile
  ): string {
    return this.palette.getColorForSignal(
      fileIdx,
      file.availableSignals.indexOf(signalName)
    );
  }

  protected onSearchInput(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  protected clearSearch(): void {
    this.searchTerm.set('');
  }

  protected toggleSignal(
    fileIdx: number,
    signalName: string,
    event: Event
  ): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.appState.setSignalVisible(fileIdx, signalName, checked);
  }

  protected toggleFileSignals(
    fileIdx: number,
    file: LoadedFile,
    visible: boolean
  ): void {
    this.appState.setAllSignalsVisibleForFile(
      fileIdx,
      file.availableSignals,
      visible
    );
  }

  protected toggleAllSignals(visible: boolean): void {
    this.appState.setAllSignalsVisible(visible);
  }

  protected removeFile(index: number): void {
    this.appState.removeFileAt(index);
  }
}
