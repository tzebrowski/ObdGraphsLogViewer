import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VersionCheckService } from './version-check.service';
import { BUILD_ID } from './version.generated';

/**
 * VersionCheckService wraps Angular's isDevMode() in a protected method
 * (see the class) specifically so it can be stubbed here — Vitest can't
 * spy on '@angular/core's own export (frozen ESM module namespace).
 */
function stubDevMode(devMode: boolean): void {
  vi.spyOn(
    VersionCheckService.prototype as unknown as { isDevMode(): boolean },
    'isDevMode'
  ).mockReturnValue(devMode);
}

describe('VersionCheckService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does nothing while isDevMode() is true', async () => {
    stubDevMode(true);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    new VersionCheckService().start();
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('outside dev mode', () => {
    beforeEach(() => {
      stubDevMode(false);
    });

    it('checks immediately and flags an update when the fetched build id differs', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ buildId: 'a-different-build' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new VersionCheckService();
      service.start();
      await Promise.resolve();
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledWith(
        '/version.json',
        expect.objectContaining({ cache: 'no-store' })
      );
      expect(service.updateAvailable()).toBe(true);
    });

    it('leaves updateAvailable false when the fetched build id matches', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ buildId: BUILD_ID }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new VersionCheckService();
      service.start();
      await Promise.resolve();
      await Promise.resolve();

      expect(service.updateAvailable()).toBe(false);
    });

    it('re-checks on the poll interval', async () => {
      vi.useFakeTimers();
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
      vi.stubGlobal('fetch', fetchMock);

      new VersionCheckService().start();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('re-checks when the tab becomes visible again', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
      vi.stubGlobal('fetch', fetchMock);
      // Capture just this instance's listener instead of dispatching a real
      // event on the shared jsdom `document`, which would also re-trigger
      // listeners left behind by earlier tests in this file.
      const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

      new VersionCheckService().start();
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const visibilityHandler = addEventListenerSpy.mock.calls.find(
        ([type]) => type === 'visibilitychange'
      )?.[1] as EventListener;
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      });
      visibilityHandler(new Event('visibilitychange'));
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('swallows fetch errors and leaves updateAvailable false', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('network down'))
      );

      const service = new VersionCheckService();
      service.start();
      await Promise.resolve();
      await Promise.resolve();

      expect(service.updateAvailable()).toBe(false);
    });

    it('dismiss() resets updateAvailable', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ buildId: 'a-different-build' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new VersionCheckService();
      service.start();
      await Promise.resolve();
      await Promise.resolve();
      expect(service.updateAvailable()).toBe(true);

      service.dismiss();

      expect(service.updateAvailable()).toBe(false);
    });

    it('reload() reloads the page', () => {
      const reloadMock = vi.fn();
      vi.stubGlobal('location', { reload: reloadMock });

      new VersionCheckService().reload();

      expect(reloadMock).toHaveBeenCalled();
    });
  });
});
