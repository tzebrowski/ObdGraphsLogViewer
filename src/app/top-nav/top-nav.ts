import { Component, inject, input, signal } from '@angular/core';
import { AppStateService } from '../core/app-state.service';
import { AuthService } from '../core/auth.service';
import { DataProcessorService } from '../core/data-processor.service';
import { DriveService } from '../core/drive.service';
import { DynoService } from '../core/dyno.service';
import { EventBusService } from '../core/event-bus.service';
import { HistogramService } from '../core/histogram.service';
import { MathChannelsService } from '../core/math-channels.service';
import { EVENTS, Route, ViewMode } from '../core/models';
import { UiStateService } from '../core/ui-state.service';
import { XyAnalysisService } from '../core/xy-analysis.service';

const QUICK_GAS_FILTER_FORMULA_ID = 'gas_pedal_filter_batch';

/**
 * Port of legacy/index.html's persistent `<nav class="top-nav">`, shared by
 * both the landing and analyzer pages. The `.integrated-toolbar` and
 * `.view-switcher-container` groups are only shown in analyzer mode,
 * matching legacy's `body.analyzer-active` CSS gating. The Info and Account
 * panels are simplified from legacy's versions: no "don't show again"
 * persistence for Info, and no separate login/logout button pair for
 * Account (AuthService's Promise-based `signIn()` covers both).
 */
@Component({
  selector: 'app-top-nav',
  imports: [],
  templateUrl: './top-nav.html',
  styleUrl: './top-nav.css',
})
export class TopNav {
  readonly route = input.required<Route>();

  protected readonly uiState = inject(UiStateService);
  protected readonly auth = inject(AuthService);
  protected readonly drive = inject(DriveService);
  protected readonly appState = inject(AppStateService);
  protected readonly mathChannels = inject(MathChannelsService);
  protected readonly dyno = inject(DynoService);
  protected readonly xy = inject(XyAnalysisService);
  protected readonly histogram = inject(HistogramService);
  private readonly dataProcessor = inject(DataProcessorService);
  private readonly bus = inject(EventBusService);

  protected readonly infoOpen = signal(false);
  protected readonly profileOpen = signal(false);

  protected toggleFullScreen(): void {
    const el = document.getElementById('mainContent') ?? document.body;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.();
    }
  }

  protected toggleInfo(): void {
    this.infoOpen.update((v) => !v);
  }

  protected toggleProfile(): void {
    this.profileOpen.update((v) => !v);
  }

  protected connectDrive(): void {
    void this.drive.connectAndScan();
  }

  protected fileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      void this.dataProcessor.handleFiles(Array.from(input.files));
      window.location.hash = '#analyzer';
    }
    input.value = '';
  }

  protected resetAllZoom(): void {
    this.bus.emit(EVENTS.CHART_RESET_ALL);
  }

  protected setViewMode(mode: ViewMode): void {
    this.appState.viewMode.set(mode);
  }

  protected openQuickGasFilter(): void {
    this.mathChannels.openModalWithFormula(QUICK_GAS_FILTER_FORMULA_ID);
  }

  protected signOut(): void {
    this.auth.signOut();
    this.profileOpen.set(false);
  }

  protected goHome(): void {
    window.location.hash = '';
  }

  protected userLabel(): string {
    const user = this.auth.user();
    return user?.displayName || user?.emailAddress || 'Not Logged In';
  }
}
