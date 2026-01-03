import templates from './templates.json';
import { Config, AppState, DOM } from './config.js';
import { Analysis } from './analysis.js';
import { ChartManager, Sliders } from './chartmanager.js';
import { UI } from './ui.js';

export const DataProcessor = {
  loadConfiguration: async () => {
    try {
      if (!templates) {
        console.error('Config Loader: Error: Missing templates');
        return;
      }
      Config.ANOMALY_TEMPLATES = templates;
    } catch (error) {
      console.error('Config Loader:', error);
      Config.ANOMALY_TEMPLATES = {};
    }
  },

  handleLocalFile: (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    UI.setLoading(true, `Parsing ${files.length} Files...`);
    let loaded = 0;
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          DataProcessor.process(JSON.parse(e.target.result), file.name);
        } catch (err) {
          console.error(`Invalid JSON: ${file.name} Error: ${err.message}`);
        }
        loaded++;
        if (loaded === files.length) {
          UI.setLoading(false);
          DOM.get('fileInput').value = '';
        }
      };
      reader.readAsText(file);
    });
  },

  process: (data, fileName) => {
    try {
      const sorted = data.sort((a, b) => a.t - b.t);
      const signals = {};
      let minT = Infinity,
        maxT = -Infinity;

      sorted.forEach((p) => {
        if (!signals[p.s]) signals[p.s] = [];
        signals[p.s].push({ x: p.t, y: p.v });
        if (p.t < minT) minT = p.t;
        if (p.t > maxT) maxT = p.t;
      });

      const fileEntry = {
        name: fileName,
        rawData: sorted,
        signals: signals,
        startTime: minT,
        duration: (maxT - minT) / 1000,
        availableSignals: Object.keys(signals).sort(),
      };

      AppState.files.push(fileEntry);

      if (AppState.files.length === 1) {
        AppState.globalStartTime = minT;
        AppState.logDuration = fileEntry.duration;
        Analysis.init();
        if (typeof Sliders !== 'undefined') Sliders.init(AppState.logDuration);
      }

      AppState.availableSignals.push(...fileEntry.availableSignals);

      DOM.get('fileInfo').innerText = `${AppState.files.length} logs loaded`;
      UI.renderSignalList();
      ChartManager.render();
      UI.updateDataLoadedState(true);
    } catch (error) {
      console.error('Error occured during file processing', error);
      UI.updateDataLoadedState(false);
    }
  },
};
