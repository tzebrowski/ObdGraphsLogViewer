import { ChartManager } from './chartmanager.js';
import { Preferences } from './preferences.js';

export const PaletteManager = {
  CHART_COLORS: [
    '#e31837', // Alfa Red
    '#0051ba', // Performance Blue
    '#2dcc70', // Cloverleaf Green
    '#f1c40f', // Giallo Yellow
    '#8e44ad', // Plum
    '#e67e22', // Orange
    '#00F2FF', // Electric Cyan (Boost/Turbo)
    '#39FF14', // Neon Green (RPM)
    '#FF007F', // Hot Pink (AFR/Lambda)
    '#FFFF00', // Bright Yellow (Throttle)
    '#BC13FE', // Neon Purple (Timing)
    '#FF4D00', // Safety Orange (Temperatures)
    '#00FF9F', // Spring Green
    '#FFD700', // Gold
    '#FF0000', // Pure Red (Critical Errors)
  ],

  CHART_COLORS_LIGHT: [
    '#1A73E8', // Cobalt Blue (Boost/Turbo/Intake)
    '#2E7D32', // Hunter Green (Engine RPM)
    '#C2185B', // Raspberry (AFR / Lambda)
    '#F57C00', // Deep Orange (Throttle / Load)
    '#7B1FA2', // Deep Purple (Ignition Timing)
    '#D32F2F', // Signal Red (Coolant / Oil Temp)
    '#0097A7', // Teal (Airflow / MAF)
    '#607D8B', // Blue Grey (Battery / Voltage)
    '#AFB42B', // Avocado (Fuel Trims / Efficiency)
  ],

  getChartColors() {
    const prefs = Preferences.prefs || {};

    if (prefs.useCustomPalette) {
      const savedPalette = localStorage.getItem('giulia_chart_palette');
      if (savedPalette) return JSON.parse(savedPalette);
    }

    const isDarkMode = document.body.classList.contains('pref-theme-dark');
    return isDarkMode ? this.CHART_COLORS : this.CHART_COLORS_LIGHT;
  },

  init() {
    this.render();

    const customToggle = document.getElementById('pref-custom-palette');
    customToggle?.addEventListener('change', () => {
      Preferences.savePreferences();
      document.getElementById('palette-settings-row').style.display =
        customToggle.checked ? 'block' : 'none';

      if (typeof PaletteManager !== 'undefined') PaletteManager.render();
      if (typeof ChartManager !== 'undefined') ChartManager.render();
    });
  },

  render() {
    const container = document.getElementById('palette-container');
    if (!container) return;

    const currentColors = this.getChartColors();
    container.innerHTML = '';

    currentColors.forEach((color, idx) => {
      const picker = document.createElement('input');
      picker.type = 'color';
      picker.value = color;
      picker.className = 'palette-picker';

      picker.onchange = (e) => {
        const newPalette = [...currentColors];
        newPalette[idx] = e.target.value;
        localStorage.setItem(
          'giulia_chart_palette',
          JSON.stringify(newPalette)
        );

        ChartManager.render();
      };

      container.appendChild(picker);
    });

    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn-icon';
    resetBtn.innerHTML = '<i class="fas fa-undo"></i>';
    resetBtn.title = 'Reset to Theme Defaults';
    resetBtn.onclick = () => {
      localStorage.removeItem('giulia_chart_palette');
      this.render();
      ChartManager.render();
    };
    container.appendChild(resetBtn);
  },
};
