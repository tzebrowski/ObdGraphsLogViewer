import { Injectable } from '@angular/core';
import { AppStateService } from './app-state.service';

const DARK_PALETTE = [
  '#FF3366',
  '#00E5FF',
  '#FFCC00',
  '#39FF14',
  '#B026FF',
  '#FF6600',
  '#0066FF',
  '#FF0099',
  '#00FF99',
  '#9900FF',
  '#FFD700',
  '#00BFFF',
  '#FF33CC',
  '#33CC33',
  '#FF5050',
  '#00CC99',
  '#CC33FF',
  '#FFFF33',
  '#3399FF',
  '#FF9933',
  '#66FF66',
  '#CC0066',
  '#00FFFF',
  '#FF99CC',
  '#99FF33',
];

const DEFAULT_COLOR = '#888888';

/**
 * Port of legacy/src/palettemanager.js's color-assignment algorithm. The
 * custom-user-palette override (Preferences) and light/dark theme toggle are
 * deferred — Milestone 1 always uses the dark palette, matching the app's
 * default theme. Math/filtered-channel color bucketing carries over so the
 * behavior is ready once Milestone 3 (math channels) lands.
 */
@Injectable({ providedIn: 'root' })
export class SignalPaletteService {
  private readonly colorCache = new Map<string, string>();
  private readonly mathColorMap = new Map<string, string>();
  private mathColorIndex = 0;

  constructor(private readonly appState: AppStateService) {}

  resetCache(): void {
    this.colorCache.clear();
    this.mathColorMap.clear();
    this.mathColorIndex = 0;
  }

  getColorForSignal(fileIdx: number, sigIdx: number): string {
    const cacheKey = `${fileIdx}:${sigIdx}`;
    const cached = this.colorCache.get(cacheKey);
    if (cached) return cached;

    const file = this.appState.files()[fileIdx];
    if (!file) return DEFAULT_COLOR;

    const signalName = file.availableSignals[sigIdx] || `Signal_${sigIdx}`;
    const color = this.resolveColor(signalName, fileIdx, sigIdx);
    this.colorCache.set(cacheKey, color);
    return color;
  }

  private resolveColor(
    signalName: string,
    fileIdx: number,
    sigIdx: number
  ): string {
    const palette = DARK_PALETTE;
    const key = `${fileIdx}:${signalName}`;

    if (
      sigIdx === 999 ||
      signalName.startsWith('Math:') ||
      signalName.includes('Filtered:')
    ) {
      let color = this.mathColorMap.get(key);
      if (!color) {
        color = palette[this.mathColorIndex % palette.length];
        this.mathColorMap.set(key, color);
        this.mathColorIndex++;
      }
      return color;
    }

    const colorIndex = (fileIdx * 10 + sigIdx) % palette.length;
    return palette[colorIndex];
  }
}
