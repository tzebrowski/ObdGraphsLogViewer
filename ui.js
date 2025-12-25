const UI = {
    get elements() {
        return {
            sidebar: document.getElementById('sidebar'),
            loadingOverlay: document.getElementById('loadingOverlay'),
            loadingText: document.getElementById('loadingText'),
            cancelBtn: document.getElementById('cancelLoadBtn'),
            signalList: document.getElementById('signalList'),
            mainContent: document.getElementById('mainContent'),
            scanResults: document.getElementById('scanResults'),
            scanCount: document.getElementById('scanCount')
        };
    },

    toggleConfig() {
        const p = DOM.get('configPanel');
        if (!p) return;

        const isHidden = p.style.display === 'none' || p.style.display === '';
        p.style.display = isHidden ? 'block' : 'none';
        
        if (AppState.chartInstance) AppState.chartInstance.resize();
    },

    init() { /* Removed manual style overrides to let CSS handle layout */ },

    setLoading(isLoading, text = "Loading...", onCancel = null) {
        const { loadingOverlay, loadingText, cancelBtn } = this.elements;
        if (!loadingOverlay || !loadingText) return;

        loadingText.innerText = text;
        loadingOverlay.style.display = isLoading ? 'flex' : 'none';
        
        if (isLoading && onCancel) {
            cancelBtn.style.display = 'inline-block';
            cancelBtn.onclick = onCancel;
        } else {
            cancelBtn.style.display = 'none';
        }
    },

    resetScannerUI() {
        AppState.activeHighlight = null;
        this.elements.scanResults.innerHTML = '';
        this.elements.scanResults.style.display = 'none';
        this.elements.scanCount.innerText = '';
    },

    toggleSidebar() {
        const el = UI.elements
        if (el.sidebar) {
            el.sidebar.classList.toggle('collapsed');
            setTimeout(() => AppState.chartInstance?.resize(), 350);
        }
    },

    toggleFullScreen() {
        const content = UI.elements.mainContent;
        if (!content) return;

        if (!document.fullscreenElement) {
            content.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable full-screen mode: ${err.message}`);
            });
        } else {
            document.exitFullscreen();
        }
    },

    renderSignalList() {
        const container = this.elements.signalList;
        container.innerHTML = '';
        const fragment = document.createDocumentFragment();

        AppState.availableSignals.forEach((key, idx) => {
            const isImportant = ["Boost", "RPM", "Pedal", "Trim", "Advance"].some(k => key.includes(k));
            const color = CHART_COLORS[idx % CHART_COLORS.length];
            
            const label = document.createElement('label');
            label.className = 'signal-item';
            label.innerHTML = `
                <input type="checkbox" data-key="${key}" ${isImportant ? 'checked' : ''}>
                <span class="color-swatch" style="background:${color}; display:inline-block; width:10px; height:10px; margin-right:8px;"></span>
                <span class="signal-name">${key}</span>
            `;
            fragment.appendChild(label);
        });

        container.appendChild(fragment);
        container.onclick = (e) => {
            if (e.target.tagName === 'INPUT') {
                this.syncSignalVisibility(e.target.getAttribute('data-key'), e.target.checked);
            }
        };
    },

    syncSignalVisibility(key, isVisible) {
        const ds = AppState.chartInstance?.data.datasets.find(d => d.label === key);
        if (ds) {
            ds.hidden = !isVisible;
            AppState.chartInstance.update('none');
        }
    },

    toggleAllSignals(shouldCheck) {
        this.elements.signalList.querySelectorAll('input').forEach(i => i.checked = shouldCheck);
        if (AppState.chartInstance) {
            AppState.chartInstance.data.datasets.forEach(ds => ds.hidden = !shouldCheck);
            AppState.chartInstance.update();
        }
    }
};