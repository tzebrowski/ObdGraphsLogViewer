import { beforeEach, describe, expect, it } from 'vitest';
import { AnalysisService } from './analysis.service';
import { AppStateService } from './app-state.service';
import { EventBusService } from './event-bus.service';
import { LoadedFile, RawDataPoint } from './models';
import { SignalRegistryService } from './signal-registry.service';

function makeFile(
  rawData: RawDataPoint[],
  overrides: Partial<LoadedFile> = {}
): LoadedFile {
  return {
    name: 'trip.json',
    rawData,
    signals: {},
    startTime: 0,
    duration: 10,
    availableSignals: [...new Set(rawData.map((p) => p.signal))].sort(),
    metadata: {},
    size: rawData.length,
    dbId: 1,
    ...overrides,
  };
}

describe('AnalysisService', () => {
  let appState: AppStateService;
  let service: AnalysisService;

  beforeEach(() => {
    const bus = new EventBusService();
    appState = new AppStateService(bus);
    service = new AnalysisService(appState, new SignalRegistryService(), bus);
  });

  it('starts with a single empty filter row', () => {
    expect(service.filters()).toHaveLength(1);
    expect(service.filters()[0]).toEqual(
      expect.objectContaining({
        fileIdx: -1,
        signal: '',
        operator: '>',
        value: '',
      })
    );
  });

  it('addFilterRow/removeFilterRow/updateFilterRow manage the filter list', () => {
    service.addFilterRow();
    expect(service.filters()).toHaveLength(2);

    const id = service.filters()[0].id;
    service.updateFilterRow(id, { signal: 'RPM', value: '3000' });
    expect(service.filters()[0].signal).toBe('RPM');

    service.removeFilterRow(id);
    expect(service.filters()).toHaveLength(1);
  });

  it('runScan reports "No criteria defined" when no row has a signal+value', () => {
    service.runScan();
    expect(service.results()).toEqual([]);
    expect(service.scanMessage()).toBe('No criteria defined');
  });

  it('runScan finds a single contiguous event matching one criterion', () => {
    appState.addFile(
      makeFile([
        { signal: 'RPM', timestamp: 0, value: 1000 },
        { signal: 'RPM', timestamp: 1000, value: 5000 },
        { signal: 'RPM', timestamp: 2000, value: 5200 },
        { signal: 'RPM', timestamp: 3000, value: 1000 },
      ])
    );

    const id = service.filters()[0].id;
    service.updateFilterRow(id, {
      signal: 'RPM',
      operator: '>',
      value: '4000',
    });
    service.runScan();

    expect(service.results()).toEqual([
      { start: 1000, end: 3000, fileName: 'trip.json', fileIdx: 0 },
    ]);
    expect(service.scanMessage()).toBe('1 events found');
  });

  it('flushes an event that is still matching at the last row', () => {
    appState.addFile(
      makeFile([
        { signal: 'RPM', timestamp: 0, value: 1000 },
        { signal: 'RPM', timestamp: 1000, value: 5000 },
        { signal: 'RPM', timestamp: 2000, value: 5200 },
      ])
    );

    service.updateFilterRow(service.filters()[0].id, {
      signal: 'RPM',
      operator: '>',
      value: '4000',
    });
    service.runScan();

    expect(service.results()).toEqual([
      { start: 1000, end: 2000, fileName: 'trip.json', fileIdx: 0 },
    ]);
    expect(service.scanMessage()).toBe('1 events found');
  });

  it('runScan requires all criteria to match simultaneously (AND semantics)', () => {
    appState.addFile(
      makeFile([
        { signal: 'RPM', timestamp: 0, value: 5000 },
        { signal: 'Load', timestamp: 0, value: 10 },
        { signal: 'RPM', timestamp: 1000, value: 5000 },
        { signal: 'Load', timestamp: 1000, value: 90 },
        { signal: 'RPM', timestamp: 2000, value: 1000 },
        { signal: 'Load', timestamp: 2000, value: 90 },
      ])
    );

    service.updateFilterRow(service.filters()[0].id, {
      signal: 'RPM',
      operator: '>',
      value: '4000',
    });
    service.addFilterRow();
    service.updateFilterRow(service.filters()[1].id, {
      signal: 'Load',
      operator: '>',
      value: '50',
    });
    service.runScan();

    expect(service.results()).toEqual([
      { start: 1000, end: 2000, fileName: 'trip.json', fileIdx: 0 },
    ]);
  });

  it('respects a per-row file scope (fileIdx !== -1)', () => {
    appState.addFile(
      makeFile(
        [
          { signal: 'RPM', timestamp: 0, value: 5000 },
          { signal: 'RPM', timestamp: 1000, value: 1000 },
        ],
        { name: 'a.json', dbId: 1 }
      )
    );
    appState.addFile(
      makeFile(
        [
          { signal: 'RPM', timestamp: 0, value: 5000 },
          { signal: 'RPM', timestamp: 1000, value: 1000 },
        ],
        { name: 'b.json', dbId: 2 }
      )
    );

    service.updateFilterRow(service.filters()[0].id, {
      fileIdx: 1,
      signal: 'RPM',
      operator: '>',
      value: '4000',
    });
    service.runScan();

    expect(service.results()).toEqual([
      { start: 0, end: 1000, fileName: 'b.json', fileIdx: 1 },
    ]);
  });

  it('applyTemplate resolves signal names via the registry and runs a scan', () => {
    appState.addFile(
      makeFile([
        {
          signal: 'Intake Manifold Pressure Measured',
          timestamp: 0,
          value: 2500,
        },
        { signal: 'Spark Advance', timestamp: 0, value: -2 },
        {
          signal: 'Intake Manifold Pressure Measured',
          timestamp: 1000,
          value: 1000,
        },
        { signal: 'Spark Advance', timestamp: 1000, value: 10 },
      ])
    );

    service.applyTemplate('high_load_retard');

    expect(service.filters()).toHaveLength(2);
    expect(service.filters().map((r) => r.signal)).toEqual(
      expect.arrayContaining([
        'Intake Manifold Pressure Measured',
        'Spark Advance',
      ])
    );
    expect(service.results()).toHaveLength(1);
  });

  it('applyTemplate is a no-op for an unknown template key', () => {
    const before = service.filters();
    service.applyTemplate('does_not_exist');
    expect(service.filters()).toBe(before);
  });

  it('clears results when a file is removed', () => {
    appState.addFile(
      makeFile([
        { signal: 'RPM', timestamp: 0, value: 5000 },
        { signal: 'RPM', timestamp: 1000, value: 1000 },
      ])
    );
    service.updateFilterRow(service.filters()[0].id, {
      signal: 'RPM',
      operator: '>',
      value: '4000',
    });
    service.runScan();
    expect(service.results()).toHaveLength(1);

    appState.removeFileAt(0);
    expect(service.results()).toEqual([]);
    expect(service.scanMessage()).toBe('');
  });
});
