const Auth = {
    // Scope 'drive.readonly' allows reading file metadata and content
    SCOPES: 'https://www.googleapis.com/auth/drive.readonly',
    DISCOVERY_DOC: 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',

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

    toggleConfig: () => {
        const p = DOM.get('configPanel');
        p.style.display = p.style.display === 'block' ? 'none' : 'block';
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
             Drive.listFiles();
        } else {
            AppState.google.tokenClient.requestAccessToken({prompt: ''});
        }
    },

    onTokenReceived: async () => {
        await Drive.listFiles();
    }
};

const Drive = {
    // Helper to find a folder's ID by name inside a parent
    getFolderId: async (folderName, parentId = 'root') => {
        try {
            const q = `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and '${parentId}' in parents and trashed=false`;
            const res = await gapi.client.drive.files.list({
                q: q,
                fields: 'files(id, name)',
                pageSize: 1
            });
            if (res.result.files.length > 0) {
                return res.result.files[0].id;
            }
            return null;
        } catch (e) {
            console.error("Error finding folder:", folderName, e);
            return null;
        }
    },

    listFiles: async () => {
        const listEl = DOM.get('driveList');
        listEl.style.display = 'block';
        listEl.innerHTML = '<div style="padding:5px;">Locating "mygiulia/trips"...</div>';

        try {
            // --- STEP 1: RESOLVE PATH "mygiulia/trips" ---
            
            // Find "mygiulia" in root
            const rootFolderId = await Drive.getFolderId('mygiulia', 'root');
            if (!rootFolderId) {
                listEl.innerHTML = '<div style="padding:5px; color:orange;">Folder "mygiulia" not found in root.</div>';
                return;
            }

            // Find "trips" inside "mygiulia"
            const targetFolderId = await Drive.getFolderId('trips', rootFolderId);
            if (!targetFolderId) {
                listEl.innerHTML = '<div style="padding:5px; color:orange;">Folder "trips" not found inside "mygiulia".</div>';
                return;
            }

            // --- STEP 2: LIST FILES IN TARGET FOLDER ---
            listEl.innerHTML = '<div style="padding:5px;">Scanning files...</div>';

            const res = await gapi.client.drive.files.list({
                pageSize: 20,
                fields: "files(id, name)",
                // Search specifically inside the resolved ID
                // and mimeType='application/plain' 
                q: `'${targetFolderId}' in parents and trashed=false`,
                orderBy: 'createdTime desc'
            });

            const files = res.result.files;
            if (files && files.length > 0) {
                listEl.innerHTML = files.map(f => 
                    `<div class="drive-file-row" onclick="Drive.loadFile('${f.id}')">${f.name}</div>`
                ).join('');
            } else {
                listEl.innerHTML = '<div style="padding:5px;">No JSON files found in "mygiulia/trips".</div>';
            }

        } catch (e) {
            console.error(e);
            listEl.innerHTML = '<div style="padding:5px; color:red;">Error accessing Drive. Check Console.</div>';
            if(e.status === 401 || e.status === 403) {
                 gapi.client.setToken(null);
            }
        }
    },

    loadFile: async (id) => {
        DOM.get('fileInfo').innerText = "Downloading...";
        try {
            const res = await gapi.client.drive.files.get({ fileId: id, alt: 'media' });
            DataProcessor.process(res.result);
            DOM.get('fileInfo').innerText = "Loaded remote file.";
        } catch (e) {
            alert("Error downloading file: " + e.message);
        }
    }
};