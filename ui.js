const UI = {
    get elements() {
        return {
            resizer: document.getElementById('resizer'),
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

    init() {
        UI.initResizer();
    },

    initResizer() {
        const resizer = UI.elements.resizer;
        const sidebar = UI.elements.sidebar;
        let isResizing = false;

        if (!resizer || !sidebar) return;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            // Add a temporary overlay to prevent iframe/chart interference while dragging
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            // Calculate new width based on mouse position
            let newWidth = e.clientX;

            // Constraints (matches CSS min/max)
            if (newWidth >= 250 && newWidth <= 600) {
                sidebar.style.width = `${newWidth}px`;

                // Trigger chart resize in real-time or debounced
                if (AppState.chartInstance) {
                    AppState.chartInstance.resize();
                }
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = 'default';
                document.body.style.userSelect = 'auto';
            }
        });
    },

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
    
    toggleInfo: () => {
        const modal = document.getElementById('infoModal');
        if (!modal) return;
        
        const isHidden = modal.style.display === 'none';
        modal.style.display = isHidden ? 'flex' : 'none';
    },
       
    renderSignalList() {
        const container = document.getElementById('signalList');
        if (!container) return;
        container.innerHTML = '';

        // Use available signals from the primary file or the global state
        const signals = AppState.availableSignals || [];
        const fragment = document.createDocumentFragment();

        signals.forEach((key, idx) => {
            const isImportant = DEFAULT_SIGNALS.some(k => key.includes(k));
            const color = CHART_COLORS[idx % CHART_COLORS.length];

            const label = document.createElement('label');
            label.className = 'signal-item';
            label.innerHTML = `
                <input type="checkbox" data-key="${key}" ${isImportant ? 'checked' : ''}>
                <span class="color-swatch" style="background:${color};"></span>
                <span class="signal-name">${key}</span>
            `;
            fragment.appendChild(label);
        });

        container.appendChild(fragment);

        // Event Delegation for checkboxes
        container.onchange = (e) => {
            if (e.target.tagName === 'INPUT') {
                this.syncSignalVisibility(e.target.getAttribute('data-key'), e.target.checked);
            }
        };
    },

    syncSignalVisibility(key, isVisible) {
        // Loop through ALL active chart instances to update visibility
        AppState.chartInstances.forEach(chart => {
            const dataset = chart.data.datasets.find(d => d.label === key);
            if (dataset) {
                dataset.hidden = !isVisible;
            }
        });

        // Trigger a batch update for all charts without re-animating
        AppState.chartInstances.forEach(chart => chart.update('none'));
    },

    toggleAllSignals(shouldCheck) {
        const container = document.getElementById('signalList');
        if (!container) return;

        container.querySelectorAll('input').forEach(i => i.checked = shouldCheck);

        AppState.chartInstances.forEach(chart => {
            chart.data.datasets.forEach(ds => ds.hidden = !shouldCheck);
            chart.update('none');
        });
    }
};