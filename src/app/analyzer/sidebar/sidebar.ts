import { Component, inject, signal } from '@angular/core';
import { AppStateService } from '../../core/app-state.service';
import { LoadedFile } from '../../core/models';
import {
  PreferencesService,
  SIDEBAR_STATE_KEY,
} from '../../core/preferences.service';
import {
  categoryForSignal,
  SIGNAL_CATEGORIES,
} from '../../core/signal-categories';
import { SignalPaletteService } from '../../core/signal-palette.service';
import { UiStateService } from '../../core/ui-state.service';
import { AnomalyScanner } from '../anomaly-scanner/anomaly-scanner';
import { DrivePanel } from '../drive-panel/drive-panel';
import { LibraryPanel } from '../library-panel/library-panel';

interface SignalRow {
  name: string;
  isMath: boolean;
}

interface CategoryGroup {
  category: string;
  rows: SignalRow[];
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
  protected readonly preferences = inject(PreferencesService);
  protected readonly uiState = inject(UiStateService);
  private readonly palette = inject(SignalPaletteService);

  protected readonly searchTerm = signal('');

  /**
   * Port of legacy/src/ui.js's `initSidebarSectionsCollapse` — every
   * `.control-group` with a clickable header can be collapsed
   * independently. "Settings & Preferences" starts collapsed, matching
   * legacy's static `class="control-group gray-box collapsed"`. If a saved
   * layout exists (restoreSidebarState) it wins over that default.
   */
  protected readonly collapsedSections = signal<ReadonlySet<string>>(
    this.loadCollapsedSections()
  );

  private loadCollapsedSections(): ReadonlySet<string> {
    try {
      const raw = localStorage.getItem(SIDEBAR_STATE_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set(['settings']);
    } catch {
      return new Set(['settings']);
    }
  }

  protected isSectionCollapsed(id: string): boolean {
    return this.collapsedSections().has(id);
  }

  /** Only persists the layout (saveSidebarState) when the "Remember Layout" preference is on. */
  protected toggleSection(id: string): void {
    this.collapsedSections.update((sections) => {
      const next = new Set(sections);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (this.preferences.persistence()) {
        localStorage.setItem(SIDEBAR_STATE_KEY, JSON.stringify([...next]));
      }
      return next;
    });
  }

  /** Port of legacy/src/ui.js's `renderSignalList` per-file collapse (click the file header to hide/show its signal list). */
  protected readonly collapsedFiles = signal<ReadonlySet<number>>(new Set());

  protected isFileCollapsed(fileIdx: number): boolean {
    return this.collapsedFiles().has(fileIdx);
  }

  protected toggleFileCollapsed(fileIdx: number): void {
    this.collapsedFiles.update((files) => {
      const next = new Set(files);
      if (next.has(fileIdx)) next.delete(fileIdx);
      else next.add(fileIdx);
      return next;
    });
  }

  /** Port of legacy/src/ui.js's `renderSignalList` grouping: Math Channels first, Log Data (stock signals) second, each alphabetical. */
  protected mathSignalRows(file: LoadedFile): SignalRow[] {
    return this.signalRowsFor(file, true);
  }

  protected regularSignalRows(file: LoadedFile): SignalRow[] {
    return this.signalRowsFor(file, false);
  }

  /**
   * Groups regularSignalRows(file) (stock/log signals -- Math Channels stay in their own flat
   * bucket, see the template) by what they measure, in SIGNAL_CATEGORIES order, matching
   * AutoTuner's "Measures" panel. Empty categories are dropped so search filtering doesn't leave
   * empty group headers behind.
   */
  protected categorizedSignalRows(file: LoadedFile): CategoryGroup[] {
    const rows = this.regularSignalRows(file);
    const byCategory = new Map<string, SignalRow[]>();
    for (const row of rows) {
      const category = categoryForSignal(row.name);
      const bucket = byCategory.get(category);
      if (bucket) bucket.push(row);
      else byCategory.set(category, [row]);
    }
    return SIGNAL_CATEGORIES.map((category) => ({
      category,
      rows: byCategory.get(category) ?? [],
    })).filter((group) => group.rows.length > 0);
  }

  /** Keys are `${fileIdx}::${category}`; presence in the set means collapsed. */
  protected readonly collapsedCategories = signal<ReadonlySet<string>>(
    new Set()
  );

  private static categoryKey(fileIdx: number, category: string): string {
    return `${fileIdx}::${category}`;
  }

  protected isCategoryCollapsed(fileIdx: number, category: string): boolean {
    return this.collapsedCategories().has(
      Sidebar.categoryKey(fileIdx, category)
    );
  }

  protected toggleCategoryCollapsed(fileIdx: number, category: string): void {
    const key = Sidebar.categoryKey(fileIdx, category);
    this.collapsedCategories.update((collapsed) => {
      const next = new Set(collapsed);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Drives the group header checkbox's checked/indeterminate state. */
  protected categoryVisibility(
    fileIdx: number,
    group: CategoryGroup
  ): 'all' | 'none' | 'some' {
    const visibleCount = group.rows.filter((row) =>
      this.appState.isSignalVisible(fileIdx, row.name)
    ).length;
    if (visibleCount === 0) return 'none';
    if (visibleCount === group.rows.length) return 'all';
    return 'some';
  }

  protected toggleCategory(
    fileIdx: number,
    group: CategoryGroup,
    event: Event
  ): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.appState.setAllSignalsVisibleForFile(
      fileIdx,
      group.rows.map((row) => row.name),
      checked
    );
  }

  private signalRowsFor(file: LoadedFile, isMath: boolean): SignalRow[] {
    const term = this.searchTerm().toLowerCase().trim();
    return file.availableSignals
      .filter((name) => name.startsWith('Math:') === isMath)
      .filter((name) => !term || name.toLowerCase().includes(term))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, isMath }));
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

  protected paletteKey(fileName: string, signalName: string): string {
    return this.palette.getSignalKey(fileName, signalName);
  }

  protected setCustomColor(
    fileName: string,
    signalName: string,
    event: Event
  ): void {
    const color = (event.target as HTMLInputElement).value;
    this.preferences.setCustomColor(
      this.paletteKey(fileName, signalName),
      color
    );
    this.palette.resetCache();
  }
}
