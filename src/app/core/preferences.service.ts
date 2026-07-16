import { Injectable } from '@angular/core';

const CLIENT_ID_KEY = 'giulia_google_client_id';

/**
 * Minimal port of legacy/src/preferences.js — only the Google Client ID
 * fallback (used when the backend config endpoint is unreachable) is needed
 * for Milestone 2. Theme/persistence/palette prefs land in a later milestone.
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
}
