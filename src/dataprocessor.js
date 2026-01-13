import templates from './templates.json';
import { Config, AppState, DOM } from './config.js';
import { UI } from './ui.js';
import { Alert } from './alert.js';
import { messenger } from './bus.js';

/**
 * DataProcessor Module
 * Handles telemetry data parsing, chronological sorting, and state synchronization.
 */
class DataProcessor {
  SCHEMA_REGISTRY = {
    DEFAULT_JSON: { signal: 's', timestamp: 't', value: 'v' },
    LEGACY_CSV: {
      signal: 'SensorName',
      timestamp: 'Time_ms',
      value: 'Reading',
    },
  };

  INTERNAL_SCHEMA = {
    timeKey: 'x',
    valueKey: 'y',
  };

  constructor() {
    this.handleLocalFile = this.handleLocalFile.bind(this);
  }

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
  }

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
      const isCsv = file.name.endsWith('.csv');

      reader.onload = (e) => {
        try {
          let rawData;
          if (isCsv) {
            rawData = this._parseCSV(e.target.result);
          } else {
            rawData = JSON.parse(e.target.result);
          }

          this.process(rawData, file.name);
        } catch (err) {
          const msg = `Error parsing ${file.name}: ${err.message}`;
          console.error(msg);
          Alert.showAlert(msg);
        } finally {
          loadedCount++;
          if (loadedCount === files.length) this._finalizeBatchLoad();
        }
      };
      reader.readAsText(file);
    });
  }

  // --- Data Transformation & State Sync ---

  /**
   * Processes raw telemetry array into a structured log entry.
   * @param {Array} data - Array of {s, t, v} points
   * @param {string} fileName - Source file identifier
   */
  process(data, fileName) {
    try {
      if (!Array.isArray(data)) throw new Error('Input data must be an array');

      const result = this._process(data, fileName);

      AppState.files.push(result);

      this._syncGlobalState(result);
      this._updateUIPipeline();
    } catch (error) {
      console.error('Error occured during file processing', error);
      UI.updateDataLoadedState(false);
    }
  }

  // --- Internal Helper Methods (_) ---

  /**
   * @param {Array} data - The raw input array from the file.
   * @returns {Array} - The standardized and sanitized array.
   * @private
   */
  _process(data, fileName) {
    const schema = this._detectSchema(data[0]);
    const processedPoints = data
      .map((item) => this._applyMappingAndCleaning(item, schema))
      .filter((point) => point !== null);

    return this._transformRawData(processedPoints, fileName);
  }

  /**
   * Determines which schema to use based on the keys present in the first data point.
   * @private
   */
  _detectSchema(samplePoint) {
    if (!samplePoint) return this.SCHEMA_REGISTRY.DEFAULT_JSON;

    if ('SensorName' in samplePoint) return this.SCHEMA_REGISTRY.LEGACY_CSV;
    if ('ts' in samplePoint) return this.SCHEMA_REGISTRY.STRICT_API;

    return this.SCHEMA_REGISTRY.DEFAULT_JSON;
  }

  /**
   * Combines key mapping and data sanitization in one pass.
   * @private
   */
  _applyMappingAndCleaning(rawPoint, schema) {
    try {
      const mapped = {
        signal: rawPoint[schema.signal],
        timestamp: Number(rawPoint[schema.timestamp]),
        value: Number(rawPoint[schema.value]),
      };

      if (typeof mapped.signal === 'string') {
        mapped.signal = mapped.signal.replace(/\n/g, ' ').trim();
      }

      if (isNaN(mapped.timestamp) || isNaN(mapped.value)) {
        console.warn('Preprocessing: Dropping malformed point', rawPoint);
        return null;
      }

      return mapped;
    } catch {
      return null;
    }
  }

  /**
   * Simple CSV to Object parser (Helper)
   * @private
   */
  _parseCSV(csvText) {
    const lines = csvText.split('\n').filter((line) => line.trim());
    const headers = lines[0].split(',').map((h) => h.trim());

    return lines.slice(1).map((line) => {
      const values = line.split(',');
      return headers.reduce((obj, header, i) => {
        obj[header] = values[i];
        return obj;
      }, {});
    });
  }

  /**
   * Transforms raw telemetry points into a structured file entry.
   * @private
   */
  _transformRawData(data, fileName) {
    const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);
    const signals = {};
    let minT = Infinity,
      maxT = -Infinity;

    const { timeKey, valueKey } = this.INTERNAL_SCHEMA;

    sorted.forEach((p) => {
      if (!signals[p.signal]) signals[p.signal] = [];

      signals[p.signal].push({
        [timeKey]: p.timestamp,
        [valueKey]: p.value,
      });

      if (p.timestamp < minT) minT = p.timestamp;
      if (p.timestamp > maxT) maxT = p.timestamp;
    });

    return {
      name: fileName,
      rawData: sorted,
      signals: signals,
      startTime: minT,
      duration: data.length > 0 ? (maxT - minT) / 1000 : 0,
      availableSignals: Object.keys(signals).sort(),
    };
  }

  /**
   * Synchronizes global application state upon the first file load.
   * @private
   */
  _syncGlobalState(fileEntry) {
    if (AppState.files.length === 1) {
      AppState.globalStartTime = fileEntry.startTime;
      AppState.logDuration = fileEntry.duration;
    }
  }

  /**
   * Triggers the UI update pipeline for charts, lists, and status indicators.
   * @private
   */
  _updateUIPipeline() {
    const fileInfo = DOM.get('fileInfo');
    if (fileInfo) {
      fileInfo.innerText = `${AppState.files.length} logs loaded`;
    }
  }

  /**
   * Handles cleanup tasks after a batch of files has been parsed.
   * @private
   */
  _finalizeBatchLoad() {
    messenger.emit('dataprocessor:batch-load-completed', {});
    const input = DOM.get('fileInput');
    if (input) input.value = '';
  }
}

export const dataProcessor = new DataProcessor();
