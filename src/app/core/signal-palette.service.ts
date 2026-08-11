import { Injectable } from '@angular/core';
import { AppStateService } from './app-state.service';
import { PreferencesService } from './preferences.service';

// Same hues/ordering as the original neon set, desaturated and lightened for
// a calmer look against dark backgrounds.
const DARK_PALETTE = [
  '#D85A79',
  '#5ACBD8',
  '#D8BF5A',
  '#6ED85A',
  '#A54FD6',
  '#D88C5A',
  '#5A8CD8',
  '#D85AA6',
  '#5AD8A6',
  '#A65AD8',
  '#D8C45A',
  '#5AB8D8',
  '#D85AB9',
  '#5CD65C',
  '#DE7171',
  '#5AD8B9',
  '#B95AD8',
  '#D8D85A',
  '#5A99D8',
  '#D8995A',
  '#7BE07B',
  '#D85A99',
  '#5AD8D8',
  '#E07BAD',
  '#99D85A',
];

const LIGHT_PALETTE = [
  '#D32F2F',
  '#1976D2',
  '#388E3C',
  '#F57C00',
  '#7B1FA2',
  '#0097A7',
  '#C2185B',
  '#689F38',
  '#E64A19',
  '#303F9F',
  '#00796B',
  '#AFB42B',
  '#5D4037',
  '#455A64',
  '#C0CA33',
  '#FBC02D',
  '#FFA000',
  '#F51720',
  '#0288D1',
  '#004D40',
  '#8E24AA',
  '#D81B60',
  '#558B2F',
  '#1565C0',
  '#EF6C00',
];

const DEFAULT_COLOR = '#888888';

/**
 * Port of legacy/src/palettemanager.js's color-assignment algorithm,
 * including the light/dark palette switch and custom-user-palette override
 * (both driven by PreferencesService). Math/filtered-channel color
 * bucketing carries over unchanged.
 */
@Injectable({ providedIn: 'root' })
export class SignalPaletteService {
  private readonly colorCache = new Map<string, string>();
  private readonly mathColorMap = new Map<string, string>();
  private mathColorIndex = 0;
  private lastIsDark: boolean | null = null;

  constructor(
    private readonly appState: AppStateService,
    private readonly preferences: PreferencesService
  ) {}

  resetCache(): void {
    this.colorCache.clear();
    this.mathColorMap.clear();
    this.mathColorIndex = 0;
  }

  getColorForSignal(fileIdx: number, sigIdx: number): string {
    const isDark = this.preferences.darkTheme();
    // Port of legacy/src/palettemanager.js's MutationObserver-driven
    // resetCache() on every theme toggle: math/filtered-channel colors are
    // reassigned from the start of the new theme's palette rather than
    // continuing wherever the index across all themes ever seen left off.
    if (this.lastIsDark !== null && this.lastIsDark !== isDark) {
      this.mathColorMap.clear();
      this.mathColorIndex = 0;
    }
    this.lastIsDark = isDark;
    const useCustom = this.preferences.useCustomPalette();
    const cacheKey = `${fileIdx}:${sigIdx}:${isDark}:${useCustom}`;
    const cached = this.colorCache.get(cacheKey);
    if (cached) return cached;

    const file = this.appState.files()[fileIdx];
    if (!file) return DEFAULT_COLOR;

    const signalName = file.availableSignals[sigIdx] || `Signal_${sigIdx}`;
    const color = this.resolveColor(
      file.name,
      signalName,
      fileIdx,
      sigIdx,
      isDark,
      useCustom
    );
    this.colorCache.set(cacheKey, color);
    return color;
  }

  /** Matches legacy/src/palettemanager.js's `getSignalKey` — used to key the persisted custom-palette map. */
  getSignalKey(fileName: string, signalName: string): string {
    return `${fileName}_${signalName}`;
  }

  private resolveColor(
    fileName: string,
    signalName: string,
    fileIdx: number,
    sigIdx: number,
    isDark: boolean,
    useCustom: boolean
  ): string {
    if (useCustom) {
      const custom =
        this.preferences.customPalette()[
          this.getSignalKey(fileName, signalName)
        ];
      if (custom) return custom;
    }

    const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;
    const key = `${fileIdx}:${signalName}:${isDark}`;

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
