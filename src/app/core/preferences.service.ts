import { Injectable } from '@angular/core';

const CLIENT_ID_KEY = 'giulia_google_client_id';
const REMEMBER_FILES_KEY = 'giulia_remember_files';

/**
 * Minimal port of legacy/src/preferences.js — only the Google Client ID
 * fallback and "remember active files" toggle are needed so far (Milestones
 * 2-3a). Theme/persistence/palette prefs land in a later milestone.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
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
