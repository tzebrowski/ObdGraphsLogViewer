import { AppState, DOM } from './config.js';

export const Auth = {
  SCOPES: 'https://www.googleapis.com/auth/drive.readonly',
  DISCOVERY_DOC: 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
  onAuthSuccess: null,

  loadGoogleScripts: () => {
    return new Promise((resolve, reject) => {
      // Check if already loaded to avoid duplicates
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

  init: async () => {
    try {
      await Auth.loadGoogleScripts();

      const cId = localStorage.getItem('alfa_clientId');
      if (cId) {
        const input = DOM.get('gClientId');
        if (input) input.value = cId;
      }

      gapi.load('client', async () => {
        await Auth.initGapiClient();
        Auth.initTokenClient();
      });
    } catch (error) {
      console.error('Google Auth Initialization Error:', error);
    }
  },

  saveConfig: () => {
    const cId = DOM.get('gClientId').value;
    if (!cId) {
      alert('Please enter a Client ID.');
      return;
    }
    localStorage.setItem('alfa_clientId', cId);
    Auth.initTokenClient();
    alert('Configuration Saved!');
  },

  initGapiClient: async () => {
    await gapi.client.init({ discoveryDocs: [Auth.DISCOVERY_DOC] });
    AppState.google.gapiInited = true;
  },

  initTokenClient: () => {
    const cId = DOM.get('gClientId').value;
    if (!cId || !window.google) return;

    AppState.google.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cId,
      scope: Auth.SCOPES,
      callback: (resp) => {
        if (resp.error !== undefined) throw resp;
        Auth.onTokenReceived();
      },
    });
    AppState.google.gisInited = true;
  },

  handleAuth: () => {
    if (!AppState.google.gapiInited || !AppState.google.gisInited) {
      Auth.initTokenClient();
      if (!DOM.get('gClientId').value) {
        alert("Please click 'Drive Config' and enter your Client ID first.");
        return;
      }
    }

    const existingToken = gapi.client.getToken();

    if (
      existingToken &&
      existingToken.expires_at &&
      Date.now() < existingToken.expires_at
    ) {
      if (Auth.onAuthSuccess) Auth.onAuthSuccess();
    } else {
      AppState.google.tokenClient.requestAccessToken({ prompt: '' });
    }
  },

  onTokenReceived: async () => {
    if (Auth.onAuthSuccess) await Auth.onAuthSuccess();
  },
};
