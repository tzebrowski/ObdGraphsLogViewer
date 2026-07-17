import { beforeEach, describe, expect, it } from 'vitest';
import { AppStateService } from './app-state.service';
import { EventBusService } from './event-bus.service';
import { LoadedFile } from './models';
import { PreferencesService } from './preferences.service';
import { SignalPaletteService } from './signal-palette.service';

const DARK_PALETTE_FIRST = '#FF3366';
const LIGHT_PALETTE_FIRST = '#D32F2F';

function makeFile(availableSignals: string[]): LoadedFile {
  return {
    name: 'log.csv',
    rawData: [],
    signals: {},
    startTime: 0,
    duration: 0,
    availableSignals,
    metadata: {},
    size: 0,
    dbId: 1,
  };
}

describe('SignalPaletteService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns the default gray when the file does not exist', () => {
    const appState = new AppStateService(new EventBusService());
    const palette = new SignalPaletteService(
      appState,
      new PreferencesService()
    );
    expect(palette.getColorForSignal(0, 0)).toBe('#888888');
  });

  it('returns the first dark-palette color for the first signal (dark is the default theme)', () => {
    const appState = new AppStateService(new EventBusService());
    appState.addFile(makeFile(['RPM', 'Speed']));
    const palette = new SignalPaletteService(
      appState,
      new PreferencesService()
    );
    expect(palette.getColorForSignal(0, 0)).toBe(DARK_PALETTE_FIRST);
  });

  it('switches to the light palette when the theme preference is light', () => {
    const appState = new AppStateService(new EventBusService());
    appState.addFile(makeFile(['RPM']));
    const preferences = new PreferencesService();
    preferences.setDarkTheme(false);
    const palette = new SignalPaletteService(appState, preferences);
    expect(palette.getColorForSignal(0, 0)).toBe(LIGHT_PALETTE_FIRST);
  });

  it('uses a custom color override when custom palette is enabled', () => {
    const appState = new AppStateService(new EventBusService());
    appState.addFile(makeFile(['RPM']));
    const preferences = new PreferencesService();
    preferences.setUseCustomPalette(true);
    preferences.setCustomColor('log.csv_RPM', '#123456');
    const palette = new SignalPaletteService(appState, preferences);
    expect(palette.getColorForSignal(0, 0)).toBe('#123456');
  });

  it('falls back to the palette color when custom palette is enabled but unset for a signal', () => {
    const appState = new AppStateService(new EventBusService());
    appState.addFile(makeFile(['RPM']));
    const preferences = new PreferencesService();
    preferences.setUseCustomPalette(true);
    const palette = new SignalPaletteService(appState, preferences);
    expect(palette.getColorForSignal(0, 0)).toBe(DARK_PALETTE_FIRST);
  });

  it('caches the resolved color for a given file/signal index pair', () => {
    const appState = new AppStateService(new EventBusService());
    appState.addFile(makeFile(['RPM']));
    const palette = new SignalPaletteService(
      appState,
      new PreferencesService()
    );

    const first = palette.getColorForSignal(0, 0);
    appState.removeFileAt(0); // would make lookup fail if not cached
    expect(palette.getColorForSignal(0, 0)).toBe(first);
  });

  it('assigns deterministic, distinct colors to Math/Filtered channels', () => {
    const appState = new AppStateService(new EventBusService());
    appState.addFile(makeFile(['RPM', 'Math: Boost', 'Filtered: Speed']));
    const palette = new SignalPaletteService(
      appState,
      new PreferencesService()
    );

    const mathColor1 = palette.getColorForSignal(0, 1);
    const mathColor2 = palette.getColorForSignal(0, 1);
    const filteredColor = palette.getColorForSignal(0, 2);

    expect(mathColor1).toBe(mathColor2);
    expect(mathColor1).not.toBe(filteredColor);
  });

  it('resetCache clears memoized colors', () => {
    const appState = new AppStateService(new EventBusService());
    appState.addFile(makeFile(['RPM']));
    const palette = new SignalPaletteService(
      appState,
      new PreferencesService()
    );

    palette.getColorForSignal(0, 0);
    palette.resetCache();
    // still resolves the same deterministic color post-reset
    expect(palette.getColorForSignal(0, 0)).toBe(DARK_PALETTE_FIRST);
  });
});
