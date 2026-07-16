import { Injectable } from '@angular/core';
import { AppStateService } from './app-state.service';
import { DbManagerService } from './db-manager.service';
import { EventBusService } from './event-bus.service';
import { EVENTS, LoadedFile, RawDataPoint } from './models';
import { ProjectManagerService } from './project-manager.service';
import { SignalRegistryService } from './signal-registry.service';

const SCHEMA_REGISTRY = {
  JSON: { signal: 's', timestamp: 't', value: 'v' },
  CSV: { signal: 'SensorName', timestamp: 'Time_ms', value: 'Reading' },
};
const SCHEMA = { timeKey: 'x', valueKey: 'y' } as const;

/**
 * Port of legacy/src/dataprocessor.js. `handleFiles` is the local-file
 * ingestion path (drag-drop / file picker); `processExternal` is the same
 * normalize+persist+register pipeline for data fetched from elsewhere (e.g.
 * DriveService), matching legacy's direct `dataProcessor.process()` call
 * from `Drive.loadFile`. Session restore-on-reload ("remember active files")
 * moved to ProjectManagerService as of Milestone 3a — it now respects which
 * files were actually active (and the rememberFiles preference) rather than
 * unconditionally restoring everything in IndexedDB.
 */
@Injectable({ providedIn: 'root' })
export class DataProcessorService {
  constructor(
    private readonly appState: AppStateService,
    private readonly db: DbManagerService,
    private readonly bus: EventBusService,
    private readonly projectManager: ProjectManagerService,
    private readonly signalRegistry: SignalRegistryService
  ) {}

  async handleFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;

    this.appState.loading.set(true);
    this.appState.loadingMessage.set(`Parsing ${files.length} Files...`);

    let loadedCount = 0;

    await Promise.all(
      files.map(async (file) => {
        try {
          const fileText = await this.readFileContent(file);
          let rawData: unknown;
          if (file.name.includes('.csv')) {
            if (this.isMultiecuscan(fileText)) {
              rawData = this.normalizeMultiecuscan(fileText);
            } else {
              const parsedCSV = this.parseCSV(fileText);
              rawData = this.isAlfaOBD(parsedCSV)
                ? this.normalizeAlfaOBD(parsedCSV)
                : this.normalizeWideCSV(parsedCSV);
            }
          } else {
            rawData = JSON.parse(fileText);
          }
          await this.process(rawData, file.name);
        } catch (err) {
          const msg = `Error parsing ${file.name}: ${(err as Error).message}`;
          console.error(msg);
          this.appState.showAlert(msg);
        } finally {
          loadedCount++;
          if (loadedCount === files.length) this.finalizeBatchLoad();
        }
      })
    );
  }

  private async readFileContent(file: File): Promise<string> {
    if (file.name.endsWith('.gz')) {
      const ds = new DecompressionStream('gzip');
      const decompressedStream = file.stream().pipeThrough(ds);
      return await new Response(decompressedStream).text();
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  /** Normalizes, persists, and registers already-parsed data (e.g. from Google Drive). */
  async processExternal(
    data: unknown,
    fileName: string
  ): Promise<LoadedFile | undefined> {
    return this.process(data, fileName);
  }

  private async process(
    data: unknown,
    fileName: string
  ): Promise<LoadedFile | undefined> {
    try {
      let telemetryData: unknown = data;

      if (this.isColumnarJSON(telemetryData)) {
        telemetryData = this.normalizeColumnarJSON(
          telemetryData as Record<string, unknown>
        );
      }

      if (!Array.isArray(telemetryData))
        throw new Error('Input data must be an array');

      let telemetryPoints: Array<Record<string, unknown>> = telemetryData;
      let fileMetadata: Record<string, unknown> = {};

      if (telemetryData.length > 0 && telemetryData[0]?.['metadata']) {
        fileMetadata = telemetryData[0]['metadata'] as Record<string, unknown>;
        telemetryPoints = telemetryData.slice(1);
      }

      const schema = this.detectSchema(telemetryPoints[0]);
      const processedPoints = telemetryPoints.flatMap((item) =>
        this.applyMappingAndCleaning(item, schema)
      );
      const result = this.transformRawData(processedPoints, fileName);
      result.metadata = fileMetadata;
      result.size = telemetryPoints.length;

      const allLibraryFiles = await this.db.getAllFiles();
      const existingFile = allLibraryFiles.find(
        (f) => f.name === fileName && f.size === result.size
      );

      if (existingFile) {
        console.log(
          `File '${fileName}' already exists in library. Skipping DB save.`
        );
        result.dbId = existingFile.id;
      } else {
        result.dbId = await this.db.saveTelemetry(result);
      }

      this.appState.addFile(result);

      this.projectManager.registerFile({
        name: fileName,
        dbId: result.dbId,
        size: result.size,
        metadata: result.metadata,
      });

      return result;
    } catch (error) {
      console.error('Error occurred during file processing', error);
      return undefined;
    }
  }

  private isColumnarJSON(data: unknown): boolean {
    return (
      !!data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      'series' in data
    );
  }

  private normalizeColumnarJSON(
    data: Record<string, unknown>
  ): Array<Record<string, unknown>> {
    const normalized: Array<Record<string, unknown>> = [];
    if (data['metadata']) normalized.push({ metadata: data['metadata'] });

    const dictionary =
      (data['signal_dictionary'] as Record<string, string>) || {};
    const series =
      (data['series'] as Record<string, { t?: number[]; v?: number[] }>) || {};
    const mappedDictionary: Record<string, string> = {};

    for (const [id, rawLocalizedName] of Object.entries(dictionary)) {
      mappedDictionary[id] =
        this.signalRegistry.getCanonicalByPid(id) ||
        rawLocalizedName ||
        `PID ${id}`;
    }

    for (const [signalId, vectors] of Object.entries(series)) {
      const signalName = mappedDictionary[signalId];
      const times = vectors.t || [];
      const values = vectors.v || [];
      const length = Math.min(times.length, values.length);
      for (let i = 0; i < length; i++) {
        normalized.push({ s: signalName, t: times[i], v: values[i] });
      }
    }
    return normalized;
  }

  private isMultiecuscan(fileText: string): boolean {
    if (!fileText) return false;
    const firstLine = fileText.split('\n')[0];
    return firstLine.includes('Czas') && firstLine.includes('\t');
  }

  private normalizeMultiecuscan(
    fileText: string
  ): Array<Record<string, unknown>> {
    const lines = fileText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length < 3) return [];

    const headers = lines[0]
      .split('\t')
      .map((h) => h.replace(/^"|"$/g, '').trim());
    const timeIndex = headers.indexOf('Czas');
    if (timeIndex === -1) return [];

    const normalized: Array<Record<string, unknown>> = [];

    for (let i = 2; i < lines.length; i++) {
      const columns = lines[i]
        .split('\t')
        .map((c) => c.replace(/^"|"$/g, '').trim());
      if (columns.length !== headers.length) continue;

      const timeRaw = columns[timeIndex].replace(',', '.');
      const timeVal = parseFloat(timeRaw);
      if (isNaN(timeVal)) continue;
      const timestampMs = timeVal * 1000;

      headers.forEach((header, colIndex) => {
        if (colIndex === timeIndex) return;
        const rawVal = columns[colIndex];
        if (rawVal === '' || rawVal === undefined || rawVal === null) return;
        const cleanVal = parseFloat(rawVal.replace(',', '.'));
        if (isNaN(cleanVal)) return;
        normalized.push({
          SensorName: header,
          Time_ms: timestampMs,
          Reading: cleanVal,
        });
      });
    }
    return normalized;
  }

  private isAlfaOBD(rows: Array<Record<string, unknown>>): boolean {
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

  private normalizeAlfaOBD(
    rows: Array<Record<string, unknown>>
  ): Array<Record<string, unknown>> {
    const normalized: Array<Record<string, unknown>> = [];
    if (!rows || rows.length === 0) return normalized;
    const keys = Object.keys(rows[0]);
    const timeKey = 'Time';
    const signalKeys = keys.filter((k) => k !== timeKey);

    rows.forEach((row) => {
      const rawTime = row[timeKey] as string;
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

  private detectSchema(samplePoint: Record<string, unknown>) {
    if (!samplePoint) return SCHEMA_REGISTRY.JSON;
    if ('SensorName' in samplePoint) return SCHEMA_REGISTRY.CSV;
    return SCHEMA_REGISTRY.JSON;
  }

  private applyMappingAndCleaning(
    rawPoint: Record<string, unknown>,
    schema: { signal: string; timestamp: string; value: string }
  ): RawDataPoint[] {
    try {
      const baseSignal = rawPoint[schema.signal];
      const timestamp = Number(rawPoint[schema.timestamp]);
      const rawValue = rawPoint[schema.value];

      if (isNaN(timestamp)) return [];

      let prefix = '';
      if (typeof baseSignal === 'string')
        prefix = baseSignal.replace(/\n/g, ' ').trim();

      if (typeof rawValue === 'object' && rawValue !== null) {
        const derivedPoints: RawDataPoint[] = [];
        for (const [key, val] of Object.entries(
          rawValue as Record<string, unknown>
        )) {
          const numVal = Number(val);
          if (isNaN(numVal)) continue;
          const formattedKey = key.charAt(0).toUpperCase() + key.slice(1);
          derivedPoints.push({
            signal: prefix ? `${prefix}-${formattedKey}` : formattedKey,
            timestamp,
            value: numVal,
          });
        }
        return derivedPoints;
      }

      const numValue = Number(rawValue);
      if (isNaN(numValue)) return [];

      return [
        { signal: prefix || String(baseSignal), timestamp, value: numValue },
      ];
    } catch (e) {
      console.error('Data cleaning error:', e);
      return [];
    }
  }

  private parseCSV(csvText: string): Array<Record<string, string>> {
    const lines = csvText.split('\n').filter((line) => line.trim());
    if (lines.length === 0) return [];
    const headers = lines[0].split(',').map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const values = line.split(',');
      return headers.reduce<Record<string, string>>((obj, header, i) => {
        obj[header] = values[i] !== undefined ? values[i].trim() : '';
        return obj;
      }, {});
    });
  }

  private normalizeWideCSV(
    rows: Array<Record<string, string>>
  ): Array<Record<string, unknown>> {
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

    const normalized: Array<Record<string, unknown>> = [];
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

  private transformRawData(data: RawDataPoint[], fileName: string): LoadedFile {
    const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);
    const signals: LoadedFile['signals'] = {};
    let minT = Infinity;
    let maxT = -Infinity;

    sorted.forEach((p) => {
      if (!signals[p.signal]) signals[p.signal] = [];
      signals[p.signal].push({
        [SCHEMA.timeKey]: p.timestamp,
        [SCHEMA.valueKey]: p.value,
      });
      if (p.timestamp < minT) minT = p.timestamp;
      if (p.timestamp > maxT) maxT = p.timestamp;
    });

    return {
      name: fileName,
      rawData: sorted,
      signals,
      startTime: minT,
      duration: data.length > 0 ? (maxT - minT) / 1000 : 0,
      availableSignals: Object.keys(signals).sort(),
      metadata: {},
      size: data.length,
      dbId: null,
    };
  }

  private finalizeBatchLoad(): void {
    this.appState.loading.set(false);
    this.bus.emit(EVENTS.BATCH_LOADED);
  }
}
