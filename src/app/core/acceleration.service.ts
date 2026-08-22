import { Injectable, signal } from '@angular/core';
import { AppStateService } from './app-state.service';
import { LoadedFile, SignalPoint } from './models';

export interface AccelerationConfig {
  speedKey: string;
  startSpeed: number;
  targetSpeed: number;
  maxDuration: number;
  backslideTolerance: number;
}

export interface AccelerationRun {
  time: number[];
  speed: number[];
  startTime: number;
  targetTime: number;
  elapsedSeconds: number;
}

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
 */
@Injectable({ providedIn: 'root' })
export class AccelerationService {
  readonly isSetupOpen = signal(false);
  readonly isModalOpen = signal(false);
  readonly config = signal<AccelerationConfig | null>(null);
  readonly runs = signal<AccelerationRun[]>([]);
  readonly selectedRunIndex = signal(0);
  readonly selectedExtraSignals = signal<string[]>([]);

  constructor(private readonly appState: AppStateService) {}

  openSetup(): void {
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
}
