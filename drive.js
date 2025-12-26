let activeLoadToken = 0;

const Drive = {
    PATH_CONFIG: {
        root: 'mygiulia',
        sub: 'trips'
    },

    async findFolderId(name, parentId = 'root') {
        try {
            const query = `mimeType='application/vnd.google-apps.folder' and 
                           (name = '${name}' or name = '${name.toLowerCase()}' or name = '${name.charAt(0).toUpperCase() + name.slice(1)}') 
                           and '${parentId}' in parents and trashed=false`;

            const response = await gapi.client.drive.files.list({
                q: query,
                fields: 'files(id, name)',
                pageSize: 1
            });
            return response.result.files.length > 0 ? response.result.files[0].id : null;
        } catch (error) {
            console.error(`Drive: Error locating folder "${name}":`, error);
            return null;
        }
    },

    async listFiles() {
        const listEl = DOM.get('driveList');
        if (!listEl) return;

        listEl.style.display = 'block';
        listEl.innerHTML = '<div class="status-msg">Searching for logs...</div>';

        try {

            const rootId = await Drive.findFolderId(Drive.PATH_CONFIG.root);
            if (!rootId) {
                listEl.innerHTML = `<div class="error-msg">Folder "${Drive.PATH_CONFIG.root}" not found.</div>`;
                return;
            }

            const subFolderId = await Drive.findFolderId(Drive.PATH_CONFIG.sub, rootId);
            if (!subFolderId) {
                listEl.innerHTML = `<div class="error-msg">Subfolder "${Drive.PATH_CONFIG.sub}" not found.</div>`;
                return;
            }

            await Drive.fetchJsonFiles(subFolderId, listEl);

        } catch (error) {
            Drive.handleApiError(error, listEl);
        }
    },

    async fetchJsonFiles(folderId, listEl) {
        try {
            const res = await gapi.client.drive.files.list({
                pageSize: 25,
                fields: "files(id, name, size, modifiedTime)",
                q: `'${folderId}' in parents and name contains '.json' and trashed=false`,
                orderBy: 'modifiedTime desc'
            });

            const files = res.result.files || [];
            if (files.length === 0) {
                listEl.innerHTML = '<div class="status-msg">No log files found.</div>';
                return;
            }
            listEl.innerHTML = files.map(f => Drive.createFileRowHtml(f)).join('');
        } catch (error) {
            Drive.handleApiError(error, listEl);
        }
    },

    createFileRowHtml(file) {
        const size = file.size ? (file.size / 1024).toFixed(0) + ' KB' : 'Unknown';
        const date = file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : 'N/A';

        return `
            <div class="drive-file-row" onclick="Drive.loadFile('${file.name}','${file.id}', this)">
                <div class="file-name">${file.name}</div>
                <div class="file-meta">
                    <span>${date}</span>
                    <span>${size}</span>
                </div>
            </div>`;
    },

    async loadFile(fileName, id, element) {
        if (element) {
            document.querySelectorAll('.drive-file-row').forEach(r => r.classList.remove('active'));
            element.classList.add('active');
        }

        const currentToken = ++activeLoadToken;
        const cancelTask = () => {
            activeLoadToken++;
            UI.setLoading(false);
            const fileInfo = DOM.get('fileInfo');
            if (fileInfo) fileInfo.innerText = "Load cancelled.";
        };

        UI.setLoading(true, "Fetching from Drive...", cancelTask);
        const fileInfo = DOM.get('fileInfo');
        if (fileInfo) fileInfo.innerText = "Downloading...";

        try {
            const response = await gapi.client.drive.files.get({ fileId: id, alt: 'media' });
            if (currentToken !== activeLoadToken) return;

            UI.setLoading(true, "Processing Log...", null);

            setTimeout(() => {
                if (currentToken !== activeLoadToken) return;
                try {
                    DataProcessor.process(response.result, fileName);
                    const fileInfoFinish = DOM.get('fileInfo');
                    if (fileInfoFinish) fileInfoFinish.innerText = "Drive log loaded successfully.";
                } catch (err) {
                    console.error(`The file content is not a valid log format. Error ${err.message}`)
                    alert("The file content is not a valid log format.");
                } finally {
                    UI.setLoading(false);
                }
            }, 50);

        } catch (error) {
            if (currentToken !== activeLoadToken) return;
            UI.setLoading(false);
            alert(`Drive Error: ${error.result?.error?.message || error.message}`);
        }
    },

    handleApiError(error, listEl) {
        console.error("Drive API Error:", error);         
        if (error.status === 401 || error.status === 403) {
            gapi.client.setToken(null);
            if (listEl) listEl.innerHTML = '<div class="error-msg">Session expired. Please click "Drive Scan" again.</div>';
        } else {
            if (listEl) listEl.innerHTML = `<div class="error-msg">Search failed: ${error.message || 'Unknown error'}</div>`;
        }
    }
};