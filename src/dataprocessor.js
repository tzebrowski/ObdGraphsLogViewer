import templates from './templates.json';
import { Config, AppState, DOM } from './config.js';
import { Alert } from './alert.js';
import { messenger } from './bus.js';
import { projectManager } from './projectmanager.js';

/**
 * DataProcessor Module
 * Handles telemetry data parsing, chronological sorting, and state synchronization.
 */
class DataProcessor {
  SCHEMA_REGISTRY = {
    JSON: { signal: 's', timestamp: 't', value: 'v' },
    CSV: {
      signal: 'SensorName',
      timestamp: 'Time_ms',
      value: 'Reading',
    },
  };

  SCHEMA = {
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
    if (files.length === 0) {
      return;
    }

    messenger.emit('ui:set-loading', {
      message: `Parsing ${files.length} Files...`,
    });

    let loadedCount = 0;

    files.forEach((file) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          let rawData;
          if (file.name.endsWith('.csv')) {
            const parsedCSV = this.#parseCSV(e.target.result);
            // Normalize "Wide" CSVs (exported from app) to "Long" format
            rawData = this.#normalizeWideCSV(parsedCSV);
          } else {
            rawData = JSON.parse(e.target.result);
          }
          this.#process(rawData, file.name);
        } catch (err) {
          const msg = `Error parsing ${file.name}: ${err.message}`;
          console.error(msg);
          Alert.showAlert(msg);
        } finally {
          loadedCount++;
          if (loadedCount === files.length) this.#finalizeBatchLoad();
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
    const result = this.#process(data, fileName);
    this.#finalizeBatchLoad();
    return result;
  }

  /**
   * Processes raw telemetry array into a structured log entry.
   * @private
   */
  #process(data, fileName) {
    try {
      if (!Array.isArray(data)) throw new Error('Input data must be an array');

      let telemetryPoints = data;
      let fileMetadata = {};

      // OPTIONAL: Check if the first element is a metadata block
      // Example format: [{ "metadata": { ... } }, { "t": 1, "s": "sig", "v": 10 }, ...]
      if (data.length > 0 && data[0].metadata) {
        fileMetadata = data[0].metadata;
        // The rest of the array is the actual telemetry data
        telemetryPoints = data.slice(1);
      }

      // If there are no data points after removing metadata, handle gracefully
      if (telemetryPoints.length === 0) {
        console.warn(
          'Preprocessing: File contains metadata but no telemetry points.'
        );
        // Create an empty result structure or handle as needed
      }

      // Detect schema based on the first actual data point
      const schema = this.#detectSchema(telemetryPoints[0]);

      const processedPoints = telemetryPoints
        .map((item) => this.#applyMappingAndCleaning(item, schema))
        .filter((point) => point !== null);

      const result = this.#transformRawData(processedPoints, fileName);

      // Attach the extracted metadata to the result object
      result.metadata = fileMetadata;
      result.size = telemetryPoints.length; // Update size to reflect actual data count

      AppState.files.push(result);

      projectManager.registerFile({
        name: fileName,
        size: result.size,
        metadata: result.metadata, // Register metadata with project manager if supported
      });

      return result;
    } catch (error) {
      console.error('Error occured during file processing', error);
      messenger.emit('ui:updateDataLoadedState', { status: false });
    }
  }

  /**
   * Determines which schema to use based on the keys present in the first data point.
   * @private
   */
  #detectSchema(samplePoint) {
    if (!samplePoint) return this.SCHEMA_REGISTRY.JSON;

    if ('SensorName' in samplePoint) return this.SCHEMA_REGISTRY.CSV;

    return this.SCHEMA_REGISTRY.JSON;
  }

  /**
   * Combines key mapping and data sanitization in one pass.
   * @private
   */
  #applyMappingAndCleaning(rawPoint, schema) {
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
  #parseCSV(csvText) {
    const lines = csvText.split('\n').filter((line) => line.trim());
    if (lines.length === 0) return [];

    const headers = lines[0].split(',').map((h) => h.trim());

    return lines.slice(1).map((line) => {
      // Handle simplistic CSV splitting (warning: doesn't handle commas in quotes)
      const values = line.split(',');
      return headers.reduce((obj, header, i) => {
        // Guard against row length mismatch
        obj[header] = values[i] !== undefined ? values[i].trim() : '';
        return obj;
      }, {});
    });
  }

  /**
   * Converts Wide Format (Time, Sig1, Sig2...) to Long Format (SensorName, Time_ms, Reading)
   * This enables importing files generated by the "Export" feature.
   * @private
   */
  #normalizeWideCSV(rows) {
    if (!rows || rows.length === 0) return rows;

    const keys = Object.keys(rows[0]);

    // 1. If it already has the standard columns, return as is.
    if (
      keys.includes('SensorName') &&
      (keys.includes('Time_ms') || keys.includes('time'))
    ) {
      return rows;
    }

    // 2. Detect Time Column (common variations: "Time", "Time (s)", "time")
    const timeKey = keys.find((k) => k.toLowerCase().includes('time'));

    // If no time column found, we can't pivot. Return original and let schema detection fail naturally.
    if (!timeKey) return rows;

    const normalized = [];
    // All other keys are treated as Signals
    const signalKeys = keys.filter((k) => k !== timeKey);

    rows.forEach((row) => {
      const timeVal = parseFloat(row[timeKey]);
      if (isNaN(timeVal)) return;

      // Exports are usually in Seconds (e.g. 0.1), internals need Milliseconds (e.g. 100)
      const timestampMs = timeKey.includes('(s)') ? timeVal * 1000 : timeVal;

      signalKeys.forEach((sigKey) => {
        const val = row[sigKey];
        // Only add if value exists and is not empty string
        if (val !== '' && val !== null && val !== undefined) {
          normalized.push({
            SensorName: sigKey,
            Time_ms: timestampMs,
            Reading: val,
          });
        }
      });
    });

    return normalized;
  }

  /**
   * Transforms raw telemetry points into a structured file entry.
   * @private
   */
  #transformRawData(data, fileName) {
    const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);
    const signals = {};
    let minT = Infinity,
      maxT = -Infinity;

    const { timeKey, valueKey } = this.SCHEMA;

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
   * Handles cleanup tasks after a batch of files has been parsed.
   * @private
   */
  #finalizeBatchLoad() {
    messenger.emit('dataprocessor:batch-load-completed', {});
    const input = DOM.get('fileInput');
    if (input) input.value = '';
  }
}

export const dataProcessor = new DataProcessor();
