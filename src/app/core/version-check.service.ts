import { Injectable, isDevMode, signal } from '@angular/core';
import { BUILD_ID } from './version.generated';

const POLL_INTERVAL_MS = 20 * 60 * 1000;

/**
 * Detects that the server has redeployed since this tab loaded, by polling
 * a build id stamped into the deployed static assets (see
 * scripts/gen-version.js) and comparing it against the id compiled into
 * this running bundle. Ported from tuning-tools/webapp's VersionCheckService
 * (the hextune app) to keep update-notification behavior aligned across
 * both apps in the product line — see CLAUDE.md's "Related repos" note.
 */
@Injectable({ providedIn: 'root' })
export class VersionCheckService {
  readonly updateAvailable = signal(false);
  private started = false;

  start(): void {
    if (this.isDevMode() || this.started) {
      return;
    }
    this.started = true;
    void this.check();
    setInterval(() => void this.check(), POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void this.check();
      }
    });
  }

  dismiss(): void {
    this.updateAvailable.set(false);
  }

  reload(): void {
    window.location.reload();
  }

  /**
   * Thin wrapper around Angular's isDevMode() so tests can stub it —
   * Vitest can't spy on '@angular/core's own export directly (frozen ESM
   * module namespace), but a mutable prototype method is easy to stub.
   */
  protected isDevMode(): boolean {
    return isDevMode();
  }

  private async check(): Promise<void> {
    try {
      const resp = await fetch('/version.json', { cache: 'no-store' });
      if (!resp.ok) {
        return;
      }
      const data = (await resp.json()) as { buildId?: string };
      if (data.buildId && data.buildId !== BUILD_ID) {
        this.updateAvailable.set(true);
      }
    } catch {
      // Swallow; the next poll or visibility check retries.
    }
  }
}
