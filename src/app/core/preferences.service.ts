import { Injectable, signal } from '@angular/core';

const CLIENT_ID_KEY = 'giulia_google_client_id';
const REMEMBER_FILES_KEY = 'giulia_remember_files';
const LOAD_MAP_KEY = 'giulia_load_map';
const DARK_THEME_KEY = 'giulia_dark_theme';
const CUSTOM_PALETTE_TOGGLE_KEY = 'giulia_use_custom_palette';
const CUSTOM_PALETTE_KEY = 'giulia_chart_palette';

function readCustomPalette(): Record<string, string> {
  try {
    const raw = localStorage.getItem(CUSTOM_PALETTE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * Port of legacy/src/preferences.js's Google Client ID fallback, "remember
 * active files", "load map", theme, and custom-palette toggles. Other
 * legacy prefs (persistence/performance/area-fills/smooth-lines/labels)
 * remain a tracked gap.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  /** Opt-in map rendering (external tile requests + Leaflet cost). Defaults to false, matching legacy. */
  readonly loadMap = signal(localStorage.getItem(LOAD_MAP_KEY) === 'true');

  /**
   * Deliberate deviation from legacy/src/preferences.js's defaultPrefs
   * (darkTheme: false): legacy's own dark-mode palette detection checked a
   * body class name that `setTheme` never actually applied, so in practice
   * legacy always rendered the light chart palette. This app's dark visual
   * identity (dark canvas background, brand colors) is the real default
   * look, so dark is the default here and light is the opt-out.
   */
  readonly darkTheme = signal(localStorage.getItem(DARK_THEME_KEY) !== 'false');

  readonly useCustomPalette = signal(
    localStorage.getItem(CUSTOM_PALETTE_TOGGLE_KEY) === 'true'
  );

  readonly customPalette = signal<Record<string, string>>(readCustomPalette());

  setLoadMap(value: boolean): void {
    localStorage.setItem(LOAD_MAP_KEY, String(value));
    this.loadMap.set(value);
  }

  setDarkTheme(value: boolean): void {
    localStorage.setItem(DARK_THEME_KEY, String(value));
    this.darkTheme.set(value);
  }

  setUseCustomPalette(value: boolean): void {
    localStorage.setItem(CUSTOM_PALETTE_TOGGLE_KEY, String(value));
    this.useCustomPalette.set(value);
  }

  setCustomColor(key: string, color: string): void {
    const next = { ...this.customPalette(), [key]: color };
    localStorage.setItem(CUSTOM_PALETTE_KEY, JSON.stringify(next));
    this.customPalette.set(next);
  }

  get googleClientId(): string {
    return localStorage.getItem(CLIENT_ID_KEY) || '';
  }

  set googleClientId(id: string) {
    if (id) {
      localStorage.setItem(CLIENT_ID_KEY, id);
    } else {
      localStorage.removeItem(CLIENT_ID_KEY);
    }
  }

  /** Whether active files should be restored into the session on reload. Defaults to true. */
  get rememberFiles(): boolean {
    const raw = localStorage.getItem(REMEMBER_FILES_KEY);
    return raw === null ? true : raw === 'true';
  }

  set rememberFiles(value: boolean) {
    localStorage.setItem(REMEMBER_FILES_KEY, String(value));
  }
}
