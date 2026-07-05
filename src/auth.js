import { AppState, DOM } from './config.js';
import { Alert } from './alert.js';
import { messenger } from './bus.js';

export const Auth = {
  SCOPES: 'https://www.googleapis.com/auth/drive.readonly',
  DISCOVERY_DOC: 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
  onAuthSuccess: null,
  clientId: null,
  _pendingAction: null,

  loadGoogleScripts: () => {
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
      gapiScript.onerror = (e) =>
        reject(new Error(`Failed to load GAPI ${e.message}`));

      document.head.appendChild(gsi);
      document.head.appendChild(gapiScript);
    });
  },

  fetchConfig: async () => {
    try {
      const response = await fetch('https://api.my-giulia.com/api/config');
      if (!response.ok)
        throw new Error(`HTTP error! Status: ${response.status}`);

      const config = await response.json();
      Auth.clientId = config.googleClientId;
    } catch (e) {
      console.error('Backend API not reached. Failed to load Client ID:', e);
      Alert.showAlert(
        'Failed to load Google Auth configuration.',
        'Error',
        'error'
      );
    }
  },

  init: async () => {
    window.handleAuth = Auth.handleAuth;
    window.logoutDrive = Auth.logoutDrive;

    try {
      await Auth.fetchConfig();
      await Auth.loadGoogleScripts();

      if (window.gapi && Auth.clientId) {
        gapi.load('client', async () => {
          await Auth.initGapiClient();
          Auth.initTokenClient();
        });
      }
    } catch (error) {
      console.error('Google Auth Initialization Error:', error);
    }
  },

  initGapiClient: async () => {
    await gapi.client.init({ discoveryDocs: [Auth.DISCOVERY_DOC] });
    AppState.google.gapiInited = true;
  },

  initTokenClient: () => {
    // 3. Rely purely on the API-provided client ID
    if (!Auth.clientId || !window.google) return;

    AppState.google.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: Auth.clientId,
      scope: Auth.SCOPES,
      callback: (resp) => {
        if (resp.error !== undefined) {
          console.error('Auth Error:', resp.error);
          return;
        }

        if (window.gapi && gapi.client) {
          let tokenObj = gapi.client.getToken() || resp;
          if (resp.expires_in) {
            tokenObj.expires_at = Date.now() + resp.expires_in * 1000;
          }
          gapi.client.setToken(tokenObj);
        }

        Auth.onTokenReceived();
      },
    });
    AppState.google.gisInited = true;
  },

  fetchUserDetails: async () => {
    try {
      const response = await gapi.client.drive.about.get({ fields: 'user' });
      const user = response.result.user;

      messenger.emit('auth:status-changed', {
        isLoggedIn: true,
        user: user,
      });
    } catch (error) {
      console.error('Failed to fetch user details:', error);
    }
  },

  handleAuth: (targetAction = 'profile') => {
    if (!AppState.google.gapiInited || !AppState.google.gisInited) {
      Auth.initTokenClient();
      if (!Auth.clientId) {
        Alert.showAlert(
          'Google Client ID is missing. Please check your API connection.'
        );
        return;
      }
    }

    let existingToken = null;
    if (
      window.gapi &&
      gapi.client &&
      typeof gapi.client.getToken === 'function'
    ) {
      existingToken = gapi.client.getToken();
    }

    const isTokenValid =
      existingToken &&
      existingToken.access_token &&
      (!existingToken.expires_at || Date.now() < existingToken.expires_at);

    if (isTokenValid) {
      Auth.fetchUserDetails();

      if (targetAction === 'drive') {
        import('./drive.js').then(({ Drive }) => Drive.listFiles());
      } else if (targetAction === 'profile') {
        if (typeof window.toggleUserProfile === 'function') {
          window.toggleUserProfile();
        }
      }
    } else {
      Auth._pendingAction = targetAction;
      if (AppState.google.tokenClient) {
        AppState.google.tokenClient.requestAccessToken({ prompt: '' });
      } else {
        console.error('Token client not ready.');
      }
    }
  },

  onTokenReceived: async () => {
    await Auth.fetchUserDetails();
    if (Auth.onAuthSuccess) await Auth.onAuthSuccess();

    if (Auth._pendingAction === 'drive') {
      import('./drive.js').then(({ Drive }) => Drive.listFiles());
    } else {
      if (typeof window.toggleUserProfile === 'function') {
        window.toggleUserProfile();
      }
    }
    Auth._pendingAction = null;
  },

  logoutDrive: () => {
    if (window.gapi && gapi.client) {
      gapi.client.setToken(null);
    }
    messenger.emit('auth:status-changed', { isLoggedIn: false });
  },
};
