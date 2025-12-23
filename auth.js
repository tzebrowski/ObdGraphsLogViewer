// auth.js

const Auth = {
    init: () => {
        const cId = localStorage.getItem('alfa_clientId');
        const apiKey = localStorage.getItem('alfa_apiKey');
        if (cId) DOM.get('gClientId').value = cId;
        if (apiKey) DOM.get('gApiKey').value = apiKey;

        if (window.google) Auth.gisLoaded();
        if (window.gapi) Auth.gapiLoaded();
    },

    saveConfig: () => {
        localStorage.setItem('alfa_clientId', DOM.get('gClientId').value);
        localStorage.setItem('alfa_apiKey', DOM.get('gApiKey').value);
        alert("Keys Saved! Please refresh the page.");
    },

    toggleConfig: () => {
        const p = DOM.get('configPanel');
        p.style.display = p.style.display === 'block' ? 'none' : 'block';
    },

    gapiLoaded: () => gapi.load('client', Auth.initGapiClient),
    
    initGapiClient: async () => {
        const k = DOM.get('gApiKey').value;
        if (!k) return;
        await gapi.client.init({ apiKey: k, discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"] });
        AppState.google.gapiInited = true;
    },

    gisLoaded: () => {
        const c = DOM.get('gClientId').value;
        if (!c) return;
        AppState.google.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: c,
            scope: 'https://www.googleapis.com/auth/drive.readonly',
            callback: '' 
        });
        AppState.google.gisInited = true;
    },

    handleAuth: () => {
        if (!AppState.google.gapiInited || !AppState.google.gisInited) {
            alert("Please configure keys first (click Drive Config)");
            return;
        }
        AppState.google.tokenClient.callback = async (resp) => {
            if (resp.error) throw resp;
            await Drive.listFiles();
        };
        const token = gapi.client.getToken();
        token === null 
            ? AppState.google.tokenClient.requestAccessToken({ prompt: 'consent' }) 
            : AppState.google.tokenClient.requestAccessToken({ prompt: '' });
    }
};

const Drive = {
    listFiles: async () => {
        const listEl = DOM.get('driveList');
        listEl.style.display = 'block';
        listEl.innerHTML = '<div style="padding:5px;">Scanning...</div>';

        try {
            const res = await gapi.client.drive.files.list({
                pageSize: 10,
                fields: "files(id,name)",
                q: "mimeType='application/json' and trashed=false",
                orderBy: 'createdTime desc'
            });

            const files = res.result.files;
            if (files && files.length > 0) {
                listEl.innerHTML = files.map(f => 
                    `<div class="drive-file-row" onclick="Drive.loadFile('${f.id}')">${f.name}</div>`
                ).join('');
            } else {
                listEl.innerHTML = 'No JSON files found.';
            }
        } catch (e) {
            listEl.innerHTML = 'Error: ' + e.message;
        }
    },

    loadFile: async (id) => {
        DOM.get('fileInfo').innerText = "Downloading...";
        try {
            const r = await gapi.client.drive.files.get({ fileId: id, alt: 'media' });
            DataProcessor.process(r.result);
        } catch (e) {
            alert("Error downloading file: " + e.message);
        }
    }
};