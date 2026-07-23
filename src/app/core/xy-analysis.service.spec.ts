import { beforeEach, describe, expect, it } from 'vitest';
import { AppStateService } from './app-state.service';
import { EventBusService } from './event-bus.service';
import { LoadedFile, SignalPoint } from './models';
import { XyAnalysisService } from './xy-analysis.service';

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

describe('XyAnalysisService', () => {
  let appState: AppStateService;
  let service: XyAnalysisService;

  beforeEach(() => {
    appState = new AppStateService(new EventBusService());
    service = new XyAnalysisService(appState);
  });

  describe('generateScatterData', () => {
    it('matches X/Y/Z points that fall within the time tolerance', () => {
      const file = makeFile({
        RPM: [
          { x: 1000, y: 2000 },
          { x: 2000, y: 3000 },
        ],
        Boost: [
          { x: 1000, y: 1.1 },
          { x: 2000, y: 1.4 },
        ],
        Load: [
          { x: 1000, y: 50 },
          { x: 2000, y: 70 },
        ],
      });

      const data = service.generateScatterData(file, 'RPM', 'Boost', 'Load');

      expect(data).toEqual([
        { x: 2000, y: 1.1, z: 50 },
        { x: 3000, y: 1.4, z: 70 },
      ]);
    });

    it('drops points outside the nearest-neighbor tolerance', () => {
      const file = makeFile({
        RPM: [{ x: 1000, y: 2000 }],
        Boost: [{ x: 5000, y: 1.1 }],
        Load: [{ x: 1000, y: 50 }],
      });

      const data = service.generateScatterData(file, 'RPM', 'Boost', 'Load');
      expect(data).toEqual([]);
    });

    it('returns an empty array when a requested signal does not exist', () => {
      const file = makeFile({ RPM: [{ x: 0, y: 1 }] });
      expect(
        service.generateScatterData(file, 'RPM', 'Missing', 'RPM')
      ).toEqual([]);
    });
  });

  describe('getHeatColor', () => {
    it('returns a fixed color when min equals max', () => {
      expect(service.getHeatColor(5, 5, 5)).toBe('hsla(240, 100%, 50%, 0.8)');
    });

    it('maps the minimum value to blue (hue 240) and maximum to red (hue 0)', () => {
      expect(service.getHeatColor(0, 0, 10)).toBe('hsla(240, 100%, 50%, 0.8)');
      expect(service.getHeatColor(10, 0, 10)).toBe('hsla(0, 100%, 50%, 0.8)');
    });

    it('clamps values outside the [min, max] range', () => {
      expect(service.getHeatColor(-5, 0, 10)).toBe('hsla(240, 100%, 50%, 0.8)');
      expect(service.getHeatColor(15, 0, 10)).toBe('hsla(0, 100%, 50%, 0.8)');
    });
  });

  describe('defaultSelection', () => {
    it('matches signals via substring search, falling back to the first signal', () => {
      const signals = ['Engine Rpm', 'Intake Manifold Pressure', 'Air Mass'];
      const selection = service.defaultSelection(signals, 0);
      expect(selection).toEqual({
        xSignal: 'Engine Rpm',
        ySignal: 'Intake Manifold Pressure',
        zSignal: 'Air Mass',
      });
    });

    it('falls back to the first signal when nothing matches', () => {
      const signals = ['Foo', 'Bar'];
      const selection = service.defaultSelection(signals, 0);
      expect(selection.xSignal).toBe('Foo');
    });
  });

  describe('modal + panel state', () => {
    it('openModal alerts and stays closed with no files loaded', () => {
      service.openModal();
      expect(service.isModalOpen()).toBe(false);
      expect(appState.alertMessage()).toContain('load a log file');
    });

    it('openModal resets the file index and opens when files exist', () => {
      appState.addFile(makeFile({ RPM: [{ x: 0, y: 1 }] }));
      service.setFileIndex(0);
      service.openModal();
      expect(service.isModalOpen()).toBe(true);
      expect(service.currentFileIndex()).toBe(0);
    });

    it('setPanelSignal updates only the targeted axis of the targeted panel', () => {
      service.setPanelSignal(0, 'xSignal', 'RPM');
      service.setPanelSignal(1, 'ySignal', 'Boost');

      expect(service.panels()[0]).toEqual({
        xSignal: 'RPM',
        ySignal: '',
        zSignal: '',
      });
      expect(service.panels()[1]).toEqual({
        xSignal: '',
        ySignal: 'Boost',
        zSignal: '',
      });
    });
  });
});
