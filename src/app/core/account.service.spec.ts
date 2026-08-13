import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountService } from './account.service';

const TOKEN_LS_KEY = 'giulia_account_token';
const USER = {
  id: 'user-1',
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  photoUrl: null,
};

function mockFetchOnce(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

describe('AccountService', () => {
  let account: AccountService;

  beforeEach(() => {
    localStorage.clear();
    account = new AccountService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts signed out and not ready', () => {
    expect(account.isSignedIn()).toBe(false);
    expect(account.user()).toBeNull();
    expect(account.ready()).toBe(false);
  });

  describe('loginWithGoogle()', () => {
    it('returns a generic error when the network request itself fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new Error('network down')
      );

      const result = await account.loginWithGoogle('google-access-token');

      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('signs the user in on success and posts the token + hints to /api/auth/google', async () => {
      const fetchSpy = mockFetchOnce(200, { token: 'tok-google', user: USER });
      mockFetchOnce(200, { features: [] });

      const result = await account.loginWithGoogle(
        'google-access-token',
        'Ada Lovelace',
        'https://example.com/ada.png'
      );

      expect(result).toEqual({ ok: true });
      expect(account.isSignedIn()).toBe(true);
      expect(localStorage.getItem(TOKEN_LS_KEY)).toBe('tok-google');
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/api/auth/google');
      expect(JSON.parse(init.body as string)).toEqual({
        accessToken: 'google-access-token',
        displayName: 'Ada Lovelace',
        photoUrl: 'https://example.com/ada.png',
      });
    });

    it('works without display name/photo hints (omitted from the JSON body)', async () => {
      const fetchSpy = mockFetchOnce(200, { token: 'tok-google', user: USER });
      mockFetchOnce(200, { features: [] });

      await account.loginWithGoogle('google-access-token');

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.accessToken).toBe('google-access-token');
      expect(body.displayName).toBeUndefined();
      expect(body.photoUrl).toBeUndefined();
    });

    it('surfaces a backend error (e.g. invalid/expired Google token)', async () => {
      mockFetchOnce(401, { error: 'Invalid Google access token' });

      const result = await account.loginWithGoogle('bad-token');

      expect(result).toEqual({
        ok: false,
        error: 'Invalid Google access token',
      });
      expect(account.isSignedIn()).toBe(false);
    });
  });

  describe('logout()', () => {
    it('clears signed-in state and the persisted token', async () => {
      mockFetchOnce(200, { token: 'tok-xyz', user: USER });
      mockFetchOnce(200, { features: [] });
      await account.loginWithGoogle('google-access-token');

      account.logout();

      expect(account.isSignedIn()).toBe(false);
      expect(account.user()).toBeNull();
      expect(localStorage.getItem(TOKEN_LS_KEY)).toBeNull();
    });
  });

  describe('init() -- session restore', () => {
    it('does nothing when no token is stored', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      await account.init();

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(account.isSignedIn()).toBe(false);
      expect(account.ready()).toBe(true);
    });

    it('restores the session from a valid stored token', async () => {
      localStorage.setItem(TOKEN_LS_KEY, 'tok-abc');
      mockFetchOnce(200, { user: USER });
      mockFetchOnce(200, { features: ['google-drive-access'] });

      await account.init();

      expect(account.isSignedIn()).toBe(true);
      expect(account.user()).toEqual(USER);
      expect(account.ready()).toBe(true);
      expect(account.hasFeature('google-drive-access')).toBe(true);
    });

    it('clears a stale/invalid stored token instead of leaving stale signed-in state', async () => {
      localStorage.setItem(TOKEN_LS_KEY, 'expired-token');
      mockFetchOnce(401, { error: 'Invalid or expired token' });

      await account.init();

      expect(account.isSignedIn()).toBe(false);
      expect(account.user()).toBeNull();
      expect(localStorage.getItem(TOKEN_LS_KEY)).toBeNull();
      expect(account.ready()).toBe(true);
    });

    it('is idempotent -- a second call does not re-fetch', async () => {
      localStorage.setItem(TOKEN_LS_KEY, 'tok-abc');
      mockFetchOnce(200, { user: USER });
      mockFetchOnce(200, { features: [] });
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      await account.init();
      await account.init();

      // One call for /api/auth/me + one for /api/features -- not re-issued on the second init().
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });
});
