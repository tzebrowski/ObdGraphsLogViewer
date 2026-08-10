import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { Auth } from '../src/auth.js';
import { AppState, DOM } from '../src/config.js';
import { messenger } from '../src/bus.js';
import { Alert } from '../src/alert.js';

global.window = Object.create(window || {});
global.gapi = {
  client: {
    init: jest.fn(),
    getToken: jest.fn(),
    setToken: jest.fn(),
    drive: {
      about: {
        get: jest
          .fn()
          .mockResolvedValue({ result: { user: { displayName: 'TestUser' } } }),
      },
    },
  },
  load: jest.fn((api, cb) => cb()),
};

global.google = {
  accounts: {
    oauth2: {
      initTokenClient: jest.fn(),
    },
  },
};

global.fetch = jest.fn();

describe('Auth Module Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    Auth.clientId = null;
    Auth._pendingAction = null;
    AppState.google = {
      gapiInited: false,
      gisInited: false,
      tokenClient: null,
    };

    DOM.get = jest.fn().mockReturnValue({ value: 'local-client-id' });
    messenger.emit = jest.fn();
    messenger.on = jest.fn();
    Alert.showAlert = jest.fn();

    window.toggleUserProfile = jest.fn();
    window.handleAuth = jest.fn();
    window.logoutDrive = jest.fn();

    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('init() fetches config from API and sets clientId', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ googleClientId: 'api-client-id' }),
    });

    jest.spyOn(Auth, 'loadGoogleScripts').mockResolvedValueOnce();

    await Auth.init();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.my-giulia.com/api/config'
    );
    expect(Auth.clientId).toBe('api-client-id');
    expect(window.handleAuth).toBe(Auth.handleAuth);
    expect(window.logoutDrive).toBe(Auth.logoutDrive);
  });

  test('init() alerts user if API fails to load config safely', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network Error'));
    jest.spyOn(Auth, 'loadGoogleScripts').mockResolvedValueOnce();

    await Auth.init();

    expect(Auth.clientId).toBeNull();
    expect(Alert.showAlert).toHaveBeenCalledWith(
      'Failed to load Google Auth configuration. Please enter a Client ID in Settings.',
      'Connection Error',
      'error'
    );
  });

  test('initTokenClient() extracts and calculates expires_at accurately', () => {
    Auth.clientId = 'test-id';
    const mockTokenClient = { requestAccessToken: jest.fn() };
    global.google.accounts.oauth2.initTokenClient.mockReturnValue(
      mockTokenClient
    );

    global.gapi.client.getToken.mockReturnValue({ access_token: 'existing' });

    Auth.initTokenClient();

    expect(global.google.accounts.oauth2.initTokenClient).toHaveBeenCalled();

    const configArg =
      global.google.accounts.oauth2.initTokenClient.mock.calls[0][0];
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    configArg.callback({ access_token: 'new', expires_in: 3600 });

    expect(global.gapi.client.setToken).toHaveBeenCalledWith(
      expect.objectContaining({
        expires_at: now + 3600 * 1000,
      })
    );
  });

  test("handleAuth('profile') calls toggleUserProfile directly if token is valid", async () => {
    AppState.google.gapiInited = true;
    AppState.google.gisInited = true;
    Auth.clientId = 'valid-client-id';

    global.gapi.client.getToken.mockReturnValue({
      access_token: 'valid',
      expires_at: Date.now() + 100000,
    });

    jest.spyOn(Auth, 'fetchUserDetails').mockResolvedValueOnce();

    Auth.handleAuth('profile');

    expect(Auth.fetchUserDetails).toHaveBeenCalled();
    expect(window.toggleUserProfile).toHaveBeenCalled();
  });

  test("handleAuth('drive') saves pending action and requests token if token is expired", () => {
    AppState.google.gapiInited = true;
    AppState.google.gisInited = true;

    Auth.clientId = 'valid-client-id';

    global.gapi.client.getToken.mockReturnValue({
      access_token: 'expired',
      expires_at: Date.now() - 100000,
    });

    AppState.google.tokenClient = { requestAccessToken: jest.fn() };

    Auth.handleAuth('drive');

    expect(Auth._pendingAction).toBe('drive');
    expect(AppState.google.tokenClient.requestAccessToken).toHaveBeenCalledWith(
      { prompt: '' }
    );
  });

  test('logoutDrive() clears session token and emits status-changed event', () => {
    Auth.logoutDrive();

    expect(global.gapi.client.setToken).toHaveBeenCalledWith(null);
    expect(messenger.emit).toHaveBeenCalledWith('auth:status-changed', {
      isLoggedIn: false,
    });
  });
});
