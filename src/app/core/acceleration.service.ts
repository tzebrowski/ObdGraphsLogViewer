import { Injectable, isDevMode, signal } from '@angular/core';
import { AccountService } from './account.service';
import { AppStateService } from './app-state.service';
import { DbManagerService } from './db-manager.service';
import { LoadedFile, SignalPoint } from './models';

/** Matches DriveService's DRIVE_FEATURE_NAME convention -- a mygiulia-backend feature name, resolved via AccountService.hasFeature(). */
const ACCELERATION_FEATURE_NAME = 'acceleration-runs';

export interface AccelerationConfig {
  speedKey: string;
  startSpeed: number;
  targetSpeed: number;
  maxDuration: number;
  backslideTolerance: number;
  /** Optional secondary checkpoint speed (e.g. 60) reported as a split time alongside the full run -- skipped when unset or never reached within the run window. */
  splitSpeed?: number;
  /** Optional engine RPM signal; when set (with gearShiftRpmDrop), enables gear-shift detection over the run window. */
  rpmKey?: string;
  gearShiftRpmDrop?: number;
}

export interface GearShift {
  time: number;
  elapsedSeconds: number;
  rpm: number;
}

export interface AccelerationRun {
  time: number[];
  speed: number[];
  startTime: number;
  targetTime: number;
  elapsedSeconds: number;
  splitElapsedSeconds: number | null;
  gearShifts: GearShift[];
}

/** A run persisted to the registry (see AccelerationService.saveActiveRunToRegistry) so it can be browsed/compared independently of whatever file is currently loaded. */
export interface SavedAccelerationRun {
  id: number;
  savedAt: number;
  sourceFileName: string;
  startSpeed: number;
  targetSpeed: number;
  splitSpeed?: number;
  elapsedSeconds: number;
  splitElapsedSeconds: number | null;
  gearShifts: GearShift[];
  /** x = ms elapsed since launch (0 at launch), y = speed -- detached from the source file's absolute timestamps since that file may not be loaded when this is compared later. */
  points: SignalPoint[];
}

const MAX_COMPARE_RUNS = 4;

/**
 * No legacy counterpart -- new feature. Mirrors DynoService's shape
 * (setup/modal open state, config, detected-event list, selection) so the
 * UX (setup step -> pull/run picker + chart modal, "View on Chart", PNG
 * export) is consistent with the existing Virtual Dyno feature.
 *
 * extractRuns finds standing-start acceleration runs on a vehicle-speed
 * signal: a launch (speed rising through `startSpeed` from rest) followed
 * by a mostly-monotonic climb to `targetSpeed` within `maxDuration`. A run
 * attempt is abandoned -- and scanning resumes past it -- if the driver
 * lifts off before reaching the target (speed sagging more than
 * `backslideTolerance` below its best-so-far) or if `targetSpeed` isn't
 * reached in time.
 *
 * Gated behind the `acceleration-runs` mygiulia-backend feature, resolved
 * via AccountService.hasFeature() -- same entitlement-check pattern
 * DriveService uses for `google-drive-access`, checked at call time rather
 * than pre-computed as a template-disabled state (DriveService doesn't
 * pre-disable its own UI on entitlement either; it alerts when the gated
 * action is actually attempted). Skipped entirely under isDevMode() so
 * `ng serve` can exercise the feature without a local backend + real
 * Google sign-in -- the gate itself still needs testing against the real
 * API (see the local-dev instructions), this only unblocks iterating on
 * everything past the gate.
 */
@Injectable({ providedIn: 'root' })
export class AccelerationService {
  readonly isSetupOpen = signal(false);
  readonly isModalOpen = signal(false);
  readonly config = signal<AccelerationConfig | null>(null);
  readonly runs = signal<AccelerationRun[]>([]);
  readonly selectedRunIndex = signal(0);
  readonly selectedExtraSignals = signal<string[]>([]);

  readonly registry = signal<SavedAccelerationRun[]>([]);
  readonly isRegistryOpen = signal(false);
  readonly compareIds = signal<number[]>([]);

  constructor(
    private readonly appState: AppStateService,
    private readonly account: AccountService,
    private readonly db: DbManagerService
  ) {}

  /**
   * Thin wrapper around Angular's isDevMode() so tests can stub it --
   * Vitest can't spy on '@angular/core's own export directly (frozen ESM
   * module namespace), but a mutable prototype method is easy to stub.
   * Matches VersionCheckService's identical wrapper.
   */
  protected isDevMode(): boolean {
    return isDevMode();
  }

  openSetup(): void {
    if (!this.isDevMode()) {
      if (!this.account.isSignedIn()) {
        this.appState.showAlert(
          'Please sign in with Google to use Acceleration Runs.'
        );
        return;
      }
      if (!this.account.hasFeature(ACCELERATION_FEATURE_NAME)) {
        this.appState.showAlert(
          "Your My Giulia account doesn't have access to Acceleration Runs. Please contact support if you believe this is a mistake."
        );
        return;
      }
    }
    if (this.appState.files().length === 0) {
      this.appState.showAlert('Please load a log file first.');
      return;
    }
    this.isSetupOpen.set(true);
  }

  closeSetup(): void {
    this.isSetupOpen.set(false);
  }

  /**
   * Best-match default for a signal picker, e.g. suggestSignal(signals,
   * ['vehicle speed', 'wheel speed', 'speed'], ['engine', 'rpm']). Tries
   * each search term in order across all signals before falling through to
   * the next term, so an earlier (more specific) term always wins over a
   * later, more generic one -- without this, a generic fallback like
   * 'speed' could match an alphabetically-earlier signal (e.g. "Engine
   * Speed") before the intended "Vehicle Speed" is ever considered.
   * `excludeTerms` additionally disqualifies any candidate containing one
   * of those substrings, even under a generic search term -- e.g. so a
   * bare 'speed' fallback can never suggest an RPM channel just because
   * its name happens to contain the word "Speed".
   */
  suggestSignal(
    signals: string[],
    searchTerms: string[],
    excludeTerms: string[] = []
  ): string {
    for (const term of searchTerms) {
      const match = signals.find((sig) => {
        const lower = sig.toLowerCase();
        return (
          lower.includes(term) && !excludeTerms.some((ex) => lower.includes(ex))
        );
      });
      if (match) return match;
    }
    return '';
  }

  generate(config: AccelerationConfig): { success: boolean; message?: string } {
    const file = this.appState.files()[0];
    if (!file) return { success: false };

    const runs = this.extractRuns(file, config);
    if (runs.length === 0) {
      return {
        success: false,
        message: `No ${config.startSpeed}-${config.targetSpeed} runs found matching your criteria within ${config.maxDuration}s.`,
      };
    }

    runs.sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);

    this.config.set(config);
    this.runs.set(runs);
    this.selectedRunIndex.set(0);
    this.selectedExtraSignals.set([]);
    this.isSetupOpen.set(false);
    this.isModalOpen.set(true);
    return { success: true };
  }

  closeModal(): void {
    this.isModalOpen.set(false);
    this.runs.set([]);
    this.selectedRunIndex.set(0);
    this.selectedExtraSignals.set([]);
  }

  selectRun(index: number): void {
    this.selectedRunIndex.set(index);
  }

  toggleExtraSignal(sig: string): void {
    this.selectedExtraSignals.update((sigs) =>
      sigs.includes(sig) ? sigs.filter((s) => s !== sig) : [...sigs, sig]
    );
  }

  /**
   * Browsing/comparing previously-saved runs isn't gated the way
   * openSetup() is -- it's reading the user's own local IndexedDB data, not
   * calling the backend, so there's nothing to entitlement-check.
   */
  async openRegistry(): Promise<void> {
    this.isRegistryOpen.set(true);
    await this.refreshRegistry();
  }

  closeRegistry(): void {
    this.isRegistryOpen.set(false);
    this.compareIds.set([]);
  }

  async refreshRegistry(): Promise<void> {
    const runs = await this.db.getAllAccelerationRuns();
    this.registry.set([...runs].sort((a, b) => b.savedAt - a.savedAt));
  }

  /**
   * Persists the currently-selected run (with its config and source file
   * name) so it can be browsed/compared later independently of whatever
   * file happens to be loaded at the time. `points` are detached from the
   * source file's absolute timestamps -- x becomes ms elapsed since launch
   * -- since that file may no longer be loaded when this run is compared.
   */
  async saveActiveRunToRegistry(): Promise<void> {
    const run = this.runs()[this.selectedRunIndex()];
    const config = this.config();
    const fileName = this.appState.files()[0]?.name;
    if (!run || !config || !fileName) return;

    const saved: Omit<SavedAccelerationRun, 'id'> = {
      savedAt: Date.now(),
      sourceFileName: fileName,
      startSpeed: config.startSpeed,
      targetSpeed: config.targetSpeed,
      splitSpeed: config.splitSpeed,
      elapsedSeconds: run.elapsedSeconds,
      splitElapsedSeconds: run.splitElapsedSeconds,
      gearShifts: run.gearShifts,
      points: run.time.map((t, i) => ({
        x: t - run.startTime,
        y: run.speed[i],
      })),
    };

    const id = await this.db.saveAccelerationRun(saved);
    if (id === null) {
      this.appState.showAlert('Failed to save to registry.');
      return;
    }
    this.appState.showAlert('Saved to Registry.');
    await this.refreshRegistry();
  }

  async deleteFromRegistry(id: number): Promise<void> {
    await this.db.deleteAccelerationRun(id);
    this.compareIds.update((ids) => ids.filter((i) => i !== id));
    await this.refreshRegistry();
  }

  toggleCompare(id: number): void {
    if (this.compareIds().includes(id)) {
      this.compareIds.update((ids) => ids.filter((i) => i !== id));
      return;
    }
    if (this.compareIds().length >= MAX_COMPARE_RUNS) {
      this.appState.showAlert(
        `Compare up to ${MAX_COMPARE_RUNS} runs at a time.`
      );
      return;
    }
    this.compareIds.update((ids) => [...ids, id]);
  }

  /** Relative-second range for the active run, for AppStateService.setActiveHighlight. */
  highlightRangeForActiveRun(
    file: LoadedFile
  ): { start: number; end: number } | null {
    const run = this.runs()[this.selectedRunIndex()];
    if (!run) return null;
    return {
      start: (run.startTime - file.startTime) / 1000,
      end: (run.targetTime - file.startTime) / 1000,
    };
  }

  extractRuns(file: LoadedFile, config: AccelerationConfig): AccelerationRun[] {
    const {
      speedKey,
      startSpeed,
      targetSpeed,
      maxDuration,
      backslideTolerance,
    } = config;
    const speedData = file.signals[speedKey] || [];
    if (speedData.length < 2) return [];

    const runs: AccelerationRun[] = [];
    let i = 0;

    while (i < speedData.length - 1) {
      while (
        i < speedData.length - 1 &&
        !(speedData[i].y <= startSpeed && speedData[i + 1].y > startSpeed)
      ) {
        i++;
      }
      if (i >= speedData.length - 1) break;

      const launchIdx = i;
      const launchTime = this.interpolateCrossing(
        speedData[launchIdx],
        speedData[launchIdx + 1],
        startSpeed
      );

      let peak = speedData[launchIdx].y;
      let j = launchIdx + 1;
      let targetIdx = -1;

      while (j < speedData.length) {
        const point = speedData[j];
        if (point.x - launchTime > maxDuration * 1000) break;
        // Speed settled back to (near) rest before reaching target -- a
        // false start (e.g. sensor noise ticking briefly above startSpeed
        // while stationary), not a pull in progress. Bail so the outer
        // loop re-anchors on whatever later crossing is the real launch,
        // rather than keeping this stale launchTime and folding the idle
        // gap into the reported elapsed time.
        if (point.y <= startSpeed) break;
        if (point.y > peak) peak = point.y;
        if (peak - point.y > backslideTolerance) break;
        if (point.y >= targetSpeed) {
          targetIdx = j;
          break;
        }
        j++;
      }

      if (targetIdx !== -1) {
        const targetTime = this.interpolateCrossing(
          speedData[targetIdx - 1],
          speedData[targetIdx],
          targetSpeed
        );
        const windowPoints = speedData.slice(launchIdx, targetIdx + 1);
        runs.push({
          time: windowPoints.map((p) => p.x),
          speed: windowPoints.map((p) => p.y),
          startTime: launchTime,
          targetTime,
          elapsedSeconds: (targetTime - launchTime) / 1000,
          splitElapsedSeconds: this.computeSplitElapsedSeconds(
            windowPoints,
            launchTime,
            config.splitSpeed
          ),
          gearShifts: this.detectGearShifts(
            file,
            launchTime,
            targetTime,
            config.rpmKey,
            config.gearShiftRpmDrop
          ),
        });
        i = targetIdx + 1;
      } else {
        i = Math.max(launchIdx + 1, j);
      }
    }

    return runs;
  }

  private interpolateCrossing(
    before: SignalPoint,
    after: SignalPoint,
    threshold: number
  ): number {
    if (after.x === before.x || after.y === before.y) return after.x;
    const frac = (threshold - before.y) / (after.y - before.y);
    return before.x + frac * (after.x - before.x);
  }

  /** Elapsed seconds from launch to the first crossing of splitSpeed within the run window (e.g. the "0-60" split inside a 0-100 run), or null if unset/never reached. */
  private computeSplitElapsedSeconds(
    windowPoints: SignalPoint[],
    launchTime: number,
    splitSpeed?: number
  ): number | null {
    if (!splitSpeed) return null;
    for (let k = 1; k < windowPoints.length; k++) {
      if (
        windowPoints[k - 1].y < splitSpeed &&
        windowPoints[k].y >= splitSpeed
      ) {
        const crossing = this.interpolateCrossing(
          windowPoints[k - 1],
          windowPoints[k],
          splitSpeed
        );
        return (crossing - launchTime) / 1000;
      }
    }
    return null;
  }

  /**
   * Locates gear shifts as RPM peaks within the run window: under full
   * throttle, RPM climbs through a gear then drops sharply as the next gear
   * engages, then climbs again. A zig-zag/hysteresis walk (rather than a
   * naive "any decrease" check) treats a peak as confirmed only once RPM has
   * fallen at least `minDropRpm` below it -- and symmetrically waits for an
   * equal rebound before arming the next peak -- so sensor noise or brief
   * RPM jitter can't masquerade as a shift. Mirrors DynoService's rpmDelta
   * noise-filtering role for pull detection.
   */
  private detectGearShifts(
    file: LoadedFile,
    launchTime: number,
    targetTime: number,
    rpmKey?: string,
    minDropRpm?: number
  ): GearShift[] {
    if (!rpmKey || !minDropRpm || minDropRpm <= 0) return [];
    const rpmData = file.signals[rpmKey] || [];
    const windowed = rpmData.filter(
      (p) => p.x >= launchTime && p.x <= targetTime
    );
    if (windowed.length < 2) return [];

    const shifts: GearShift[] = [];
    let extremum = windowed[0];
    let rising = true;

    for (let k = 1; k < windowed.length; k++) {
      const point = windowed[k];
      if (rising) {
        if (point.y >= extremum.y) {
          extremum = point;
        } else if (extremum.y - point.y >= minDropRpm) {
          shifts.push({
            time: extremum.x,
            elapsedSeconds: (extremum.x - launchTime) / 1000,
            rpm: extremum.y,
          });
          rising = false;
          extremum = point;
        }
      } else if (point.y <= extremum.y) {
        extremum = point;
      } else if (point.y - extremum.y >= minDropRpm) {
        rising = true;
        extremum = point;
      }
    }
    return shifts;
  }
}
