import { beforeEach, describe, expect, it } from 'vitest';
import { AppStateService } from './app-state.service';
import { EventBusService } from './event-bus.service';
import { MathChannelsService } from './math-channels.service';
import { EVENTS, LoadedFile, SignalPoint } from './models';
import { SignalRegistryService } from './signal-registry.service';

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

describe('MathChannelsService', () => {
  let appState: AppStateService;
  let service: MathChannelsService;

  beforeEach(() => {
    const bus = new EventBusService();
    appState = new AppStateService(bus);
    service = new MathChannelsService(
      appState,
      bus,
      new SignalRegistryService()
    );
  });

  describe('createChannel core logic', () => {
    it('throws if no file is loaded', () => {
      expect(() => service.createChannel(0, 'boost', [], 'Test')).toThrow(
        'No file selected or loaded.'
      );
    });

    it('throws for an unknown formula id', () => {
      appState.addFile(makeFile({}));
      expect(() => service.createChannel(0, 'unknown_id', [], 'Test')).toThrow(
        'Invalid formula definition.'
      );
    });

    it('throws when a required signal is missing', () => {
      appState.addFile(makeFile({ A: [] }));
      expect(() =>
        service.createChannel(0, 'boost', ['A', 'B'], 'Test')
      ).toThrow("Signal 'B' not found.");
    });

    it('throws for an invalid constant value', () => {
      appState.addFile(makeFile({ A: [{ x: 1, y: 1 }] }));
      expect(() =>
        service.createChannel(0, 'multiply_const', ['A', 'invalid_text'], 'Err')
      ).toThrow('Invalid constant');
    });

    it('registers the new channel in signals, metadata, and availableSignals', () => {
      appState.addFile(makeFile({ A: [{ x: 1, y: 1 }] }));
      service.createChannel(0, 'multiply_const', ['A', '2'], 'New');
      const file = appState.files()[0];

      expect(file.signals['Math: New']).toBeDefined();
      expect(file.metadata['Math: New']).toBeDefined();
      expect(file.availableSignals).toContain('Math: New');
    });
  });

  describe('business formulas', () => {
    it('Fuel Volume: clamps input percentage between 0 and 100', () => {
      const fuelLevel: SignalPoint[] = [
        { x: 1, y: -10 },
        { x: 2, y: 50 },
        { x: 3, y: 150 },
      ];
      appState.addFile(makeFile({ Fuel: fuelLevel }));

      service.createChannel(0, 'fuel_volume', ['Fuel', '60'], 'Liters');
      const res = appState.files()[0].signals['Math: Liters'];

      expect(res[0].y).toBe(0);
      expect(res[1].y).toBe(30);
      expect(res[2].y).toBe(60);
    });

    it('Est Range (Fixed): calculates correctly and avoids division by zero', () => {
      appState.addFile(makeFile({ Fuel: [{ x: 1, y: 50 }] }));

      service.createChannel(
        0,
        'est_range_fixed',
        ['Fuel', '50', '10'],
        'Range'
      );
      expect(appState.files()[0].signals['Math: Range'][0].y).toBe(250);

      service.createChannel(
        0,
        'est_range_fixed',
        ['Fuel', '50', '0'],
        'RangeZero'
      );
      expect(appState.files()[0].signals['Math: RangeZero'][0].y).toBe(0);
    });

    it('Trip Distance: subtracts the initial odometer value', () => {
      const odo: SignalPoint[] = [
        { x: 0, y: 10000 },
        { x: 1, y: 10005 },
        { x: 2, y: 10010 },
      ];
      appState.addFile(makeFile({ Odo: odo }));

      service.createChannel(0, 'trip_distance', ['Odo'], 'Trip');
      const res = appState.files()[0].signals['Math: Trip'];

      expect(res.map((p) => p.y)).toEqual([0, 5, 10]);
    });
  });

  describe('technical formulas', () => {
    it('Acceleration: standard calculation & dt=0 skip', () => {
      const speedData: SignalPoint[] = [
        { x: 0, y: 0 },
        { x: 1000, y: 36 },
        { x: 1000, y: 36 },
        { x: 2000, y: 72 },
      ];
      appState.addFile(makeFile({ Speed: speedData }));

      service.createChannel(0, 'acceleration', ['Speed'], 'Accel');
      const res = appState.files()[0].signals['Math: Accel'];

      expect(res).toHaveLength(2);
      expect(res[0].y).toBeCloseTo(10);
      expect(res[1].y).toBeCloseTo(10);
    });

    it('Smoothing: sliding window average', () => {
      const data: SignalPoint[] = [
        { x: 1, y: 10 },
        { x: 2, y: 20 },
        { x: 3, y: 30 },
        { x: 4, y: 40 },
      ];
      appState.addFile(makeFile({ S: data }));

      service.createChannel(0, 'smoothing', ['S', '3'], 'Smoothie');
      const res = appState.files()[0].signals['Math: Smoothie'];

      expect(res.map((p) => p.y)).toEqual([10, 15, 20, 30]);
    });

    it('Pressure Ratio: handles division by zero', () => {
      appState.addFile(
        makeFile({
          M: [
            { x: 1, y: 100 },
            { x: 2, y: 200 },
          ],
          B: [
            { x: 1, y: 0 },
            { x: 2, y: 100 },
          ],
        })
      );

      service.createChannel(0, 'pressure_ratio', ['M', 'B'], 'PR');
      const res = appState.files()[0].signals['Math: PR'];

      expect(res[0].y).toBe(0);
      expect(res[1].y).toBe(2);
    });

    it('Filters: greater-than and less-than logic', () => {
      appState.addFile(
        makeFile({ S: [{ x: 1, y: 100 }], C: [{ x: 1, y: 50 }] })
      );

      service.createChannel(0, 'filter_gt', ['S', 'C', '10', '0'], 'GT_Pass');
      expect(appState.files()[0].signals['Math: GT_Pass'][0].y).toBe(100);

      service.createChannel(0, 'filter_gt', ['S', 'C', '60', '0'], 'GT_Fail');
      expect(appState.files()[0].signals['Math: GT_Fail'][0].y).toBe(0);

      service.createChannel(0, 'filter_lt', ['S', 'C', '60', '0'], 'LT_Pass');
      expect(appState.files()[0].signals['Math: LT_Pass'][0].y).toBe(100);
    });
  });

  describe('interpolation', () => {
    it('clamps to the start/end values outside the data range', () => {
      appState.addFile(
        makeFile({
          M: [{ x: 500, y: 1 }],
          S: [
            { x: 100, y: 10 },
            { x: 200, y: 20 },
          ],
        })
      );

      service.createChannel(0, 'boost', ['M', 'S'], 'ClampCheck');
      expect(appState.files()[0].signals['Math: ClampCheck'][0].y).toBe(1 - 20);
    });

    it('interpolates linearly between two points', () => {
      appState.addFile(
        makeFile({
          M: [{ x: 150, y: 0 }],
          S: [
            { x: 100, y: 10 },
            { x: 200, y: 20 },
          ],
        })
      );

      service.createChannel(0, 'boost', ['M', 'S'], 'Linear');
      expect(appState.files()[0].signals['Math: Linear'][0].y).toBe(-15);
    });
  });

  describe('batch creation', () => {
    it('creates one channel per selected source signal', () => {
      appState.addFile(
        makeFile({
          A: [{ x: 1, y: 100 }],
          B: [{ x: 1, y: 200 }],
          Cond: [{ x: 1, y: 50 }],
        })
      );
      const definition = service.getDefinition('filtered_batch')!;

      const created = service.createBatchChannels(
        definition,
        ['A', 'B'],
        ['Cond', '10', '1', '0'],
        0
      );

      expect(created).toEqual(['Math: Filtered: A', 'Math: Filtered: B']);
      expect(appState.files()[0].signals['Math: Filtered: A'][0].y).toBe(100);
      expect(appState.files()[0].signals['Math: Filtered: B'][0].y).toBe(200);
    });

    it('logs an ACTION_LOG event per created channel', () => {
      appState.addFile(
        makeFile({ A: [{ x: 1, y: 100 }], Cond: [{ x: 1, y: 50 }] })
      );
      const bus = new EventBusService();
      const svc = new MathChannelsService(
        appState,
        bus,
        new SignalRegistryService()
      );
      const events: unknown[] = [];
      bus.on(EVENTS.ACTION_LOG).subscribe((e) => events.push(e));

      const definition = svc.getDefinition('filtered_batch')!;
      svc.createBatchChannels(definition, ['A'], ['Cond', '10', '1', '0'], 0);

      expect(events).toHaveLength(1);
    });
  });

  describe('createSingleChannel', () => {
    it('creates the channel and emits one ACTION_LOG event', () => {
      const bus = new EventBusService();
      const state = new AppStateService(bus);
      state.addFile(makeFile({ A: [{ x: 1, y: 1 }] }));
      const svc = new MathChannelsService(
        state,
        bus,
        new SignalRegistryService()
      );

      const events: unknown[] = [];
      bus.on(EVENTS.ACTION_LOG).subscribe((e) => events.push(e));

      svc.createSingleChannel(0, 'multiply_const', ['A', '2'], 'Doubled');

      expect(state.files()[0].signals['Math: Doubled']).toBeDefined();
      expect(events).toHaveLength(1);
    });

    it('does not log when options.isReplay is set', () => {
      const bus = new EventBusService();
      const state = new AppStateService(bus);
      state.addFile(makeFile({ A: [{ x: 1, y: 1 }] }));
      const svc = new MathChannelsService(
        state,
        bus,
        new SignalRegistryService()
      );

      const events: unknown[] = [];
      bus.on(EVENTS.ACTION_LOG).subscribe((e) => events.push(e));

      svc.createSingleChannel(0, 'multiply_const', ['A', '2'], 'Replayed', {
        isReplay: true,
      });

      expect(events).toHaveLength(0);
    });
  });

  describe('executeAutoMath', () => {
    it('auto-creates GPS distance/speed and trip cost channels when the raw signals exist', () => {
      appState.addFile(
        makeFile({
          Latitude: [
            { x: 0, y: 52.0 },
            { x: 1000, y: 52.001 },
          ],
          Longitude: [
            { x: 0, y: 21.0 },
            { x: 1000, y: 21.001 },
          ],
          'Fuel Level': [{ x: 0, y: 80 }],
        })
      );

      service.executeAutoMath();
      const file = appState.files()[0];

      expect(file.signals['Math: GPS Trip Distance (Auto)']).toBeDefined();
      expect(file.signals['Math: GPS Speed (Auto)']).toBeDefined();
      expect(file.signals['Math: Trip Costs (Auto)']).toBeDefined();
    });

    it('skips a definition whose required signal is not available', () => {
      appState.addFile(makeFile({ Unrelated: [{ x: 0, y: 1 }] }));
      service.executeAutoMath();

      expect(appState.files()[0].availableSignals).toEqual(['Unrelated']);
    });

    it('runs automatically when BATCH_LOADED is emitted on the bus', () => {
      const bus = new EventBusService();
      const state = new AppStateService(bus);
      new MathChannelsService(state, bus, new SignalRegistryService());

      state.addFile(
        makeFile({
          Latitude: [
            { x: 0, y: 52.0 },
            { x: 1000, y: 52.001 },
          ],
          Longitude: [
            { x: 0, y: 21.0 },
            { x: 1000, y: 21.001 },
          ],
        })
      );

      bus.emit(EVENTS.BATCH_LOADED);

      expect(
        state.files()[0].signals['Math: GPS Trip Distance (Auto)']
      ).toBeDefined();
    });
  });
});
