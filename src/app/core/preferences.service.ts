import { Injectable, signal } from '@angular/core';

const CLIENT_ID_KEY = 'giulia_google_client_id';
const REMEMBER_FILES_KEY = 'giulia_remember_files';
const LOAD_MAP_KEY = 'giulia_load_map';

/**
 * Minimal port of legacy/src/preferences.js — only the Google Client ID
 * fallback, "remember active files", and "load map" toggles are needed so
 * far (Milestones 2-4). Theme/mobile-sidebar/palette prefs are a tracked
 * gap, deferred to a later pass.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  /** Opt-in map rendering (external tile requests + Leaflet cost). Defaults to false, matching legacy. */
  readonly loadMap = signal(localStorage.getItem(LOAD_MAP_KEY) === 'true');

  setLoadMap(value: boolean): void {
    localStorage.setItem(LOAD_MAP_KEY, String(value));
    this.loadMap.set(value);
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
