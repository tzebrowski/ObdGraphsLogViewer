import templates from './templates.json';
import { Config, AppState, DOM } from './config.js';
import { Analysis } from './analysis.js';
import { ChartManager } from './chartmanager.js';
import { UI } from './ui.js';
import { Alert } from './alert.js';

/**
 * DataProcessor Module
 * Handles telemetry data parsing, chronological sorting, and state synchronization.
 */
export const DataProcessor = {
  // --- Configuration Management ---

  /**
   * Initializes anomaly detection templates.
   * @param {Object} providedTemplates - Template definitions (defaults to templates.json)
   */
  async loadConfiguration(providedTemplates = templates) {
    try {
      if (!providedTemplates) {
        console.error('Config Loader: Error: Missing templates');
        return;
      }
      Config.ANOMALY_TEMPLATES = providedTemplates;
    } catch (error) {
      console.error('Config Loader:', error);
      // Fallback to safe state
      try {
        Config.ANOMALY_TEMPLATES = {};
      } catch (e) {
        /* ignore */
      }
    }
  },

  // --- Local File Handling ---

  /**
   * Orchestrates the reading of multiple local files from a file input event.
   */
  handleLocalFile(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    UI.setLoading(true, `Parsing ${files.length} Files...`);
    let loadedCount = 0;

    files.forEach((file) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const rawContent = JSON.parse(e.target.result);
          DataProcessor.process(rawContent, file.name);
        } catch (err) {
          const msg = `Invalid JSON: ${file.name} Error: ${err.message}`;
          console.error(msg);
          Alert.showAlert(msg);
        } finally {
          loadedCount++;
          if (loadedCount === files.length) {
            DataProcessor._finalizeBatchLoad();
          }
        }
      };

      reader.readAsText(file);
    });
  },

  // --- Data Transformation & State Sync ---

  /**
   * Processes raw telemetry array into a structured log entry.
   * @param {Array} data - Array of {s, t, v} points
   * @param {string} fileName - Source file identifier
   */
  process(data, fileName) {
    try {
      if (!Array.isArray(data)) throw new Error('Input data must be an array');

      const cleanData = this._preprocess(data);
      const fileEntry = this._transformRawData(cleanData, fileName);

      AppState.files.push(fileEntry);

      this._syncGlobalState(fileEntry);
      this._updateUIPipeline();
    } catch (error) {
      console.error('Error occured during file processing', error);
      UI.updateDataLoadedState(false);
    }
  },

  // --- Internal Helper Methods (_) ---

  /**
   * Sanitizes and normalizes raw data before transformation.
   * @param {Array} data - The raw input array
   * @returns {Array} - The sanitized array
   * @private
   */
  _preprocess(data) {
    return data.map((point) => {
      // Create a shallow copy to maintain immutability
      const p = { ...point };

      if (p.s && typeof p.s === 'string') {
        p.s = p.s.replace(/\n/g, ' ').trim();
      }

      p.t = Number(p.t);
      p.v = Number(p.v);

      // Future: Add unit conversions or scale factors here

      return p;
    });
  },

  /**
   * Transforms raw telemetry points into a structured file entry.
   * @private
   */
  _transformRawData(data, fileName) {
    const sorted = [...data].sort((a, b) => a.t - b.t);

    const signals = {};
    let minT = Infinity,
      maxT = -Infinity;

    sorted.forEach((p) => {
      if (!signals[p.s]) signals[p.s] = [];
      signals[p.s].push({ x: p.t, y: p.v });

      if (p.t < minT) minT = p.t;
      if (p.t > maxT) maxT = p.t;
    });

    return {
      name: fileName,
      rawData: sorted,
      signals: signals,
      startTime: minT,
      duration: data.length > 0 ? (maxT - minT) / 1000 : 0,
      availableSignals: Object.keys(signals).sort(),
    };
  },

  /**
   * Synchronizes global application state upon the first file load.
   * @private
   */
  _syncGlobalState(fileEntry) {
    if (AppState.files.length === 1) {
      AppState.globalStartTime = fileEntry.startTime;
      AppState.logDuration = fileEntry.duration;
      Analysis.init();
    }
  },

  /**
   * Triggers the UI update pipeline for charts, lists, and status indicators.
   * @private
   */
  _updateUIPipeline() {
    const fileInfo = DOM.get('fileInfo');
    if (fileInfo) {
      fileInfo.innerText = `${AppState.files.length} logs loaded`;
    }

    UI.renderSignalList();
    ChartManager.render();
    UI.updateDataLoadedState(true);
    Analysis.refreshFilterOptions();
  },

  /**
   * Handles cleanup tasks after a batch of files has been parsed.
   * @private
   */
  _finalizeBatchLoad() {
    UI.setLoading(false);
    const input = DOM.get('fileInput');
    if (input) input.value = '';
  },
};
