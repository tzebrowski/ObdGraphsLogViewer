import { Component, inject, signal } from '@angular/core';
import { AppStateService } from '../../core/app-state.service';
import {
  PreferencesService,
  SIDEBAR_STATE_KEY,
} from '../../core/preferences.service';
import { UiStateService } from '../../core/ui-state.service';
import { AnomalyScanner } from '../anomaly-scanner/anomaly-scanner';
import { DrivePanel } from '../drive-panel/drive-panel';
import { LibraryPanel } from '../library-panel/library-panel';
import { SignalListPanel } from '../signal-list-panel/signal-list-panel';

/**
 * Port of the file-info section of legacy/src/ui.js, plus the Drive Cloud
 * Files (Milestone 2) and Library/Anomaly Scanner (Milestone 3a) panels. The
 * signal-list section itself lives in SignalListPanel, shared with
 * SignalsEdgePanel's right-side flyout.
 */
@Component({
  selector: 'app-sidebar',
  imports: [DrivePanel, LibraryPanel, AnomalyScanner, SignalListPanel],
  templateUrl: './sidebar.html',
})
export class Sidebar {
  protected readonly appState = inject(AppStateService);
  protected readonly preferences = inject(PreferencesService);
  protected readonly uiState = inject(UiStateService);

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
}
