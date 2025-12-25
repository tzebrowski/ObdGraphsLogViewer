const Auth = {
    SCOPES: 'https://www.googleapis.com/auth/drive.readonly',
    DISCOVERY_DOC: 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
    onAuthSuccess: null, // Placeholder for the callback

    init: () => {
        const cId = localStorage.getItem('alfa_clientId');
        if (cId) DOM.get('gClientId').value = cId;
        if (window.gapi) gapi.load('client', Auth.initGapiClient);
        if (window.google) Auth.initTokenClient();
    },

    saveConfig: () => {
        const cId = DOM.get('gClientId').value;
        if (!cId) { alert("Please enter a Client ID."); return; }
        localStorage.setItem('alfa_clientId', cId);
        Auth.initTokenClient();
        alert("Configuration Saved!");
    },

    initGapiClient: async () => {
        await gapi.client.init({ discoveryDocs: [Auth.DISCOVERY_DOC] });
        AppState.google.gapiInited = true;
    },

    initTokenClient: () => {
        const cId = DOM.get('gClientId').value;
        if (!cId) return;

        AppState.google.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: cId,
            scope: Auth.SCOPES,
            callback: (resp) => {
                if (resp.error !== undefined) throw (resp);
                Auth.onTokenReceived();
            },
        });
        AppState.google.gisInited = true;
    },

    handleAuth: () => {
        if (!AppState.google.gapiInited || !AppState.google.gisInited) {
            Auth.initTokenClient();
            if(!DOM.get('gClientId').value) {
                alert("Please click 'Drive Config' and enter your Client ID first.");
                return;
            }
        }
        
        const existingToken = gapi.client.getToken();
        if (existingToken && Date.now() < existingToken.expires_at) {
             // Decoupled: Call the callback instead of Drive directly
             if (Auth.onAuthSuccess) Auth.onAuthSuccess();
        } else {
            AppState.google.tokenClient.requestAccessToken({prompt: ''});
        }
    },

    onTokenReceived: async () => {
        // Decoupled: Call the callback
        if (Auth.onAuthSuccess) await Auth.onAuthSuccess();
    }
};