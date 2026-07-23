import { Injectable, signal } from '@angular/core';

const CLIENT_ID_KEY = 'giulia_google_client_id';
const REMEMBER_FILES_KEY = 'giulia_remember_files';
const LOAD_MAP_KEY = 'giulia_load_map';
const DARK_THEME_KEY = 'giulia_dark_theme';
const CUSTOM_PALETTE_TOGGLE_KEY = 'giulia_use_custom_palette';
const CUSTOM_PALETTE_KEY = 'giulia_chart_palette';
const SHOW_AREA_FILLS_KEY = 'giulia_show_area_fills';
const SMOOTH_LINES_KEY = 'giulia_smooth_lines';
const SHOW_LABELS_KEY = 'giulia_show_labels';
const PERSISTENCE_KEY = 'giulia_persistence';
const PERFORMANCE_KEY = 'giulia_performance';

/** Shared with Sidebar's collapsed-section persistence, gated on the `persistence` preference. */
export const SIDEBAR_STATE_KEY = 'sidebar_collapsed_states';

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
 * active files", "load map", theme, custom-palette, area-fills, smooth-lines,
 * show-labels, persistence ("Remember Layout"), and performance toggles.
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

  /** Whether active files should be restored into the session on reload. Defaults to true, matching legacy. */
  readonly rememberFiles = signal(
    localStorage.getItem(REMEMBER_FILES_KEY) !== 'false'
  );

  /** Fills the area below each line. Defaults to true, matching legacy. */
  readonly showAreaFills = signal(
    localStorage.getItem(SHOW_AREA_FILLS_KEY) !== 'false'
  );

  /** Interpolates line segments for smoother curves. Defaults to false, matching legacy. */
  readonly smoothLines = signal(
    localStorage.getItem(SMOOTH_LINES_KEY) === 'true'
  );

  /** Shows per-point value labels when zoomed in close enough. Defaults to false, matching legacy. */
  readonly showLabels = signal(
    localStorage.getItem(SHOW_LABELS_KEY) === 'true'
  );

  /** Persists collapsed/expanded sidebar sections across reloads. Defaults to true, matching legacy. */
  readonly persistence = signal(
    localStorage.getItem(PERSISTENCE_KEY) !== 'false'
  );

  /**
   * Legacy's "High Performance" toggle: present in legacy's UI and
   * persisted, but legacy/src/chartmanager.js never actually reads it —
   * it's a no-op there too. Ported here as a UI-only toggle for parity
   * rather than inventing new rendering behavior it never had.
   */
  readonly performance = signal(
    localStorage.getItem(PERFORMANCE_KEY) === 'true'
  );

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

  setRememberFiles(value: boolean): void {
    localStorage.setItem(REMEMBER_FILES_KEY, String(value));
    this.rememberFiles.set(value);
  }

  setShowAreaFills(value: boolean): void {
    localStorage.setItem(SHOW_AREA_FILLS_KEY, String(value));
    this.showAreaFills.set(value);
  }

  setSmoothLines(value: boolean): void {
    localStorage.setItem(SMOOTH_LINES_KEY, String(value));
    this.smoothLines.set(value);
  }

  setShowLabels(value: boolean): void {
    localStorage.setItem(SHOW_LABELS_KEY, String(value));
    this.showLabels.set(value);
  }

  /** Port of legacy/src/preferences.js's `set prefs`, which drops the saved sidebar layout the moment persistence is turned off. */
  setPersistence(value: boolean): void {
    localStorage.setItem(PERSISTENCE_KEY, String(value));
    this.persistence.set(value);
    if (!value) {
      localStorage.removeItem(SIDEBAR_STATE_KEY);
    }
  }

  setPerformance(value: boolean): void {
    localStorage.setItem(PERFORMANCE_KEY, String(value));
    this.performance.set(value);
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
}
