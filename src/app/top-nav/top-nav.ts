import { Component, inject, input, signal } from '@angular/core';
import { AccountModal } from '../account-modal/account-modal';
import { AccountService } from '../core/account.service';
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

/** Port of legacy/src/ui.js's `InfoPage.STORAGE_KEY`. */
const HIDE_INFO_KEY = 'hide_info_page';

/**
 * Port of legacy/index.html's persistent `<nav class="top-nav">`, shared by
 * both the landing and analyzer pages. The `.integrated-toolbar` and
 * `.view-switcher-container` groups are only shown in analyzer mode,
 * matching legacy's `body.analyzer-active` CSS gating. The Account panel is
 * simplified from legacy's version: no separate login/logout button pair
 * (AuthService's Promise-based `signIn()` covers both).
 */
@Component({
  selector: 'app-top-nav',
  imports: [AccountModal],
  templateUrl: './top-nav.html',
  styleUrl: './top-nav.css',
})
export class TopNav {
  readonly route = input.required<Route>();

  protected readonly uiState = inject(UiStateService);
  protected readonly auth = inject(AuthService);
  protected readonly account = inject(AccountService);
  protected readonly drive = inject(DriveService);
  protected readonly appState = inject(AppStateService);
  protected readonly mathChannels = inject(MathChannelsService);
  protected readonly dyno = inject(DynoService);
  protected readonly xy = inject(XyAnalysisService);
  protected readonly histogram = inject(HistogramService);
  private readonly dataProcessor = inject(DataProcessorService);
  private readonly bus = inject(EventBusService);

  /** Port of legacy/src/ui.js's `InfoPage.init` — auto-opens on launch unless the user previously checked "Don't show this again". */
  protected readonly infoOpen = signal(
    localStorage.getItem(HIDE_INFO_KEY) !== 'true'
  );
  protected readonly profileOpen = signal(false);
  protected readonly accountModalOpen = signal(false);

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

  /** Port of legacy/src/ui.js's `closeInfoBtn` handler — persists the "Don't show this again" choice only when explicitly closed via the Got it! button. */
  protected closeInfo(hideChecked: boolean): void {
    if (hideChecked) {
      localStorage.setItem(HIDE_INFO_KEY, 'true');
    } else {
      localStorage.removeItem(HIDE_INFO_KEY);
    }
    this.infoOpen.set(false);
  }

  protected onDataSourceIconError(event: Event): void {
    (event.target as HTMLImageElement).src =
      'https://img.icons8.com/color/96/google-play.png';
  }

  protected loadSampleTrip(): void {
    this.dataProcessor
      .loadSampleTrip()
      .then(() => this.infoOpen.set(false))
      .catch(() => {
        /* alert already shown by DataProcessorService; keep the modal open */
      });
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

  /** Clears both the My Giulia account session and the Drive OAuth token, so nothing is left
   *  half-signed-in. */
  protected signOut(): void {
    this.account.logout();
    this.auth.signOut();
    this.profileOpen.set(false);
  }

  protected openAccountModal(): void {
    this.profileOpen.set(false);
    this.accountModalOpen.set(true);
  }

  protected closeAccountModal(): void {
    this.accountModalOpen.set(false);
  }

  protected goHome(): void {
    window.location.hash = '';
  }

  /** Prefers the My Giulia account's own profile (email/subscriptions/features live there) over
   *  AuthService's raw Drive profile, which only has a displayName/email pulled from
   *  `drive.about.get` and doesn't necessarily reflect the account's sign-in state after a
   *  reload (see AccountModal's doc comment). */
  protected userLabel(): string {
    const accountUser = this.account.user();
    if (accountUser) return accountUser.displayName || accountUser.email;
    const user = this.auth.user();
    return user?.displayName || user?.emailAddress || 'Not Logged In';
  }
}
