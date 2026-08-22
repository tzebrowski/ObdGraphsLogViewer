import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccelerationConfig,
  AccelerationService,
} from './acceleration.service';
import { AccountService } from './account.service';
import { AppStateService } from './app-state.service';
import { EventBusService } from './event-bus.service';
import { LoadedFile, SignalPoint } from './models';

/** Matches DriveService's spec fake: a mocked AccountService rather than the
 * real class, since isSignedIn/hasFeature are backed by private signals
 * with no public setter -- only loginWithGoogle()/logout() (real network
 * calls) mutate them on a real instance. */
function makeAccountFake(
  opts: { signedIn?: boolean; hasFeature?: boolean } = {}
) {
  return {
    isSignedIn: vi.fn().mockReturnValue(opts.signedIn ?? true),
    hasFeature: vi.fn().mockReturnValue(opts.hasFeature ?? true),
  } as unknown as AccountService;
}

/** Matches VersionCheckService's spec: stubs the protected isDevMode()
 * wrapper, since Vitest can't spy on '@angular/core's own export. */
function stubDevMode(devMode: boolean): void {
  vi.spyOn(
    AccelerationService.prototype as unknown as { isDevMode(): boolean },
    'isDevMode'
  ).mockReturnValue(devMode);
}

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

const CONFIG: AccelerationConfig = {
  speedKey: 'Vehicle Speed',
  startSpeed: 2,
  targetSpeed: 100,
  maxDuration: 30,
  backslideTolerance: 5,
};

/** A clean, linear 0-100 launch over 10s, sampled every 1s. */
function cleanRunSpeeds(): SignalPoint[] {
  const points: SignalPoint[] = [];
  for (let s = 0; s <= 20; s++) {
    points.push({ x: s * 1000, y: s * 10 });
  }
  return points;
}

describe('AccelerationService', () => {
  let appState: AppStateService;
  let service: AccelerationService;

  beforeEach(() => {
    appState = new AppStateService(new EventBusService());
    // Real isDevMode() would likely read true in this bare (non-TestBed)
    // unit test environment, silently bypassing the entitlement gate for
    // the wrong reason -- pin it to false so gating tests below actually
    // exercise the account checks, and let the dedicated dev-mode tests
    // override this.
    stubDevMode(false);
    // Most tests below exercise detection/modal-state logic that isn't
    // about the entitlement gate itself, so default to signed-in +
    // entitled, and let the dedicated gating tests override this.
    service = new AccelerationService(appState, makeAccountFake());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('extractRuns', () => {
    it('detects a clean standing-start run reaching the target speed', () => {
      const file = makeFile({ 'Vehicle Speed': cleanRunSpeeds() });

      const runs = service.extractRuns(file, CONFIG);

      expect(runs).toHaveLength(1);
      expect(runs[0].elapsedSeconds).toBeCloseTo(10, 0);
      expect(runs[0].speed[0]).toBeLessThanOrEqual(CONFIG.startSpeed);
      expect(runs[0].speed[runs[0].speed.length - 1]).toBeGreaterThanOrEqual(
        CONFIG.targetSpeed
      );
    });

    it('interpolates the crossing time between samples for sub-sample precision', () => {
      // Speed jumps from 0 to 20 between t=0 and t=1000ms; startSpeed=2 is
      // crossed 1/10 of the way through, so launch should land at t=100ms.
      const file = makeFile({
        'Vehicle Speed': [
          { x: 0, y: 0 },
          { x: 1000, y: 20 },
          { x: 2000, y: 100 },
        ],
      });

      const runs = service.extractRuns(file, CONFIG);

      expect(runs).toHaveLength(1);
      expect(runs[0].startTime).toBeCloseTo(100, 0);
    });

    it('ignores runs that exceed the max duration (e.g. a slow traffic crawl)', () => {
      const points: SignalPoint[] = [];
      // Reaches 100 km/h, but over 60s -- slower than the 30s cutoff.
      for (let s = 0; s <= 60; s++) {
        points.push({ x: s * 1000, y: (s / 60) * 100 + 1 });
      }
      const file = makeFile({ 'Vehicle Speed': points });

      const runs = service.extractRuns(file, CONFIG);
      expect(runs).toHaveLength(0);
    });

    it('abandons a run when the driver lifts off (backslide beyond tolerance) before reaching target', () => {
      const file = makeFile({
        'Vehicle Speed': [
          { x: 0, y: 0 },
          { x: 1000, y: 20 },
          { x: 2000, y: 40 },
          { x: 3000, y: 60 },
          { x: 4000, y: 30 }, // lifts off hard -- 30 km/h backslide from peak 60
          { x: 5000, y: 35 },
          { x: 6000, y: 100 },
        ],
      });

      const runs = service.extractRuns(file, CONFIG);
      expect(runs).toHaveLength(0);
    });

    it('tolerates small noise dips within the backslide tolerance', () => {
      const file = makeFile({
        'Vehicle Speed': [
          { x: 0, y: 0 },
          { x: 1000, y: 20 },
          { x: 2000, y: 40 },
          { x: 3000, y: 38 }, // 2 km/h dip, well within the 5 km/h tolerance
          { x: 4000, y: 60 },
          { x: 5000, y: 100 },
        ],
      });

      const runs = service.extractRuns(file, CONFIG);
      expect(runs).toHaveLength(1);
    });

    it('finds multiple separate runs in the same log', () => {
      const points: SignalPoint[] = [];
      // Run 1: 0-100 over 5s, then coast back to 0, then run 2: 0-100 over 8s.
      for (let s = 0; s <= 5; s++) points.push({ x: s * 1000, y: s * 20 });
      for (let s = 1; s <= 5; s++)
        points.push({ x: (5 + s) * 1000, y: 100 - s * 20 });
      for (let s = 1; s <= 8; s++)
        points.push({ x: (10 + s) * 1000, y: (s / 8) * 100 });

      const file = makeFile({ 'Vehicle Speed': points });
      const runs = service.extractRuns(file, CONFIG);

      expect(runs).toHaveLength(2);
      expect(runs[0].elapsedSeconds).toBeCloseTo(5, 0);
      expect(runs[1].elapsedSeconds).toBeCloseTo(8, 0);
    });

    it('re-anchors on the real launch instead of a sensor-noise blip while stationary', () => {
      // Matches a real bug: speed reads ~2.1 km/h for a moment right at
      // t=0 (noise on an at-rest sensor), settles back to ~0 for several
      // seconds, then launches cleanly to 100 km/h over ~5s starting at
      // t=10s. The reported run must be anchored to the real launch
      // (~10s), not the initial noise blip -- otherwise the idle gap gets
      // folded into elapsedSeconds and a ~5s run is reported as ~15s.
      const points: SignalPoint[] = [
        { x: 0, y: 0 },
        { x: 500, y: 2.1 }, // noise blip just over startSpeed=2
        { x: 1000, y: 0.5 },
        { x: 2000, y: 0 },
        { x: 9000, y: 0 },
        { x: 9700, y: 0 },
      ];
      for (let s = 1; s <= 10; s++) {
        points.push({ x: 9700 + s * 500, y: (s / 10) * 100 });
      }

      const file = makeFile({ 'Vehicle Speed': points });
      const runs = service.extractRuns(file, CONFIG);

      expect(runs).toHaveLength(1);
      expect(runs[0].elapsedSeconds).toBeCloseTo(5, 0);
      expect(runs[0].startTime).toBeGreaterThan(9000);
    });

    it('returns no runs when the target speed is never reached', () => {
      const file = makeFile({
        'Vehicle Speed': [
          { x: 0, y: 0 },
          { x: 1000, y: 20 },
          { x: 2000, y: 40 },
          { x: 3000, y: 50 },
        ],
      });

      const runs = service.extractRuns(file, CONFIG);
      expect(runs).toHaveLength(0);
    });

    it('returns no runs for a missing signal or fewer than 2 samples', () => {
      expect(service.extractRuns(makeFile({}), CONFIG)).toHaveLength(0);
      expect(
        service.extractRuns(
          makeFile({ 'Vehicle Speed': [{ x: 0, y: 0 }] }),
          CONFIG
        )
      ).toHaveLength(0);
    });

    it('leaves splitElapsedSeconds null when splitSpeed is unset', () => {
      const file = makeFile({ 'Vehicle Speed': cleanRunSpeeds() });
      const runs = service.extractRuns(file, CONFIG);
      expect(runs[0].splitElapsedSeconds).toBeNull();
    });

    it('reports a split time (e.g. 0-60) reached partway through the run', () => {
      // Clean 0-100 launch, 10 km/h per second -- crosses 60 km/h at s=6.
      const file = makeFile({ 'Vehicle Speed': cleanRunSpeeds() });
      const runs = service.extractRuns(file, {
        ...CONFIG,
        splitSpeed: 60,
      });
      expect(runs[0].splitElapsedSeconds).toBeCloseTo(5.8, 1);
    });

    it('leaves splitElapsedSeconds null when the split speed is never reached within the run window', () => {
      const points: SignalPoint[] = [];
      for (let s = 0; s <= 5; s++) points.push({ x: s * 1000, y: s * 10 });
      const file = makeFile({ 'Vehicle Speed': points });
      const runs = service.extractRuns(file, {
        ...CONFIG,
        targetSpeed: 50,
        splitSpeed: 60,
      });
      expect(runs).toHaveLength(1);
      expect(runs[0].splitElapsedSeconds).toBeNull();
    });

    it('returns no gear shifts when rpmKey is unset', () => {
      const file = makeFile({ 'Vehicle Speed': cleanRunSpeeds() });
      const runs = service.extractRuns(file, CONFIG);
      expect(runs[0].gearShifts).toEqual([]);
    });

    it('detects gear shifts as confirmed RPM peaks within the run window', () => {
      const rpm: SignalPoint[] = [
        { x: 0, y: 800 }, // before the run window -- ignored
        { x: 500, y: 2000 },
        { x: 1000, y: 3000 },
        { x: 1500, y: 4500 },
        { x: 2000, y: 6000 }, // peak 1
        { x: 2500, y: 3200 }, // confirmed drop -> shift 1
        { x: 3000, y: 4000 },
        { x: 3500, y: 5000 },
        { x: 4000, y: 6200 }, // peak 2
        { x: 4500, y: 3300 }, // confirmed drop -> shift 2
        { x: 5000, y: 4200 },
        { x: 5500, y: 5200 },
        { x: 6000, y: 6500 },
        { x: 6500, y: 6600 },
        { x: 7000, y: 6700 },
        { x: 10000, y: 7000 },
      ];
      const file = makeFile({
        'Vehicle Speed': cleanRunSpeeds(),
        'Engine RPM': rpm,
      });

      const runs = service.extractRuns(file, {
        ...CONFIG,
        rpmKey: 'Engine RPM',
        gearShiftRpmDrop: 400,
      });

      expect(runs[0].gearShifts).toHaveLength(2);
      expect(runs[0].gearShifts[0].rpm).toBe(6000);
      expect(runs[0].gearShifts[0].elapsedSeconds).toBeCloseTo(1.8, 1);
      expect(runs[0].gearShifts[1].rpm).toBe(6200);
      expect(runs[0].gearShifts[1].elapsedSeconds).toBeCloseTo(3.8, 1);
    });

    it('ignores RPM dips smaller than the configured drop threshold as noise', () => {
      const rpm: SignalPoint[] = [
        { x: 500, y: 2000 },
        { x: 1000, y: 4000 },
        { x: 1500, y: 6000 },
        { x: 2000, y: 5900 }, // 100 rpm dip -- well under the 400 threshold
        { x: 2500, y: 6100 },
        { x: 3000, y: 6300 },
      ];
      const file = makeFile({
        'Vehicle Speed': cleanRunSpeeds(),
        'Engine RPM': rpm,
      });

      const runs = service.extractRuns(file, {
        ...CONFIG,
        rpmKey: 'Engine RPM',
        gearShiftRpmDrop: 400,
      });

      expect(runs[0].gearShifts).toEqual([]);
    });
  });

  describe('suggestSignal', () => {
    it('returns the first signal matching a search term', () => {
      const signals = ['Vehicle Speed', 'Engine Speed', 'Coolant Temp'];
      expect(service.suggestSignal(signals, ['vehicle speed', 'speed'])).toBe(
        'Vehicle Speed'
      );
      expect(service.suggestSignal(signals, ['nonexistent'])).toBe('');
    });

    it('prefers an earlier, more specific term over a later generic one even when a generic match sorts first', () => {
      // Alphabetically, "Engine Speed" precedes "Vehicle Speed" and also
      // contains the generic 'speed' fallback term -- the specific
      // 'vehicle speed' term must still win.
      const signals = ['Coolant Temp', 'Engine Speed', 'Vehicle Speed'];
      expect(service.suggestSignal(signals, ['vehicle speed', 'speed'])).toBe(
        'Vehicle Speed'
      );
    });

    it('excludes disqualified candidates even under a generic fallback term', () => {
      // No signal contains 'vehicle speed'/'wheel speed', so this falls
      // through to the bare 'speed' term -- which must skip "Engine Speed"
      // (an RPM channel, not km/h) via the exclude list rather than
      // wrongly suggesting it just because its name contains "Speed".
      const signals = ['Coolant Temp', 'Engine Speed', 'Wheel RPM'];
      expect(
        service.suggestSignal(
          signals,
          ['vehicle speed', 'wheel speed', 'speed'],
          ['engine', 'rpm']
        )
      ).toBe('');
    });
  });

  describe('modal state', () => {
    it('openSetup alerts and stays closed when no files are loaded', () => {
      service.openSetup();
      expect(service.isSetupOpen()).toBe(false);
      expect(appState.alertMessage()).toContain('load a log file');
    });

    it('openSetup alerts and stays closed when not signed in, even with a file loaded', () => {
      service = new AccelerationService(
        appState,
        makeAccountFake({ signedIn: false })
      );
      appState.addFile(makeFile({ 'Vehicle Speed': cleanRunSpeeds() }));

      service.openSetup();

      expect(service.isSetupOpen()).toBe(false);
      expect(appState.alertMessage()).toContain('sign in with Google');
    });

    it("openSetup alerts and stays closed when signed in but the account isn't entitled to Acceleration Runs", () => {
      service = new AccelerationService(
        appState,
        makeAccountFake({ signedIn: true, hasFeature: false })
      );
      appState.addFile(makeFile({ 'Vehicle Speed': cleanRunSpeeds() }));

      service.openSetup();

      expect(service.isSetupOpen()).toBe(false);
      expect(appState.alertMessage()).toContain("doesn't have access");
    });

    it('openSetup skips the entitlement gate entirely under isDevMode(), even signed out with no entitlement', () => {
      stubDevMode(true);
      service = new AccelerationService(
        appState,
        makeAccountFake({ signedIn: false, hasFeature: false })
      );
      appState.addFile(makeFile({ 'Vehicle Speed': cleanRunSpeeds() }));

      service.openSetup();

      expect(service.isSetupOpen()).toBe(true);
      expect(appState.alertMessage()).toBeNull();
    });

    it('openSetup still enforces the "no file loaded" check under isDevMode()', () => {
      stubDevMode(true);
      service = new AccelerationService(
        appState,
        makeAccountFake({ signedIn: false, hasFeature: false })
      );

      service.openSetup();

      expect(service.isSetupOpen()).toBe(false);
      expect(appState.alertMessage()).toContain('load a log file');
    });

    it('generate() reports failure with no matching runs and does not open the modal', () => {
      appState.addFile(
        makeFile({
          'Vehicle Speed': [
            { x: 0, y: 0 },
            { x: 1000, y: 10 },
          ],
        })
      );

      const result = service.generate(CONFIG);
      expect(result.success).toBe(false);
      expect(service.isModalOpen()).toBe(false);
    });

    it('generate() opens the modal and stores sorted runs on success, fastest first', () => {
      const points: SignalPoint[] = [];
      for (let s = 0; s <= 5; s++) points.push({ x: s * 1000, y: s * 20 });
      for (let s = 1; s <= 5; s++)
        points.push({ x: (5 + s) * 1000, y: 100 - s * 20 });
      for (let s = 1; s <= 8; s++)
        points.push({ x: (10 + s) * 1000, y: (s / 8) * 100 });

      appState.addFile(makeFile({ 'Vehicle Speed': points }));

      const result = service.generate(CONFIG);
      expect(result.success).toBe(true);
      expect(service.isModalOpen()).toBe(true);
      expect(service.runs()).toHaveLength(2);
      expect(service.runs()[0].elapsedSeconds).toBeLessThan(
        service.runs()[1].elapsedSeconds
      );
      expect(service.selectedRunIndex()).toBe(0);
    });

    it('toggleExtraSignal adds and removes signals from the selection', () => {
      service.toggleExtraSignal('Engine Speed');
      expect(service.selectedExtraSignals()).toEqual(['Engine Speed']);
      service.toggleExtraSignal('Engine Speed');
      expect(service.selectedExtraSignals()).toEqual([]);
    });

    it('closeModal resets runs and selection state', () => {
      appState.addFile(makeFile({ 'Vehicle Speed': cleanRunSpeeds() }));
      service.generate(CONFIG);
      service.closeModal();

      expect(service.isModalOpen()).toBe(false);
      expect(service.runs()).toEqual([]);
      expect(service.selectedExtraSignals()).toEqual([]);
    });
  });

  describe('highlightRangeForActiveRun', () => {
    it('converts the active run time range to relative seconds', () => {
      appState.addFile(
        makeFile({ 'Vehicle Speed': cleanRunSpeeds() }, { startTime: 500 })
      );
      service.generate(CONFIG);

      const range = service.highlightRangeForActiveRun(appState.files()[0]);
      expect(range).not.toBeNull();
      expect(range!.start).toBeCloseTo(-0.3, 1);
      expect(range!.end).toBeCloseTo(9.5, 1);
    });

    it('returns null when there are no runs', () => {
      const file = makeFile({});
      expect(service.highlightRangeForActiveRun(file)).toBeNull();
    });
  });
});
