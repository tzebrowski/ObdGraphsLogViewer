import { beforeEach, describe, expect, it } from 'vitest';
import { AppStateService } from './app-state.service';
import { EventBusService } from './event-bus.service';
import { HistogramService } from './histogram.service';
import { LoadedFile, SignalPoint } from './models';

function makeFile(
  signals: Record<string, SignalPoint[]>,
  overrides: Partial<LoadedFile> = {}
): LoadedFile {
  return {
    name: 'trip.json',
    rawData: [],
    signals,
    startTime: 0,
    duration: 10,
    availableSignals: Object.keys(signals).sort(),
    metadata: {},
    size: 0,
    dbId: 1,
    ...overrides,
  };
}

describe('HistogramService', () => {
  let appState: AppStateService;
  let service: HistogramService;

  beforeEach(() => {
    appState = new AppStateService(new EventBusService());
    service = new HistogramService(appState);
  });

  describe('computeBins', () => {
    it('distributes values across bins by range, including the max value in the last bin', () => {
      const { labels, bins } = service.computeBins([0, 25, 50, 75, 100], 4);

      expect(labels).toEqual([
        '0.0 - 25.0',
        '25.0 - 50.0',
        '50.0 - 75.0',
        '75.0 - 100.0',
      ]);
      expect(bins).toEqual([1, 1, 1, 2]); // 100 falls into the last bin via the clamp
    });

    it('puts everything in bin 0 with a single label when all values are equal', () => {
      const { labels, bins } = service.computeBins([5, 5, 5], 10);

      expect(labels).toEqual(['5.0']);
      expect(bins[0]).toBe(3);
      expect(bins).toHaveLength(10);
    });
  });

  describe('modal state', () => {
    it('openModal alerts and stays closed with no files loaded', () => {
      service.openModal();
      expect(service.isModalOpen()).toBe(false);
      expect(appState.alertMessage()).toContain('load a log file');
    });

    it('openModal seeds the first file and its first (sorted) signal', () => {
      appState.addFile(
        makeFile({ Zeta: [{ x: 0, y: 1 }], Alpha: [{ x: 0, y: 2 }] })
      );

      service.openModal();

      expect(service.isModalOpen()).toBe(true);
      expect(service.fileIndex()).toBe(0);
      expect(service.signalName()).toBe('Alpha');
      expect(service.binCount()).toBe(20);
    });

    it('setFileIndex reseeds the signal for the newly selected file', () => {
      appState.addFile(
        makeFile({ RPM: [{ x: 0, y: 1 }] }, { name: 'a.json', dbId: 1 })
      );
      appState.addFile(
        makeFile({ Boost: [{ x: 0, y: 1 }] }, { name: 'b.json', dbId: 2 })
      );

      service.setFileIndex(1);

      expect(service.fileIndex()).toBe(1);
      expect(service.signalName()).toBe('Boost');
    });
  });
});
