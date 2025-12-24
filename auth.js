const Auth = {
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
    getFolderId: async (folderName, parentId = 'root') => {
        try {
            const q = `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and '${parentId}' in parents and trashed=false`;
            const res = await gapi.client.drive.files.list({
                q: q,
                fields: 'files(id, name)',
                pageSize: 1
            });
            return res.result.files.length > 0 ? res.result.files[0].id : null;
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
            const rootFolderId = await Drive.getFolderId('mygiulia', 'root');
            if (!rootFolderId) {
                const altRoot = await Drive.getFolderId('MyGiulia', 'root');
                if(!altRoot) {
                    listEl.innerHTML = '<div style="padding:5px; color:orange;">Folder "mygiulia" (or MyGiulia) not found.</div>';
                    return;
                }
                return Drive.scanSubFolder(altRoot, 'trips', listEl);
            }
            
            await Drive.scanSubFolder(rootFolderId, 'trips', listEl);

        } catch (e) {
            console.error(e);
            listEl.innerHTML = '<div style="padding:5px; color:red;">Error: ' + (e.result?.error?.message || e.message) + '</div>';
            if(e.status === 401 || e.status === 403) gapi.client.setToken(null);
        }
    },

    scanSubFolder: async (parentId, childName, listEl) => {
        const targetFolderId = await Drive.getFolderId(childName, parentId);
        if (!targetFolderId) {
            const altTarget = await Drive.getFolderId('Trips', parentId);
            if(!altTarget) {
                 listEl.innerHTML = `<div style="padding:5px; color:orange;">Folder "${childName}" not found inside parent.</div>`;
                 return;
            }
            return Drive.fetchFiles(altTarget, listEl);
        }
        await Drive.fetchFiles(targetFolderId, listEl);
    },

    fetchFiles: async (folderId, listEl) => {
        listEl.innerHTML = '<div style="padding:5px;">Scanning files...</div>';

        const res = await gapi.client.drive.files.list({
            pageSize: 20,
            fields: "files(id, name, size, modifiedTime)",
            q: `'${folderId}' in parents and name contains '.json' and trashed=false`,
            orderBy: 'createdTime desc'
        });

        const files = res.result.files.filter(f => f.name.toLowerCase().endsWith('.json'));

        if (files && files.length > 0) {
            listEl.innerHTML = files.map(f => {
                const size = f.size ? (f.size / 1024).toFixed(0) + ' KB' : '0 KB';
                const date = f.modifiedTime ? new Date(f.modifiedTime).toLocaleString() : '';

                return `
                <div class="drive-file-row" onclick="Drive.loadFile('${f.id}', this)">
                    <div style="font-weight:bold;">${f.name}</div>
                    <div style="font-size:0.8em; color:#666; display:flex; justify-content:space-between;">
                        <span>${date}</span>
                        <span>${size}</span>
                    </div>
                </div>`;
            }).join('');
        } else {
            listEl.innerHTML = '<div style="padding:5px;">No .json files found in folder.</div>';
        }
    },

    loadFile: async (id, element) => {
        if (element) {
            // Remove highlighting from all rows
            document.querySelectorAll('.drive-file-row').forEach(row => {
                row.style.background = '';
                row.style.borderLeft = '';
            });
            // Add highlighting to the clicked row (matching the app's red theme)
            element.style.background = '#ffebeb';
            element.style.borderLeft = '3px solid #9a0000';
        }
        // ------------------------------------

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