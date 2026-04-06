import templates from './templates.json';
import { Config, AppState, DOM } from './config.js';
import { Alert } from './alert.js';
import { messenger } from './bus.js';
import { projectManager } from './projectmanager.js';
import { dbManager } from './dbmanager.js';
import { signalRegistry } from './signalregistry.js';

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
      try {
        Config.ANOMALY_TEMPLATES = {};
      } catch (e) {
        /* ignore */
      }
    }
  }


  handleLocalFile(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    messenger.emit('ui:set-loading', {
      message: `Parsing ${files.length} Files...`,
    });

    let loadedCount = 0;

    files.forEach(async (file) => {
      try {
        const fileText = await this.#readFileContent(file);

        let rawData;
        if (file.name.includes('.csv')) {
          const parsedCSV = this.#parseCSV(fileText);
          if (this.#isAlfaOBD(parsedCSV)) {
            rawData = this.#normalizeAlfaOBD(parsedCSV);
          } else {
            rawData = this.#normalizeWideCSV(parsedCSV);
          }
        } else {
          // Pass the raw JSON straight to process; it will detect columnar internally
          rawData = JSON.parse(fileText);
        }

        await this.#process(rawData, file.name);
      } catch (err) {
        const msg = `Error parsing ${file.name}: ${err.message}`;
        console.error(msg);
        Alert.showAlert(msg);
      } finally {
        loadedCount++;
        if (loadedCount === files.length) this.#finalizeBatchLoad();
      }
    });
  }

  async #readFileContent(file) {
    if (file.name.endsWith('.gz')) {
      const ds = new DecompressionStream('gzip');
      const decompressedStream = file.stream().pipeThrough(ds);
      return await new Response(decompressedStream).text();
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  // --- Data Transformation & State Sync ---

  async process(data, fileName) {
    const result = await this.#process(data, fileName);
    this.#finalizeBatchLoad();
    return result;
  }

  async #process(data, fileName) {
    try {
      let telemetryData = data;

      // Auto-detect and unpack the highly compressed columnar format
      if (this.#isColumnarJSON(telemetryData)) {
        telemetryData = this.#normalizeColumnarJSON(telemetryData);
      }

      if (!Array.isArray(telemetryData))
        throw new Error('Input data must be an array');

      let telemetryPoints = telemetryData;
      let fileMetadata = {};

      if (telemetryData.length > 0 && telemetryData[0].metadata) {
        fileMetadata = telemetryData[0].metadata;
        telemetryPoints = telemetryData.slice(1);
      }

      if (telemetryPoints.length === 0) {
        console.warn(
          'Preprocessing: File contains metadata but no telemetry points.'
        );
      }

      const schema = this.#detectSchema(telemetryPoints[0]);

      const processedPoints = telemetryPoints.flatMap((item) =>
        this.#applyMappingAndCleaning(item, schema)
      );

      const result = this.#transformRawData(processedPoints, fileName);

      result.metadata = fileMetadata;
      result.size = telemetryPoints.length;

      const allLibraryFiles = await dbManager.getAllFiles();
      const existingFile = allLibraryFiles.find(
        (f) => f.name === fileName && f.size === result.size
      );

      if (existingFile) {
        console.log(
          `File '${fileName}' already exists in library. Skipping DB save.`
        );
        result.dbId = existingFile.id;
      } else {
        const dbId = await dbManager.saveTelemetry(result);
        result.dbId = dbId;
      }

      const isAlreadyInSession = AppState.files.some(
        (f) => f.dbId === result.dbId
      );
      if (!isAlreadyInSession) {
        AppState.files.push(result);
      }

      projectManager.registerFile({
        name: fileName,
        dbId: result.dbId,
        size: result.size,
        metadata: result.metadata,
      });

      return result;
    } catch (error) {
      console.error('Error occured during file processing', error);
      messenger.emit('ui:updateDataLoadedState', { status: false });
    }
  }

  #isColumnarJSON(data) {
    return (
      data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      'series' in data
    );
  }

  #normalizeColumnarJSON(data) {
    const normalized = [];

    if (data.metadata) {
      normalized.push({ metadata: data.metadata });
    }

    const dictionary = data.signal_dictionary || {};
    const series = data.series || {};

    // Pre-compute canonical names from the dictionary to avoid lookups in the loop
    const mappedDictionary = {};
    for (const [id, rawLocalizedName] of Object.entries(dictionary)) {
      const nameFromId = signalRegistry.getCanonicalByPid(id);

      mappedDictionary[id] =
        nameFromId ||
        signalRegistry.getCanonicalKey(rawLocalizedName) ||
        rawLocalizedName;
    }

    // Iterate through the series
    for (const [signalId, vectors] of Object.entries(series)) {
      const signalName = mappedDictionary[signalId] || signalId;

      const times = vectors.t || [];
      const values = vectors.v || [];

      const length = Math.min(times.length, values.length);

      for (let i = 0; i < length; i++) {
        normalized.push({
          s: signalName,
          t: times[i],
          v: values[i],
        });
      }
    }

    return normalized;
  }

  #isAlfaOBD(rows) {
    if (!rows || rows.length === 0) return false;
    const keys = Object.keys(rows[0]);
    const hasTimeColumn = keys.includes('Time');
    const firstTimeValue = rows[0]['Time'];

    return (
      hasTimeColumn &&
      typeof firstTimeValue === 'string' &&
      firstTimeValue.includes(':')
    );
  }

  #normalizeAlfaOBD(rows) {
    const normalized = [];
    if (!rows || rows.length === 0) return normalized;

    const keys = Object.keys(rows[0]);
    const timeKey = 'Time';
    const signalKeys = keys.filter((k) => k !== timeKey);

    rows.forEach((row) => {
      const rawTime = row[timeKey];
      if (!rawTime) return;

      const parts = rawTime.split(':');
      if (parts.length !== 3) return;

      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      const seconds = parseFloat(parts[2]);

      if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) return;

      const timestampMs = (hours * 3600 + minutes * 60 + seconds) * 1000;

      signalKeys.forEach((sigKey) => {
        const val = row[sigKey];
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

  #detectSchema(samplePoint) {
    if (!samplePoint) return this.SCHEMA_REGISTRY.JSON;
    if ('SensorName' in samplePoint) return this.SCHEMA_REGISTRY.CSV;
    return this.SCHEMA_REGISTRY.JSON;
  }

  #applyMappingAndCleaning(rawPoint, schema) {
    try {
      const baseSignal = rawPoint[schema.signal];
      const timestamp = Number(rawPoint[schema.timestamp]);
      const rawValue = rawPoint[schema.value];

      if (isNaN(timestamp)) return [];

      let prefix = '';
      if (typeof baseSignal === 'string') {
        prefix = baseSignal.replace(/\n/g, ' ').trim();
      }

      if (typeof rawValue === 'object' && rawValue !== null) {
        const derivedPoints = [];

        for (const [key, val] of Object.entries(rawValue)) {
          const numVal = Number(val);
          if (isNaN(numVal)) continue;

          const formattedKey = key.charAt(0).toUpperCase() + key.slice(1);
          const finalSignal = prefix
            ? `${prefix}-${formattedKey}`
            : formattedKey;

          derivedPoints.push({
            signal: finalSignal,
            timestamp: timestamp,
            value: numVal,
          });
        }
        return derivedPoints;
      }

      const numValue = Number(rawValue);
      if (isNaN(numValue)) return [];

      return [
        {
          signal: prefix || String(baseSignal),
          timestamp: timestamp,
          value: numValue,
        },
      ];
    } catch (e) {
      console.error('Data cleaning error:', e);
      return [];
    }
  }

  #parseCSV(csvText) {
    const lines = csvText.split('\n').filter((line) => line.trim());
    if (lines.length === 0) return [];

    const headers = lines[0].split(',').map((h) => h.trim());

    return lines.slice(1).map((line) => {
      const values = line.split(',');
      return headers.reduce((obj, header, i) => {
        obj[header] = values[i] !== undefined ? values[i].trim() : '';
        return obj;
      }, {});
    });
  }

  #normalizeWideCSV(rows) {
    if (!rows || rows.length === 0) return rows;

    const keys = Object.keys(rows[0]);

    if (
      keys.includes('SensorName') &&
      (keys.includes('Time_ms') || keys.includes('time'))
    ) {
      return rows;
    }

    const timeKey = keys.find((k) => k.toLowerCase().includes('time'));
    if (!timeKey) return rows;

    const normalized = [];
    const signalKeys = keys.filter((k) => k !== timeKey);

    rows.forEach((row) => {
      const timeVal = parseFloat(row[timeKey]);
      if (isNaN(timeVal)) return;

      const timestampMs = timeKey.includes('(s)') ? timeVal * 1000 : timeVal;

      signalKeys.forEach((sigKey) => {
        const val = row[sigKey];
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

  #finalizeBatchLoad() {
    messenger.emit('dataprocessor:batch-load-completed', {});
    const input = DOM.get('fileInput');
    if (input) input.value = '';
  }
}

export const dataProcessor = new DataProcessor();
