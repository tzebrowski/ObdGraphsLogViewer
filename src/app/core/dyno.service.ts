import { Injectable, signal } from '@angular/core';
import { AppStateService } from './app-state.service';
import { LoadedFile } from './models';

export interface DynoConfig {
  rpmKey: string;
  torqueKey: string;
  pedalKey: string;
  pedalStart: number;
  pedalWot: number;
  rpmDelta: number;
}

export interface DynoPull {
  rpm: number[];
  torque: number[];
  power: number[];
  time: number[];
}

export interface DynoPoint {
  rpm: number;
  torque: number;
  power: number;
  extras: Record<string, number>;
}

const BIN_SIZE = 50;
const SMOOTH_WINDOW = 2;

/**
 * Port of legacy/src/dynomanager.js's pure computation: WOT-sweep
 * detection (extractPulls) and RPM-binning + moving-average smoothing
 * (computeDynoPoints). Chart.js rendering lives in DynoModal; this service
 * also owns the modal's open/config/selection state, matching the
 * MathChannelsService pattern.
 */
@Injectable({ providedIn: 'root' })
export class DynoService {
  readonly isSetupOpen = signal(false);
  readonly isModalOpen = signal(false);
  readonly config = signal<DynoConfig | null>(null);
  readonly pulls = signal<DynoPull[]>([]);
  readonly selectedPullIndex = signal(0);
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

  /** Best-match default for a signal picker, e.g. suggestSignal(signals, ['engine speed', 'rpm']). */
  suggestSignal(signals: string[], searchTerms: string[]): string {
    for (const sig of signals) {
      const lower = sig.toLowerCase();
      if (searchTerms.some((term) => lower.includes(term))) return sig;
    }
    return '';
  }

  generate(config: DynoConfig): { success: boolean; message?: string } {
    const file = this.appState.files()[0];
    if (!file) return { success: false };

    const pulls = this.extractPulls(file, config);
    if (pulls.length === 0) {
      return {
        success: false,
        message: `No sweeps found matching your criteria:\n- Start Pedal: ${config.pedalStart}%\n- WOT Pedal: ${config.pedalWot}%\n- Min RPM Delta: ${config.rpmDelta}`,
      };
    }

    pulls.sort(
      (a, b) =>
        Math.max(...b.rpm) -
        Math.min(...b.rpm) -
        (Math.max(...a.rpm) - Math.min(...a.rpm))
    );

    this.config.set(config);
    this.pulls.set(pulls);
    this.selectedPullIndex.set(0);
    this.selectedExtraSignals.set([]);
    this.isSetupOpen.set(false);
    this.isModalOpen.set(true);
    return { success: true };
  }

  closeModal(): void {
    this.isModalOpen.set(false);
    this.pulls.set([]);
    this.selectedPullIndex.set(0);
    this.selectedExtraSignals.set([]);
  }

  selectPull(index: number): void {
    this.selectedPullIndex.set(index);
  }

  toggleExtraSignal(sig: string): void {
    this.selectedExtraSignals.update((sigs) =>
      sigs.includes(sig) ? sigs.filter((s) => s !== sig) : [...sigs, sig]
    );
  }

  /** Relative-second range for the active pull, for AppStateService.setActiveHighlight. */
  highlightRangeForActivePull(
    file: LoadedFile
  ): { start: number; end: number } | null {
    const pull = this.pulls()[this.selectedPullIndex()];
    if (!pull || pull.time.length === 0) return null;
    return {
      start: (pull.time[0] - file.startTime) / 1000,
      end: (pull.time[pull.time.length - 1] - file.startTime) / 1000,
    };
  }

  extractPulls(file: LoadedFile, config: DynoConfig): DynoPull[] {
    const pulls: DynoPull[] = [];
    let currentPull: DynoPull = { rpm: [], torque: [], power: [], time: [] };
    let inPull = false;
    let hitWot = false;

    const { rpmKey, torqueKey, pedalKey, pedalStart, pedalWot, rpmDelta } =
      config;

    const rpmData = file.signals[rpmKey] || [];
    const torqueData = file.signals[torqueKey] || [];
    const pedalData = file.signals[pedalKey] || [];

    let maxPedal = 0;
    pedalData.forEach((p) => {
      const val = p.y;
      if (val > maxPedal) maxPedal = val;
    });

    const isDecimal = maxPedal <= 1.0;
    const threshStart = isDecimal ? pedalStart / 100 : pedalStart;
    const threshWot = isDecimal ? pedalWot / 100 : pedalWot;

    const timeSet = new Set<number>();
    rpmData.forEach((p) => timeSet.add(p.x));
    torqueData.forEach((p) => timeSet.add(p.x));
    pedalData.forEach((p) => timeSet.add(p.x));

    const times = Array.from(timeSet).sort((a, b) => a - b);

    let lastRpm: number | null = null;
    let lastTorque: number | null = null;
    let lastPedal = 100;
    let rIdx = 0;
    let tIdx = 0;
    let pIdx = 0;

    const flushPull = () => {
      if (
        hitWot &&
        currentPull.rpm.length > 0 &&
        Math.max(...currentPull.rpm) - Math.min(...currentPull.rpm) > rpmDelta
      ) {
        pulls.push(currentPull);
      }
      currentPull = { rpm: [], torque: [], power: [], time: [] };
      inPull = false;
      hitWot = false;
    };

    times.forEach((t) => {
      while (rIdx < rpmData.length && rpmData[rIdx].x <= t) {
        lastRpm = rpmData[rIdx].y;
        rIdx++;
      }
      while (tIdx < torqueData.length && torqueData[tIdx].x <= t) {
        lastTorque = torqueData[tIdx].y;
        tIdx++;
      }
      while (pIdx < pedalData.length && pedalData[pIdx].x <= t) {
        lastPedal = pedalData[pIdx].y;
        pIdx++;
      }

      if (lastPedal > threshStart && lastRpm !== null && lastTorque !== null) {
        inPull = true;
        if (lastPedal >= threshWot) hitWot = true;

        const power = (lastTorque * lastRpm) / 7021.5;
        currentPull.rpm.push(lastRpm);
        currentPull.torque.push(lastTorque);
        currentPull.power.push(power);
        currentPull.time.push(t);
      } else if (inPull) {
        flushPull();
      }
    });

    if (inPull) flushPull();

    return pulls;
  }

  computeDynoPoints(
    file: LoadedFile,
    pull: DynoPull,
    extraSignals: string[]
  ): DynoPoint[] {
    const extraData: Record<string, Float32Array> = {};
    extraSignals.forEach((sig) => {
      extraData[sig] = new Float32Array(pull.time.length);
      const raw = file.signals[sig] || [];
      let rIdx = 0;
      let lastVal = 0;
      pull.time.forEach((t, i) => {
        while (rIdx < raw.length && raw[rIdx].x <= t) {
          lastVal = raw[rIdx].y;
          rIdx++;
        }
        extraData[sig][i] = lastVal;
      });
    });

    interface Bin {
      torqueSum: number;
      powerSum: number;
      count: number;
      extras: Record<string, number>;
    }
    const binnedData: Record<number, Bin> = {};

    pull.rpm.forEach((rpm, i) => {
      const bin = Math.round(rpm / BIN_SIZE) * BIN_SIZE;
      if (!binnedData[bin]) {
        binnedData[bin] = { torqueSum: 0, powerSum: 0, count: 0, extras: {} };
        extraSignals.forEach((sig) => (binnedData[bin].extras[sig] = 0));
      }
      binnedData[bin].torqueSum += pull.torque[i];
      binnedData[bin].powerSum += pull.power[i];
      extraSignals.forEach((sig) => {
        binnedData[bin].extras[sig] += extraData[sig][i];
      });
      binnedData[bin].count++;
    });

    const binnedPoints: DynoPoint[] = Object.keys(binnedData)
      .map(Number)
      .sort((a, b) => a - b)
      .map((bin) => {
        const count = binnedData[bin].count;
        const extras: Record<string, number> = {};
        extraSignals.forEach((sig) => {
          extras[sig] = binnedData[bin].extras[sig] / count;
        });
        return {
          rpm: bin,
          torque: binnedData[bin].torqueSum / count,
          power: binnedData[bin].powerSum / count,
          extras,
        };
      });

    return binnedPoints.map((dp, i, arr) => {
      let tSum = 0;
      let pSum = 0;
      let count = 0;
      const eSum: Record<string, number> = {};
      extraSignals.forEach((sig) => (eSum[sig] = 0));

      for (
        let j = Math.max(0, i - SMOOTH_WINDOW);
        j <= Math.min(arr.length - 1, i + SMOOTH_WINDOW);
        j++
      ) {
        tSum += arr[j].torque;
        pSum += arr[j].power;
        extraSignals.forEach((sig) => (eSum[sig] += arr[j].extras[sig]));
        count++;
      }

      const extras: Record<string, number> = {};
      extraSignals.forEach((sig) => (extras[sig] = eSum[sig] / count));

      return { rpm: dp.rpm, torque: tSum / count, power: pSum / count, extras };
    });
  }
}
