import { Injectable, signal } from '@angular/core';
import { AppStateService } from './app-state.service';
import { LoadedFile } from './models';

export interface ScatterPoint {
  x: number;
  y: number;
  z: number;
}

export interface XyPanelSelection {
  xSignal: string;
  ySignal: string;
  zSignal: string;
}

export type PanelIndex = 0 | 1;

/**
 * Port of legacy/src/xyanalysis.js's pure computation: nearest-neighbor
 * time-matched X/Y/Z scatter generation and the heat-gradient color scale.
 * Also owns the modal's open state, per-panel signal selection, and current
 * file index, matching the MathChannelsService/DynoService pattern.
 */
@Injectable({ providedIn: 'root' })
export class XyAnalysisService {
  readonly isModalOpen = signal(false);
  readonly currentFileIndex = signal(0);
  readonly panels = signal<[XyPanelSelection, XyPanelSelection]>([
    { xSignal: '', ySignal: '', zSignal: '' },
    { xSignal: '', ySignal: '', zSignal: '' },
  ]);

  constructor(private readonly appState: AppStateService) {}

  openModal(): void {
    if (this.appState.files().length === 0) {
      this.appState.showAlert('Please load a log file first.');
      return;
    }
    this.currentFileIndex.set(0);
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    this.isModalOpen.set(false);
  }

  setFileIndex(index: number): void {
    this.currentFileIndex.set(index);
  }

  setPanelSelection(panelIdx: PanelIndex, selection: XyPanelSelection): void {
    this.panels.update((panels) => {
      const next: [XyPanelSelection, XyPanelSelection] = [...panels];
      next[panelIdx] = selection;
      return next;
    });
  }

  setPanelSignal(
    panelIdx: PanelIndex,
    axis: 'xSignal' | 'ySignal' | 'zSignal',
    value: string
  ): void {
    this.panels.update((panels) => {
      const next: [XyPanelSelection, XyPanelSelection] = [...panels];
      next[panelIdx] = { ...next[panelIdx], [axis]: value };
      return next;
    });
  }

  /** Best-effort defaults matching legacy's onFileChange per-panel signal seeding. */
  defaultSelection(signals: string[], panelIdx: PanelIndex): XyPanelSelection {
    const matchSignal = (search: string) =>
      signals.find((s) => s.toLowerCase().includes(search.toLowerCase())) ||
      signals[0] ||
      '';

    const defY =
      panelIdx === 0 ? 'Intake Manifold Pressure' : 'Air Mass Flow Measured';
    const defZ = panelIdx === 0 ? 'Air Mass' : 'Intake Manifold Pressure';

    return {
      xSignal: matchSignal('Engine Rpm'),
      ySignal: matchSignal(defY),
      zSignal: matchSignal(defZ),
    };
  }

  generateScatterData(
    file: LoadedFile,
    signalXName: string,
    signalYName: string,
    signalZName: string
  ): ScatterPoint[] {
    const rawX = file.signals[signalXName];
    const rawY = file.signals[signalYName];
    const rawZ = file.signals[signalZName];
    if (!rawX || !rawY || !rawZ) return [];

    const scatterPoints: ScatterPoint[] = [];
    let idxY = 0;
    let idxZ = 0;
    const isMilliseconds = rawX.length > 0 && rawX[0].x > 100000;
    const tolerance = isMilliseconds ? 500 : 0.5;

    rawX.forEach((pointX) => {
      const time = pointX.x;
      while (
        idxY < rawY.length - 1 &&
        Math.abs(rawY[idxY + 1].x - time) < Math.abs(rawY[idxY].x - time)
      )
        idxY++;
      while (
        idxZ < rawZ.length - 1 &&
        Math.abs(rawZ[idxZ + 1].x - time) < Math.abs(rawZ[idxZ].x - time)
      )
        idxZ++;

      const pointY = rawY[idxY];
      const pointZ = rawZ[idxZ];

      if (
        pointY &&
        pointZ &&
        Math.abs(pointY.x - time) <= tolerance &&
        Math.abs(pointZ.x - time) <= tolerance
      ) {
        scatterPoints.push({ x: pointX.y, y: pointY.y, z: pointZ.y });
      }
    });
    return scatterPoints;
  }

  getHeatColor(value: number, min: number, max: number): string {
    if (min === max) return 'hsla(240, 100%, 50%, 0.8)';
    let ratio = (value - min) / (max - min);
    ratio = Math.max(0, Math.min(1, ratio));
    const hue = (1 - ratio) * 240;
    return `hsla(${hue}, 100%, 50%, 0.8)`;
  }
}
