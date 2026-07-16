import { beforeEach, describe, expect, it } from 'vitest';
import { AppStateService } from './app-state.service';
import { DataProcessorService } from './data-processor.service';
import { DbManagerService } from './db-manager.service';
import { EventBusService } from './event-bus.service';
import { MathChannelsService } from './math-channels.service';
import { PreferencesService } from './preferences.service';
import { ProjectManagerService } from './project-manager.service';
import { SignalRegistryService } from './signal-registry.service';

function jsonFile(name: string, data: unknown): File {
  return new File([JSON.stringify(data)], name, { type: 'application/json' });
}

function csvFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/csv' });
}

describe('DataProcessorService', () => {
  let appState: AppStateService;
  let service: DataProcessorService;

  beforeEach(() => {
    const bus = new EventBusService();
    appState = new AppStateService(bus);
    const signalRegistry = new SignalRegistryService();
    const mathChannels = new MathChannelsService(appState, bus, signalRegistry);
    service = new DataProcessorService(
      appState,
      new DbManagerService(),
      bus,
      new ProjectManagerService(
        appState,
        new DbManagerService(),
        bus,
        new PreferencesService(),
        mathChannels
      ),
      signalRegistry
    );
  });

  it('groups signals, sorts by timestamp, and computes duration', async () => {
    const data = [
      { s: 'RPM', t: 2000, v: 1200 },
      { s: 'RPM', t: 1000, v: 800 },
      { s: 'Speed', t: 1000, v: 0 },
    ];
    await service.handleFiles([jsonFile('trip.json', data)]);

    expect(appState.files()).toHaveLength(1);
    const file = appState.files()[0];
    expect(file.availableSignals).toEqual(['RPM', 'Speed']);
    expect(file.signals['RPM']).toHaveLength(2);
    expect(file.rawData[0].timestamp).toBe(1000);
    expect(file.rawData[file.rawData.length - 1].timestamp).toBe(2000);
    expect(file.duration).toBe(1);
  });

  it('replaces newlines in signal names and maps to x/y chart schema', async () => {
    const data = [{ s: 'Engine\nTemp', t: 100, v: 25 }];
    await service.handleFiles([jsonFile('t.json', data)]);

    const file = appState.files()[0];
    expect(file.rawData[0].signal).toBe('Engine Temp');
    expect(file.signals['Engine Temp'][0]).toEqual({ x: 100, y: 25 });
  });

  it('flattens nested object values into composite, capitalized signals', async () => {
    const data = [
      { t: 1000, s: 'GPS', v: { latitude: 54.1, longitude: 16.2 } },
    ];
    await service.handleFiles([jsonFile('gps.json', data)]);

    const file = appState.files()[0];
    expect(file.availableSignals).toEqual(
      expect.arrayContaining(['GPS-Latitude', 'GPS-Longitude'])
    );
    expect(file.signals['GPS-Latitude'][0].y).toBe(54.1);
  });

  it('extracts a leading metadata element without counting it as telemetry', async () => {
    const data = [
      { metadata: { 'trip.duration': '30' } },
      { s: 'RPM', t: 1000, v: 800 },
      { s: 'RPM', t: 2000, v: 1500 },
    ];
    await service.handleFiles([jsonFile('meta.json', data)]);

    const file = appState.files()[0];
    expect(file.metadata['trip.duration']).toBe('30');
    expect(file.size).toBe(2);
    expect(file.signals['RPM']).toHaveLength(2);
  });

  it('normalizes columnar JSON (signal_dictionary + series) into per-point signals', async () => {
    const data = {
      metadata: { 'trip.duration': '3600' },
      signal_dictionary: { 12: 'Boost Pressure' },
      series: { 12: { t: [1000, 2000], v: [14.1, 15.2] } },
    };
    await service.handleFiles([jsonFile('columnar.json', data)]);

    const file = appState.files()[0];
    expect(file.availableSignals).toContain('Boost Pressure');
    expect(file.signals['Boost Pressure']).toEqual([
      { x: 1000, y: 14.1 },
      { x: 2000, y: 15.2 },
    ]);
  });

  it('parses wide CSV with "Time (s)" header, converting seconds to milliseconds', async () => {
    const csv = 'Time (s),RPM,Speed\n1.000,2000,50\n2.500,2500,60';
    await service.handleFiles([csvFile('export.csv', csv)]);

    const file = appState.files()[0];
    expect(file.availableSignals).toEqual(
      expect.arrayContaining(['RPM', 'Speed'])
    );
    expect(file.signals['RPM'][0]).toEqual({ x: 1000, y: 2000 });
    expect(file.signals['Speed'][1]).toEqual({ x: 2500, y: 60 });
  });

  it('does not multiply time when the header has no "(s)" suffix', async () => {
    const csv = 'time,Boost\n1000,1.5';
    await service.handleFiles([csvFile('raw_time.csv', csv)]);

    const point = appState.files()[0].signals['Boost'][0];
    expect(point.x).toBe(1000);
    expect(point.y).toBe(1.5);
  });

  it('detects AlfaOBD HH:MM:SS.mmm CSVs and converts to absolute milliseconds', async () => {
    const csv = 'Time,Engine speed rpm\n13:48:35.666,1584\n13:48:37.223,1858';
    await service.handleFiles([csvFile('alfaobd_log.csv', csv)]);

    const rpmSignal = appState.files()[0].signals['Engine speed rpm'];
    expect(rpmSignal[0]).toEqual({ x: 49715666, y: 1584 });
    expect(rpmSignal[1]).toEqual({ x: 49717223, y: 1858 });
  });

  it('detects tab-separated Multiecuscan CSVs and converts seconds to milliseconds', async () => {
    const mesData =
      '"Czas"\t"Prędkość pojazdu"\t"Obroty silnika"\n' +
      '"s"\t"km/h"\t"obr/min"\n' +
      '0,00\t49,1000\t1265,0000\n' +
      '2,77\t47,9000\t1235,0000';
    await service.handleFiles([csvFile('giulia_2.csv', mesData)]);

    const file = appState.files()[0];
    expect(file.availableSignals).toEqual([
      'Obroty silnika',
      'Prędkość pojazdu',
    ]);
    expect(file.signals['Prędkość pojazdu'][0]).toEqual({ x: 0, y: 49.1 });
    expect(file.signals['Obroty silnika'][1]).toEqual({ x: 2770, y: 1235 });
  });

  it('shows an alert and skips the file when JSON parsing fails, without adding a file', async () => {
    const badFile = new File(['not json'], 'bad.json', {
      type: 'application/json',
    });
    await service.handleFiles([badFile]);

    expect(appState.files()).toHaveLength(0);
    expect(appState.alertMessage()).toContain('bad.json');
  });

  it('clears the loading state once all files in the batch finish', async () => {
    await service.handleFiles([jsonFile('a.json', [{ s: 'RPM', t: 1, v: 1 }])]);
    expect(appState.loading()).toBe(false);
  });
});
