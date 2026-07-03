import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { Auth } from '../src/auth.js';
import { AppState, DOM } from '../src/config.js';
import { messenger } from '../src/bus.js';
import { Alert } from '../src/alert.js';

// Setup basic global mocks for dependencies
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

    // Reset Auth state
    Auth.clientId = null;
    Auth._pendingAction = null;
    AppState.google = {
      gapiInited: false,
      gisInited: false,
      tokenClient: null,
    };

    // Replaced jest.mock() with direct method overrides on the imported modules
    DOM.get = jest.fn().mockReturnValue({ value: 'local-client-id' });
    messenger.emit = jest.fn();
    messenger.on = jest.fn();
    Alert.showAlert = jest.fn();

    // Window methods utilized in the UI interactions
    window.toggleUserProfile = jest.fn();
    window.handleAuth = jest.fn();
    window.logoutDrive = jest.fn();

    // Setup local storage mock
    Storage.prototype.getItem = jest.fn();
    Storage.prototype.setItem = jest.fn();
  });

  test('init() fetches config from API and sets clientId', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ googleClientId: 'api-client-id' }),
    });

    // Stub out script loading to avoid DOM errors in Jest
    jest.spyOn(Auth, 'loadGoogleScripts').mockResolvedValueOnce();

    await Auth.init();

    expect(global.fetch).toHaveBeenCalledWith('/api/config');
    expect(Auth.clientId).toBe('api-client-id');
    expect(window.handleAuth).toBe(Auth.handleAuth);
    expect(window.logoutDrive).toBe(Auth.logoutDrive);
  });

  test('init() falls back to localStorage if API fails safely', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network Error'));
    jest.spyOn(Auth, 'loadGoogleScripts').mockResolvedValueOnce();
    Storage.prototype.getItem.mockReturnValueOnce('local-client-id');

    await Auth.init();

    expect(Auth.clientId).toBeNull();
    expect(DOM.get).toHaveBeenCalledWith('gClientId');
  });

  test('initTokenClient() extracts and calculates expires_at accurately', () => {
    Auth.clientId = 'test-id';
    const mockTokenClient = { requestAccessToken: jest.fn() };
    global.google.accounts.oauth2.initTokenClient.mockReturnValue(
      mockTokenClient
    );

    // Simulate pre-existing gapi token object
    global.gapi.client.getToken.mockReturnValue({ access_token: 'existing' });

    Auth.initTokenClient();

    expect(global.google.accounts.oauth2.initTokenClient).toHaveBeenCalled();

    // Trigger the callback
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

    global.gapi.client.getToken.mockReturnValue({
      access_token: 'valid',
      expires_at: Date.now() + 100000, // Safely in future
    });

    jest.spyOn(Auth, 'fetchUserDetails').mockResolvedValueOnce();

    Auth.handleAuth('profile');

    expect(Auth.fetchUserDetails).toHaveBeenCalled();
    expect(window.toggleUserProfile).toHaveBeenCalled();
  });

  test("handleAuth('drive') saves pending action and requests token if token is expired", () => {
    AppState.google.gapiInited = true;
    AppState.google.gisInited = true;

    global.gapi.client.getToken.mockReturnValue({
      access_token: 'expired',
      expires_at: Date.now() - 100000, // In the past
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
