import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStateService } from './app-state.service';
import {
  DataProcessorService,
  MAPPING_CHUNK_SIZE,
} from './data-processor.service';
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

  afterEach(() => {
    vi.unstubAllGlobals();
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

  describe('chunked mapping for large batches', () => {
    it('processes a batch spanning multiple mapping chunks without dropping or reordering points', async () => {
      const totalPoints = MAPPING_CHUNK_SIZE * 2 + 500;
      const data = Array.from({ length: totalPoints }, (_, i) => ({
        s: 'RPM',
        t: i,
        v: i,
      }));

      await service.handleFiles([jsonFile('huge.json', data)]);

      const file = appState.files()[0];
      expect(file.size).toBe(totalPoints);
      expect(file.signals['RPM']).toHaveLength(totalPoints);
      expect(file.signals['RPM'][0]).toEqual({ x: 0, y: 0 });
      expect(file.signals['RPM'][totalPoints - 1]).toEqual({
        x: totalPoints - 1,
        y: totalPoints - 1,
      });
    });

    it('yields to the event loop between mapping chunks instead of blocking in one synchronous pass', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const yieldSpy = vi.spyOn(service as any, 'yieldToMain');

      const totalPoints = MAPPING_CHUNK_SIZE * 2 + 500; // 3 chunks
      const data = Array.from({ length: totalPoints }, (_, i) => ({
        s: 'RPM',
        t: i,
        v: i,
      }));

      await service.handleFiles([jsonFile('huge.json', data)]);

      // 1 yield so the loading spinner can paint + 2 yields between the 3
      // mapping chunks (none after the last chunk) + 1 yield before the
      // sort/bucketing pass.
      expect(yieldSpy).toHaveBeenCalledTimes(4);
      expect(appState.files()[0].signals['RPM']).toHaveLength(totalPoints);
    });

    it('does not yield between mapping chunks when the batch fits in a single chunk', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const yieldSpy = vi.spyOn(service as any, 'yieldToMain');

      const data = [{ s: 'RPM', t: 1, v: 100 }];
      await service.handleFiles([jsonFile('small.json', data)]);

      // 1 yield for the loading spinner + 1 yield before the sort pass;
      // no additional yields since there's only one chunk.
      expect(yieldSpy).toHaveBeenCalledTimes(2);
    });

    it("uses MessageChannel-based yielding rather than setTimeout, which Chrome throttles to ~1/sec in backgrounded tabs and would otherwise turn a dense file's ~100+ chunk yields into a multi-minute stall", async () => {
      const MessageChannelSpy = vi.spyOn(globalThis, 'MessageChannel');

      const totalPoints = MAPPING_CHUNK_SIZE * 2 + 500; // 3 chunks -> 4 yields
      const data = Array.from({ length: totalPoints }, (_, i) => ({
        s: 'RPM',
        t: i,
        v: i,
      }));

      await service.handleFiles([jsonFile('huge.json', data)]);

      expect(MessageChannelSpy).toHaveBeenCalledTimes(4);
    });
  });

  describe('loadSampleTrip', () => {
    it('fetches the bundled sample trip and adds it as a file', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => [{ s: 'RPM', t: 0, v: 1000 }],
        })
      );

      await service.loadSampleTrip();

      expect(appState.files()).toHaveLength(1);
      expect(appState.files()[0].name).toBe('sample-trip-giulia.json');
      expect(appState.loading()).toBe(false);
    });

    it('shows an alert and rethrows when the download fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 500 })
      );

      await expect(service.loadSampleTrip()).rejects.toThrow();

      expect(appState.files()).toHaveLength(0);
      expect(appState.alertMessage()).toContain('Failed to load sample data');
      expect(appState.loading()).toBe(false);
    });

    it('finalizes the batch load so auto math channels (e.g. GPS speed) are computed', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => [
            { s: 'Latitude', t: 0, v: 52.0 },
            { s: 'Longitude', t: 0, v: 21.0 },
            { s: 'Latitude', t: 1000, v: 52.001 },
            { s: 'Longitude', t: 1000, v: 21.001 },
          ],
        })
      );

      await service.loadSampleTrip();

      expect(
        appState.files()[0].signals['Math: GPS Speed (Auto)']
      ).toBeDefined();
    });
  });

  describe('processExternal', () => {
    it('adds the file and finalizes the batch load so auto math channels are computed', async () => {
      const result = await service.processExternal(
        [
          { s: 'Latitude', t: 0, v: 52.0 },
          { s: 'Longitude', t: 0, v: 21.0 },
          { s: 'Latitude', t: 1000, v: 52.001 },
          { s: 'Longitude', t: 1000, v: 21.001 },
        ],
        'drive-file.json'
      );

      expect(result?.name).toBe('drive-file.json');
      expect(appState.files()).toHaveLength(1);
      expect(appState.loading()).toBe(false);
      expect(
        appState.files()[0].signals['Math: GPS Speed (Auto)']
      ).toBeDefined();
    });
  });
});
