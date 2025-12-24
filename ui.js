const UI = {
    // Use Getters to ensure elements are fetched only when accessed
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

    toggleConfig: () => {
        const p = DOM.get('configPanel');
        if (!p) return;

        // Check current state
        const isHidden = p.style.display === 'none' || p.style.display === '';
        
        if (isHidden) {
            p.style.display = 'block'; // Expand
        } else {
            p.style.display = 'none';  // Collapse and restore space
        }

        // Force Sidebar to recalculate its scroll height
        const sidebar = DOM.get('sidebar');
        if (sidebar) sidebar.style.display = 'flex'; 
    },

    init() {
        const el = this.elements; // Accessing the getter here
        if (el.sidebar) {
           el.sidebar.classList.add('flex-column-container');
        }
    },

    setLoading(isLoading, text = "Loading...", onCancel = null) {
        const { loadingOverlay, loadingText, cancelBtn } = this.elements;
        
        // Safety check to prevent the TypeError if elements are missing
        if (!loadingOverlay || !loadingText) {
            console.error("UI Error: Loading elements not found in DOM.");
            return;
        }

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
        this.elements.sidebar.classList.toggle('collapsed');
        // Ensure chart resizes after the CSS transition
        setTimeout(() => AppState.chartInstance?.resize(), 350);
    },

    toggleFullScreen() {
        if (!document.fullscreenElement) {
            this.elements.mainContent.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    },

    renderSignalList() {
        const container = this.elements.signalList;
        container.innerHTML = '';
        
        const fragment = document.createDocumentFragment(); // Batch DOM updates

        AppState.availableSignals.forEach((key, idx) => {
            const isImportant = ["Boost", "RPM", "Pedal", "Trim", "Advance"]
                .some(k => key.includes(k));
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

        // Event Delegation: One listener for all checkboxes
        container.onclick = (e) => {
            if (e.target.tagName === 'INPUT') {
                const key = e.target.getAttribute('data-key');
                this.syncSignalVisibility(key, e.target.checked);
            }
        };
    },

    syncSignalVisibility(key, isVisible) {
        const dataset = AppState.chartInstance?.data.datasets.find(d => d.label === key);
        if (dataset) {
            dataset.hidden = !isVisible;
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