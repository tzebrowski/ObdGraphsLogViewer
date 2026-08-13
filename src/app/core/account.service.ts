import { Injectable, signal } from '@angular/core';

export interface AccountUser {
  id: string;
  email: string;
  displayName: string;
  photoUrl: string | null;
}

export interface AccountResult {
  ok: boolean;
  error?: string;
}

const API_BASE_URL = 'https://api.my-giulia.com';
const TOKEN_LS_KEY = 'giulia_account_token';

/**
 * Identity/entitlement client for mygiulia-backend's own users/subscriptions/features system
 * (`ObdGraphsBackend/src/mygiulia/account/`) — independent from (redundant with, not shared
 * with) the similarly-shaped system `tuning-tools/webapp`'s AccountService talks to on
 * hextune-backend; same design, separate data. Google-only (via `loginWithGoogle`, fed an
 * access token AuthService already obtained for Drive access — this service never talks to
 * Google directly). A stateless JWT from the backend is persisted in localStorage and sent as a
 * bearer token to restore the session on reload.
 *
 * Deliberately doesn't port AccountService.fetchModuleToken() from tuning-tools/webapp: that
 * mints a token gating *network delivery* of a separate lazy-loaded JS chunk, which nothing in
 * this app uses yet (the Drive panel ships in the main bundle) — add it if/when a premium
 * feature actually needs gated code delivery.
 */
@Injectable({ providedIn: 'root' })
export class AccountService {
  private readonly _isSignedIn = signal(false);
  private readonly _user = signal<AccountUser | null>(null);
  private readonly _ready = signal(false);
  private readonly _features = signal<ReadonlySet<string>>(new Set());

  readonly isSignedIn = this._isSignedIn.asReadonly();
  readonly user = this._user.asReadonly();
  readonly ready = this._ready.asReadonly();
  readonly features = this._features.asReadonly();

  private initPromise: Promise<void> | null = null;

  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInit();
    }
    return this.initPromise;
  }

  hasFeature(name: string): boolean {
    return this._features().has(name);
  }

  /**
   * `accessToken` must already carry the `email` scope (see AuthService's SCOPES) — the backend
   * verifies it independently via Google's tokeninfo endpoint and never trusts
   * `displayNameHint`/`photoUrlHint` for anything security-critical; they're just cosmetic
   * seeding for a brand-new account.
   */
  async loginWithGoogle(
    accessToken: string,
    displayNameHint?: string,
    photoUrlHint?: string
  ): Promise<AccountResult> {
    try {
      const resp = await fetch(`${API_BASE_URL}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken,
          displayName: displayNameHint,
          photoUrl: photoUrlHint,
        }),
      });
      const data = (await resp.json()) as {
        token?: string;
        user?: AccountUser;
        error?: string;
        features?: string[];
      };
      if (!resp.ok || !data.token || !data.user) {
        return {
          ok: false,
          error: data.error ?? 'Something went wrong. Please try again.',
        };
      }
      this.writeToken(data.token);
      this._user.set(data.user);
      this._isSignedIn.set(true);
      // Fast path: the response already carries the same features snapshot embedded in the JWT,
      // so seed it immediately rather than waiting on the live round trip below.
      if (data.features) this._features.set(new Set(data.features));
      await this.fetchFeatures(data.token);
      return { ok: true };
    } catch (err) {
      console.error('Account request failed:', err);
      return {
        ok: false,
        error: 'Could not reach the server. Please try again.',
      };
    }
  }

  /** No server call -- the session is a stateless JWT, so there's nothing to invalidate remotely. */
  logout(): void {
    this._isSignedIn.set(false);
    this._user.set(null);
    this._features.set(new Set());
    this.clearToken();
  }

  private async doInit(): Promise<void> {
    try {
      const token = this.readToken();
      if (!token) return;

      const resp = await fetch(`${API_BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        this.clearToken();
        return;
      }
      const data = (await resp.json()) as {
        user: AccountUser;
        features?: string[];
      };
      this._user.set(data.user);
      this._isSignedIn.set(true);
      // Fast path: /api/auth/me echoes the JWT's own features claim statelessly, so seed it
      // immediately rather than waiting on the live round trip below.
      if (data.features) this._features.set(new Set(data.features));
      await this.fetchFeatures(token);
    } catch (err) {
      console.error('Account session restore failed:', err);
      this.clearToken();
    } finally {
      this._ready.set(true);
    }
  }

  /** Fails closed (empty set) on any error -- matches how Drive access already silently no-ops when unavailable rather than surfacing a hard error for a non-critical entitlement check. */
  private async fetchFeatures(token: string): Promise<void> {
    try {
      const resp = await fetch(`${API_BASE_URL}/api/features`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        this._features.set(new Set());
        return;
      }
      const data = (await resp.json()) as { features: string[] };
      this._features.set(new Set(data.features));
    } catch (err) {
      console.error('Failed to fetch account features:', err);
      this._features.set(new Set());
    }
  }

  private readToken(): string | null {
    try {
      return localStorage.getItem(TOKEN_LS_KEY) || null;
    } catch {
      return null;
    }
  }

  private writeToken(token: string): void {
    try {
      localStorage.setItem(TOKEN_LS_KEY, token);
    } catch {
      /* ignore */
    }
  }

  private clearToken(): void {
    try {
      localStorage.removeItem(TOKEN_LS_KEY);
    } catch {
      /* ignore */
    }
  }
}
