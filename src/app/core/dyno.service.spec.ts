import { beforeEach, describe, expect, it } from 'vitest';
import { AppStateService } from './app-state.service';
import { DynoConfig, DynoService } from './dyno.service';
import { EventBusService } from './event-bus.service';
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

const CONFIG: DynoConfig = {
  rpmKey: 'Engine Speed',
  torqueKey: 'Measured Engine Torque',
  pedalKey: 'Gas Pedal Position',
  pedalStart: 60,
  pedalWot: 85,
  rpmDelta: 1200,
};

describe('DynoService', () => {
  let appState: AppStateService;
  let service: DynoService;

  beforeEach(() => {
    appState = new AppStateService(new EventBusService());
    service = new DynoService(appState);
  });

  describe('extractPulls', () => {
    it('extracts a valid WOT pull with forward-filling', () => {
      const file = makeFile({
        'Engine Speed': [
          { x: 1000, y: 2000 },
          { x: 2000, y: 3500 },
          { x: 3000, y: 5000 },
          { x: 4000, y: 2000 },
        ],
        'Measured Engine Torque': [
          { x: 1000, y: 300 },
          { x: 2000, y: 400 },
          { x: 3000, y: 350 },
          { x: 4000, y: 100 },
        ],
        'Gas Pedal Position': [
          { x: 1000, y: 90 },
          { x: 3000, y: 90 },
          { x: 4000, y: 10 },
        ],
      });

      const pulls = service.extractPulls(file, CONFIG);

      expect(pulls).toHaveLength(1);
      expect(pulls[0].rpm[0]).toBe(2000);
      expect(pulls[0].rpm[pulls[0].rpm.length - 1]).toBe(5000);
    });

    it('handles a decimal pedal scale (0.0 to 1.0)', () => {
      const file = makeFile({
        'Engine Speed': [
          { x: 1000, y: 2000 },
          { x: 2000, y: 4000 },
          { x: 3000, y: 1500 },
        ],
        'Measured Engine Torque': [
          { x: 1000, y: 300 },
          { x: 2000, y: 350 },
          { x: 3000, y: 100 },
        ],
        'Gas Pedal Position': [
          { x: 1000, y: 0.95 },
          { x: 2000, y: 0.95 },
          { x: 3000, y: 0.1 },
        ],
      });

      const pulls = service.extractPulls(file, CONFIG);
      expect(pulls).toHaveLength(1);
    });

    it('rejects sweeps below the Min RPM Delta threshold', () => {
      const file = makeFile({
        'Engine Speed': [
          { x: 1000, y: 2000 },
          { x: 2000, y: 2500 },
          { x: 3000, y: 1000 },
        ],
        'Measured Engine Torque': [
          { x: 1000, y: 300 },
          { x: 2000, y: 300 },
          { x: 3000, y: 100 },
        ],
        'Gas Pedal Position': [
          { x: 1000, y: 100 },
          { x: 2000, y: 100 },
          { x: 3000, y: 0 },
        ],
      });

      const pulls = service.extractPulls(file, CONFIG);
      expect(pulls).toHaveLength(0);
    });

    it('captures a pull still in progress at the end of the log', () => {
      const file = makeFile({
        'Engine Speed': [
          { x: 1000, y: 2000 },
          { x: 2000, y: 5000 },
        ],
        'Measured Engine Torque': [
          { x: 1000, y: 300 },
          { x: 2000, y: 350 },
        ],
        'Gas Pedal Position': [
          { x: 1000, y: 90 },
          { x: 2000, y: 90 },
        ],
      });

      const pulls = service.extractPulls(file, CONFIG);
      expect(pulls).toHaveLength(1);
      expect(pulls[0].rpm).toEqual([2000, 5000]);
    });
  });

  describe('computeDynoPoints', () => {
    it('bins by RPM and computes torque/power averages with extra-signal overlays', () => {
      const file = makeFile({
        Boost: [
          { x: 1000, y: 1.0 },
          { x: 2000, y: 1.2 },
        ],
      });
      const pull = {
        rpm: [2010, 2020],
        torque: [300, 320],
        power: [(300 * 2010) / 7021.5, (320 * 2020) / 7021.5],
        time: [1000, 2000],
      };

      const points = service.computeDynoPoints(file, pull, ['Boost']);

      expect(points).toHaveLength(1);
      expect(points[0].rpm).toBe(2000);
      expect(points[0].torque).toBeCloseTo(310);
      expect(points[0].extras['Boost']).toBeCloseTo(1.1);
    });
  });

  describe('suggestSignal', () => {
    it('returns the first signal matching a search term', () => {
      const signals = ['Vehicle Speed', 'Engine Speed', 'Coolant Temp'];
      expect(service.suggestSignal(signals, ['engine speed', 'rpm'])).toBe(
        'Engine Speed'
      );
      expect(service.suggestSignal(signals, ['nonexistent'])).toBe('');
    });
  });

  describe('modal state', () => {
    it('openSetup alerts and stays closed when no files are loaded', () => {
      service.openSetup();
      expect(service.isSetupOpen()).toBe(false);
      expect(appState.alertMessage()).toContain('load a log file');
    });

    it('generate() reports failure with no matching pulls and does not open the modal', () => {
      appState.addFile(
        makeFile({
          'Engine Speed': [{ x: 0, y: 1000 }],
          'Measured Engine Torque': [{ x: 0, y: 100 }],
          'Gas Pedal Position': [{ x: 0, y: 10 }],
        })
      );

      const result = service.generate(CONFIG);
      expect(result.success).toBe(false);
      expect(service.isModalOpen()).toBe(false);
    });

    it('generate() opens the modal and stores sorted pulls on success', () => {
      appState.addFile(
        makeFile({
          'Engine Speed': [
            { x: 1000, y: 2000 },
            { x: 2000, y: 5000 },
            { x: 3000, y: 1000 },
          ],
          'Measured Engine Torque': [
            { x: 1000, y: 300 },
            { x: 2000, y: 350 },
            { x: 3000, y: 100 },
          ],
          'Gas Pedal Position': [
            { x: 1000, y: 90 },
            { x: 2000, y: 90 },
            { x: 3000, y: 10 },
          ],
        })
      );

      const result = service.generate(CONFIG);
      expect(result.success).toBe(true);
      expect(service.isModalOpen()).toBe(true);
      expect(service.pulls()).toHaveLength(1);
      expect(service.selectedPullIndex()).toBe(0);
    });

    it('toggleExtraSignal adds and removes signals from the selection', () => {
      service.toggleExtraSignal('Boost');
      expect(service.selectedExtraSignals()).toEqual(['Boost']);
      service.toggleExtraSignal('Boost');
      expect(service.selectedExtraSignals()).toEqual([]);
    });

    it('closeModal resets pulls and selection state', () => {
      appState.addFile(
        makeFile({
          'Engine Speed': [
            { x: 1000, y: 2000 },
            { x: 2000, y: 5000 },
          ],
          'Measured Engine Torque': [
            { x: 1000, y: 300 },
            { x: 2000, y: 350 },
          ],
          'Gas Pedal Position': [
            { x: 1000, y: 90 },
            { x: 2000, y: 90 },
          ],
        })
      );
      service.generate(CONFIG);
      service.closeModal();

      expect(service.isModalOpen()).toBe(false);
      expect(service.pulls()).toEqual([]);
      expect(service.selectedExtraSignals()).toEqual([]);
    });
  });

  describe('highlightRangeForActivePull', () => {
    it('converts the active pull time range to relative seconds', () => {
      appState.addFile(
        makeFile(
          {
            'Engine Speed': [
              { x: 1000, y: 2000 },
              { x: 3000, y: 5000 },
            ],
            'Measured Engine Torque': [
              { x: 1000, y: 300 },
              { x: 3000, y: 350 },
            ],
            'Gas Pedal Position': [
              { x: 1000, y: 90 },
              { x: 3000, y: 90 },
            ],
          },
          { startTime: 500 }
        )
      );
      service.generate(CONFIG);

      const range = service.highlightRangeForActivePull(appState.files()[0]);
      expect(range).toEqual({ start: 0.5, end: 2.5 });
    });

    it('returns null when there are no pulls', () => {
      const file = makeFile({});
      expect(service.highlightRangeForActivePull(file)).toBeNull();
    });
  });
});
