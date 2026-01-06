import { ChartManager } from './chartmanager.js';
import { Preferences } from './preferences.js';
import { UI } from './ui.js';
import { AppState } from './config.js';

export const PaletteManager = {
  CHART_COLORS: [
    '#e31837',
    '#0051ba',
    '#2dcc70',
    '#f1c40f',
    '#8e44ad',
    '#e67e22',
    '#00F2FF',
    '#39FF14',
    '#FF007F',
    '#FFFF00',
    '#BC13FE',
    '#FF4D00',
    '#00FF9F',
    '#FFD700',
    '#FF0000',
  ],

  CHART_COLORS_LIGHT: [
    '#1A73E8',
    '#2E7D32',
    '#C2185B',
    '#F57C00',
    '#7B1FA2',
    '#D32F2F',
    '#0097A7',
    '#607D8B',
    '#AFB42B',
  ],

  init() {
    this.render();

    const customToggle = document.getElementById('pref-custom-palette');
    const settingsRow = document.getElementById('palette-settings-row');

    if (customToggle && settingsRow) {
      settingsRow.style.display = customToggle.checked ? 'block' : 'none';

      customToggle?.addEventListener('change', () => {
        Preferences.savePreferences();
        const row = document.getElementById('palette-settings-row');
        if (row) row.style.display = customToggle.checked ? 'block' : 'none';

        this.render();
        if (typeof ChartManager !== 'undefined') ChartManager.render();

        UI.renderSignalList();
      });
    }
  },

  refresh() {
    const customToggle = document.getElementById('pref-custom-palette');
    const settingsRow = document.getElementById('palette-settings-row');
    if (customToggle && settingsRow) {
      settingsRow.style.display = customToggle.checked ? 'block' : 'none';
      const row = document.getElementById('palette-settings-row');
      if (row) row.style.display = customToggle.checked ? 'block' : 'none';
      this.render();
    }
  },

  getSignalKey(fileName, signalName) {
    return `${fileName}_${signalName}`;
  },

  getColorForSignal(fileIdx, sigIdx) {
    const fIdx = parseInt(fileIdx) || 0;
    const sIdx = parseInt(sigIdx) || 0;

    const file = AppState.files[fIdx];
    if (!file) return '#888888';

    const signalName = file.availableSignals[sIdx];
    const key = this.getSignalKey(file.name, signalName);

    const prefs = Preferences.prefs;
    const customMap = Preferences.customPalette;
    if (prefs.useCustomPalette && customMap[key]) {
      return customMap[key];
    }

    const themePalette = this.getDefaultChartColors();
    return themePalette[(fIdx * 10 + sIdx) % themePalette.length];
  },

  getDefaultChartColors() {
    const isDarkMode = document.body.classList.contains('pref-theme-dark');
    return isDarkMode ? this.CHART_COLORS : this.CHART_COLORS_LIGHT;
  },

  render() {
    const container = document.getElementById('palette-container');
    if (!container) return;
    container.innerHTML = '';

    if (!AppState.files || AppState.files.length === 0) {
      container.innerHTML =
        '<p style="padding:10px; font-size:0.8em; opacity:0.6;">No data loaded</p>';
      return;
    }

    AppState.files.forEach((file, fileIdx) => {
      const group = document.createElement('div');
      group.className = 'palette-group';
      group.innerHTML = `<div style="font-weight:bold; font-size:0.8em; margin:10px 0 5px 0; border-bottom:1px solid var(--border-color);">${file.name}</div>`;

      file.availableSignals.forEach((signal, sigIdx) => {
        const color = this.getColorForSignal(fileIdx, sigIdx);
        const key = this.getSignalKey(file.name, signal);

        const item = document.createElement('div');
        item.style.cssText =
          'display:flex; align-items:center; gap:8px; margin-bottom:4px;';

        const picker = document.createElement('input');
        picker.type = 'color';
        picker.value = color;
        picker.className = 'palette-picker';

        picker.onchange = (e) => {
          const currentMap = Preferences.customPalette;
          currentMap[key] = e.target.value;
          Preferences.customPalette = currentMap;

          if (typeof ChartManager !== 'undefined') ChartManager.render();
          import('./ui.js').then((m) => m.UI.renderSignalList());
        };

        const label = document.createElement('span');
        label.innerText = signal;
        label.style.fontSize = '0.75em';

        item.appendChild(picker);
        item.appendChild(label);
        group.appendChild(item);
      });
      container.appendChild(group);
    });

    const btnWrapper = document.createElement('div');
    btnWrapper.style.marginTop = '15px';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn btn-sm';
    resetBtn.innerHTML = '<i class="fas fa-undo"></i> Reset All Colors';
    resetBtn.onclick = () => {
      Preferences.customPalette = null;
      this.render();
      if (typeof ChartManager !== 'undefined') ChartManager.render();
      import('./ui.js').then((m) => m.UI.renderSignalList());
    };
    btnWrapper.appendChild(resetBtn);
    container.appendChild(btnWrapper);
  },
};
