import { Injectable, signal } from '@angular/core';
import { AppStateService } from './app-state.service';
import { DriveUser, GapiToken, GoogleTokenClient } from './google-api.types';
import { PreferencesService } from './preferences.service';

/**
 * Deliberate deviation from legacy/src/auth.js (`drive.readonly`): tagging
 * (appProperties) and public-link sharing write to files discovered via
 * folder-scanning `files.list`, not files created/opened through this app,
 * so `drive.file` doesn't cover them — the full `drive` scope is required.
 * Legacy requested `drive.readonly` while still calling those write
 * endpoints, so tagging/sharing silently failed there at runtime.
 */
const SCOPES = 'https://www.googleapis.com/auth/drive';
const DISCOVERY_DOC =
  'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';

/**
 * Port of legacy/src/auth.js. Loads Google Identity Services (GSI) + GAPI
 * dynamically and manages the Drive OAuth token. The legacy
 * `_pendingAction`/`toggleUserProfile` modal plumbing is dropped — `signIn()`
 * returns a Promise instead, which DriveService awaits before scanning, so
 * there's no need for AuthService to know about DriveService (would
 * otherwise be a circular DI dependency).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly isLoggedIn = signal(false);
  readonly user = signal<DriveUser | null>(null);
  readonly clientId = signal<string | null>(null);
  readonly gapiInited = signal(false);
  readonly gisInited = signal(false);

  private tokenClient: GoogleTokenClient | null = null;
  private pendingSignInResolvers: Array<() => void> = [];

  constructor(
    private readonly preferences: PreferencesService,
    private readonly appState: AppStateService
  ) {}

  async init(): Promise<void> {
    const savedId = this.preferences.googleClientId;
    if (savedId) this.clientId.set(savedId);

    try {
      await this.fetchConfig();
      await this.loadGoogleScripts();

      if (window.gapi) {
        window.gapi.load('client', async () => {
          await this.initGapiClient();
          if (this.clientId()) {
            this.initTokenClient();
          }
        });
      }
    } catch (error) {
      console.error('Google Auth Initialization Error:', error);
    }
  }

  /**
   * Requests Drive access, signing in if needed. Resolves once the session
   * token and user profile are ready (or once the flow is aborted, e.g. no
   * Client ID configured).
   */
  signIn(): Promise<void> {
    if (!this.clientId()) {
      this.appState.showAlert(
        'Google Client ID is missing. Please check your API connection or Settings.'
      );
      return Promise.resolve();
    }

    if (!this.gapiInited() || !this.gisInited()) {
      this.initTokenClient();
      if (!this.clientId()) {
        this.appState.showAlert(
          'Google Client ID is missing. Please check your API connection.'
        );
        return Promise.resolve();
      }
    }

    const existingToken = window.gapi?.client?.getToken?.() ?? null;
    const isTokenValid =
      !!existingToken?.access_token &&
      (!existingToken.expires_at || Date.now() < existingToken.expires_at);

    if (isTokenValid) {
      return this.fetchUserDetails();
    }

    return new Promise<void>((resolve) => {
      this.pendingSignInResolvers.push(resolve);
      if (this.tokenClient) {
        this.tokenClient.requestAccessToken({ prompt: '' });
      } else {
        console.error('Token client not ready.');
        this.resolvePendingSignIns();
      }
    });
  }

  signOut(): void {
    if (window.gapi?.client) {
      window.gapi.client.setToken(null);
    }
    this.isLoggedIn.set(false);
    this.user.set(null);
  }

  saveClientId(id: string): void {
    const val = id.trim();
    this.preferences.googleClientId = val;
    this.clientId.set(val || null);

    if (val) {
      this.appState.showAlert(
        'Google Client ID saved locally for development.'
      );

      if (window.gapi && !this.gapiInited()) {
        window.gapi.load('client', async () => {
          await this.initGapiClient();
          this.initTokenClient();
        });
      } else if (window.google) {
        this.initTokenClient();
      }
    } else {
      this.appState.showAlert('Google Client ID cleared.');
      this.tokenClient = null;
      this.gisInited.set(false);
    }
  }

  getAccessToken(): string | null {
    return window.gapi?.client?.getToken?.()?.access_token ?? null;
  }

  private loadGoogleScripts(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (window.gapi && window.google) return resolve();

      const gsi = document.createElement('script');
      gsi.src = 'https://accounts.google.com/gsi/client';
      gsi.async = true;
      gsi.defer = true;

      const gapiScript = document.createElement('script');
      gapiScript.src = 'https://apis.google.com/js/api.js';
      gapiScript.async = true;
      gapiScript.defer = true;

      gapiScript.onload = () => resolve();
      gapiScript.onerror = () =>
        reject(new Error('Failed to load GAPI script'));

      document.head.appendChild(gsi);
      document.head.appendChild(gapiScript);
    });
  }

  private async fetchConfig(): Promise<void> {
    try {
      const response = await fetch('https://api.my-giulia.com/api/config');
      if (!response.ok)
        throw new Error(`HTTP error! Status: ${response.status}`);

      const config = (await response.json()) as { googleClientId?: string };
      this.clientId.set(config.googleClientId ?? null);
    } catch (e) {
      console.warn('Backend API not reached. Attempting local fallback...', e);

      const fallbackId = this.preferences.googleClientId;
      if (fallbackId) {
        this.clientId.set(fallbackId);
        console.log('Using local fallback Client ID.');
      } else {
        this.appState.showAlert(
          'Failed to load Google Auth configuration. Please enter a Client ID in Settings.'
        );
      }
    }
  }

  private async initGapiClient(): Promise<void> {
    await window.gapi!.client.init({ discoveryDocs: [DISCOVERY_DOC] });
    this.gapiInited.set(true);
  }

  private initTokenClient(): void {
    const clientId = this.clientId();
    if (!clientId || !window.google) return;

    this.tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (resp) => {
        if (resp.error !== undefined) {
          console.error('Auth Error:', resp.error);
          this.resolvePendingSignIns();
          return;
        }

        if (window.gapi?.client) {
          const tokenObj: GapiToken =
            window.gapi.client.getToken() ?? (resp as GapiToken);
          if (resp.expires_in) {
            tokenObj.expires_at = Date.now() + resp.expires_in * 1000;
          }
          window.gapi.client.setToken(tokenObj);
        }

        void this.onTokenReceived();
      },
    });
    this.gisInited.set(true);
  }

  private async fetchUserDetails(): Promise<void> {
    try {
      const response = await window.gapi!.client.drive.about.get({
        fields: 'user',
      });
      this.user.set(response.result.user);
      this.isLoggedIn.set(true);
    } catch (error) {
      console.error('Failed to fetch user details:', error);
    }
  }

  private async onTokenReceived(): Promise<void> {
    await this.fetchUserDetails();
    this.resolvePendingSignIns();
  }

  private resolvePendingSignIns(): void {
    const resolvers = this.pendingSignInResolvers;
    this.pendingSignInResolvers = [];
    resolvers.forEach((resolve) => resolve());
  }
}
