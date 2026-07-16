import { Injectable, signal } from '@angular/core';
import { AppStateService } from './app-state.service';

export interface HistogramBins {
  labels: string[];
  bins: number[];
}

/**
 * Port of legacy/src/histogram.js's bin computation. Also owns the modal's
 * open state and file/signal/bin-count selection, matching the other
 * analysis-modal services in this milestone.
 */
@Injectable({ providedIn: 'root' })
export class HistogramService {
  readonly isModalOpen = signal(false);
  readonly fileIndex = signal(0);
  readonly signalName = signal('');
  readonly binCount = signal(20);

  constructor(private readonly appState: AppStateService) {}

  openModal(): void {
    const files = this.appState.files();
    if (files.length === 0) {
      this.appState.showAlert('Please load a log file first.');
      return;
    }
    this.fileIndex.set(0);
    this.signalName.set([...files[0].availableSignals].sort()[0] ?? '');
    this.binCount.set(20);
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    this.isModalOpen.set(false);
  }

  setFileIndex(index: number): void {
    this.fileIndex.set(index);
    const file = this.appState.files()[index];
    this.signalName.set([...(file?.availableSignals ?? [])].sort()[0] ?? '');
  }

  computeBins(values: number[], binCount: number): HistogramBins {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const step = (max - min) / binCount;
    const bins = new Array(binCount).fill(0);
    const labels: string[] = [];

    if (step === 0) {
      bins[0] = values.length;
      labels.push(min.toFixed(1));
    } else {
      for (let i = 0; i < binCount; i++) {
        const start = min + i * step;
        const end = min + (i + 1) * step;
        labels.push(`${start.toFixed(1)} - ${end.toFixed(1)}`);
      }

      values.forEach((val) => {
        let bucket = Math.floor((val - min) / step);
        if (bucket >= binCount) bucket = binCount - 1;
        bins[bucket]++;
      });
    }

    return { labels, bins };
  }
}
