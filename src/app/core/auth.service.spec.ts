import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStateService } from './app-state.service';
import { AuthService } from './auth.service';
import { EventBusService } from './event-bus.service';
import { GoogleAccountsOAuth2CallbackResponse } from './google-api.types';
import { PreferencesService } from './preferences.service';

describe('AuthService', () => {
  let appState: AppStateService;
  let preferences: PreferencesService;
  let auth: AuthService;

  let gapiClient: {
    init: ReturnType<typeof vi.fn>;
    getToken: ReturnType<typeof vi.fn>;
    setToken: ReturnType<typeof vi.fn>;
    drive: {
      about: { get: ReturnType<typeof vi.fn> };
    };
  };
  let tokenClientCallback:
    ((resp: GoogleAccountsOAuth2CallbackResponse) => void) | null;
  let initTokenClientMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    appState = new AppStateService(new EventBusService());
    preferences = new PreferencesService();
    localStorage.clear();
    auth = new AuthService(preferences, appState);

    gapiClient = {
      init: vi.fn().mockResolvedValue(undefined),
      getToken: vi.fn().mockReturnValue(null),
      setToken: vi.fn(),
      drive: {
        about: {
          get: vi.fn().mockResolvedValue({
            result: { user: { displayName: 'TestUser' } },
          }),
        },
      },
    };

    tokenClientCallback = null;
    initTokenClientMock = vi.fn((config) => {
      tokenClientCallback = config.callback;
      return { requestAccessToken: vi.fn() };
    });

    vi.stubGlobal('gapi', {
      client: gapiClient,
      load: vi.fn((_api: string, cb: () => void) => cb()),
    });
    vi.stubGlobal('google', {
      accounts: { oauth2: { initTokenClient: initTokenClientMock } },
    });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('init() fetches config from the backend and sets clientId', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ googleClientId: 'api-client-id' }),
    } as Response);

    await auth.init();

    expect(fetch).toHaveBeenCalledWith('https://api.my-giulia.com/api/config');
    expect(auth.clientId()).toBe('api-client-id');
    expect(auth.gapiInited()).toBe(true);
  });

  it('init() falls back to the locally saved Client ID if the backend is unreachable', async () => {
    preferences.googleClientId = 'local-fallback-id';
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network Error'));

    await auth.init();

    expect(auth.clientId()).toBe('local-fallback-id');
  });

  it('init() alerts the user if the backend fails and no fallback is saved', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network Error'));

    await auth.init();

    expect(auth.clientId()).toBeNull();
    expect(appState.alertMessage()).toBe(
      'Failed to load Google Auth configuration. Please enter a Client ID in Settings.'
    );
  });

  it('signIn() fetches the user profile directly when an existing token is valid', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ googleClientId: 'client-id' }),
    } as Response);
    await auth.init();

    gapiClient.getToken.mockReturnValue({
      access_token: 'valid',
      expires_at: Date.now() + 100000,
    });

    await auth.signIn();

    expect(gapiClient.drive.about.get).toHaveBeenCalled();
    expect(auth.isLoggedIn()).toBe(true);
    expect(auth.user()).toEqual({ displayName: 'TestUser' });
  });

  it('signIn() requests a new token and resolves once the callback fires when the token is missing/expired', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ googleClientId: 'client-id' }),
    } as Response);
    await auth.init();

    gapiClient.getToken.mockReturnValue(null);

    const signInPromise = auth.signIn();

    expect(tokenClientCallback).not.toBeNull();
    tokenClientCallback?.({ access_token: 'fresh', expires_in: 3600 });

    await signInPromise;

    expect(gapiClient.setToken).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: 'fresh' })
    );
    expect(auth.isLoggedIn()).toBe(true);
  });

  it('signOut() clears the gapi token and resets auth state', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ googleClientId: 'client-id' }),
    } as Response);
    await auth.init();

    gapiClient.getToken.mockReturnValue({
      access_token: 'valid',
      expires_at: Date.now() + 100000,
    });
    await auth.signIn();

    auth.signOut();

    expect(gapiClient.setToken).toHaveBeenCalledWith(null);
    expect(auth.isLoggedIn()).toBe(false);
    expect(auth.user()).toBeNull();
  });
});
