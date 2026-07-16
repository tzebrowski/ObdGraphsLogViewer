import { beforeEach, describe, expect, it } from 'vitest';
import { MapLinearInterpolator, MapService } from './map.service';
import { LoadedFile, SignalPoint } from './models';
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

describe('MapService', () => {
  let service: MapService;

  beforeEach(() => {
    service = new MapService(new SignalRegistryService());
  });

  describe('MapLinearInterpolator', () => {
    it('returns null for empty data', () => {
      expect(new MapLinearInterpolator([]).getValueAt(100)).toBeNull();
    });

    it('clamps to the start/end values outside the data range', () => {
      const interp = new MapLinearInterpolator([
        { x: 100, y: 10 },
        { x: 200, y: 20 },
      ]);
      expect(interp.getValueAt(0)).toBe(10);
      expect(interp.getValueAt(500)).toBe(20);
    });

    it('interpolates linearly between two points', () => {
      const interp = new MapLinearInterpolator([
        { x: 100, y: 10 },
        { x: 200, y: 20 },
      ]);
      expect(interp.getValueAt(150)).toBe(15);
    });
  });

  describe('isValidGps', () => {
    it('rejects null/NaN and near-zero coordinates', () => {
      expect(service.isValidGps(null, 10)).toBe(false);
      expect(service.isValidGps(10, null)).toBe(false);
      expect(service.isValidGps(NaN, 10)).toBe(false);
      expect(service.isValidGps(0.05, 0.05)).toBe(false);
    });

    it('accepts plausible coordinates', () => {
      expect(service.isValidGps(52.23, 21.01)).toBe(true);
    });
  });

  describe('getValueColor', () => {
    it('maps min to green (120) and max to red (0)', () => {
      expect(service.getValueColor(0, 0, 100)).toBe('hsl(120, 100%, 50%)');
      expect(service.getValueColor(100, 0, 100)).toBe('hsl(0, 100%, 50%)');
    });

    it('returns gray for NaN', () => {
      expect(service.getValueColor(NaN, 0, 100)).toBe('#888');
    });

    it('clamps out-of-range values', () => {
      expect(service.getValueColor(-50, 0, 100)).toBe('hsl(120, 100%, 50%)');
      expect(service.getValueColor(150, 0, 100)).toBe('hsl(0, 100%, 50%)');
    });
  });

  describe('processGpsData', () => {
    it('returns null when latitude/longitude signals are missing', () => {
      const file = makeFile({ RPM: [{ x: 0, y: 1000 }] });
      expect(service.processGpsData(file)).toBeNull();
    });

    it('builds a heatmap route colored by an auto-detected speed signal', () => {
      const file = makeFile({
        Latitude: [
          { x: 0, y: 52.0 },
          { x: 1000, y: 52.001 },
          { x: 2000, y: 52.002 },
        ],
        Longitude: [
          { x: 0, y: 21.0 },
          { x: 1000, y: 21.001 },
          { x: 2000, y: 21.002 },
        ],
        'Vehicle Speed': [
          { x: 0, y: 10 },
          { x: 1000, y: 50 },
          { x: 2000, y: 90 },
        ],
      });

      const result = service.processGpsData(file);

      expect(result).not.toBeNull();
      expect(result!.isHeatmap).toBe(true);
      expect(result!.heatmapMeta).toEqual({
        name: 'Vehicle Speed',
        min: 10,
        max: 90,
      });
      expect(result!.routePoints).toHaveLength(3);
      expect(result!.routePoints[0].color).toBe('hsl(120, 100%, 50%)');
      expect(result!.routePoints[2].color).toBe('hsl(0, 100%, 50%)');
    });

    it('falls back to a flat route color when no speed-like signal exists', () => {
      const file = makeFile({
        Latitude: [
          { x: 0, y: 52.0 },
          { x: 1000, y: 52.001 },
        ],
        Longitude: [
          { x: 0, y: 21.0 },
          { x: 1000, y: 21.001 },
        ],
      });

      const result = service.processGpsData(file);

      expect(result).not.toBeNull();
      expect(result!.isHeatmap).toBe(false);
      expect(result!.heatmapMeta).toBeNull();
      expect(result!.routePoints.every((p) => p.color === '#3388ff')).toBe(
        true
      );
    });

    it('prefers an explicit color-signal override', () => {
      const file = makeFile({
        Latitude: [{ x: 0, y: 52.0 }],
        Longitude: [{ x: 0, y: 21.0 }],
        Boost: [{ x: 0, y: 1.5 }],
      });

      const result = service.processGpsData(file, 'Boost');
      expect(result!.heatmapMeta?.name).toBe('Boost');
    });

    it('drops invalid (near-zero) GPS points', () => {
      const file = makeFile({
        Latitude: [
          { x: 0, y: 0 },
          { x: 1000, y: 52.0 },
        ],
        Longitude: [
          { x: 0, y: 0 },
          { x: 1000, y: 21.0 },
        ],
      });

      const result = service.processGpsData(file);
      expect(result!.routePoints).toHaveLength(1);
    });
  });

  describe('calculateStats', () => {
    it('returns zeroed stats for fewer than two points', () => {
      expect(service.calculateStats([], new MapLinearInterpolator([]))).toEqual(
        {
          dist: '0.00',
          avg: '0.0',
          max: '0.0',
        }
      );
    });

    it('computes distance and average/max speed from a simple route', () => {
      const latData: SignalPoint[] = [
        { x: 0, y: 52.0 },
        { x: 60000, y: 52.01 },
      ];
      const lonInterpolator = new MapLinearInterpolator([
        { x: 0, y: 21.0 },
        { x: 60000, y: 21.0 },
      ]);

      const stats = service.calculateStats(latData, lonInterpolator);
      const distKm = parseFloat(stats.dist);
      expect(distKm).toBeGreaterThan(1);
      expect(distKm).toBeLessThan(1.2);
      expect(parseFloat(stats.avg)).toBeGreaterThan(0);
      expect(parseFloat(stats.max)).toBeGreaterThan(0);
    });
  });

  describe('getDistanceFromLatLonInKm', () => {
    it('computes roughly 111km per degree of latitude', () => {
      const dist = service.getDistanceFromLatLonInKm(0, 0, 1, 0);
      expect(dist).toBeGreaterThan(110);
      expect(dist).toBeLessThan(112);
    });

    it('returns ~0 for identical points', () => {
      expect(service.getDistanceFromLatLonInKm(52, 21, 52, 21)).toBeCloseTo(0);
    });
  });

  describe('calculateBearing', () => {
    it('returns ~0 degrees for due-north travel', () => {
      const bearing = service.calculateBearing(0, 0, 1, 0);
      expect(bearing).toBeCloseTo(0, 0);
    });

    it('returns ~90 degrees for due-east travel', () => {
      const bearing = service.calculateBearing(0, 0, 0, 1);
      expect(bearing).toBeCloseTo(90, 0);
    });
  });

  describe('findNearestTime', () => {
    it('returns the timestamp of the closest route point', () => {
      const file = makeFile({
        Latitude: [
          { x: 0, y: 52.0 },
          { x: 1000, y: 52.01 },
          { x: 2000, y: 52.02 },
        ],
        Longitude: [
          { x: 0, y: 21.0 },
          { x: 1000, y: 21.01 },
          { x: 2000, y: 21.02 },
        ],
      });
      const lonInterpolator = new MapLinearInterpolator(
        file.signals['Longitude']
      );

      const time = service.findNearestTime(file, lonInterpolator, {
        lat: 52.0095,
        lng: 21.0095,
      });
      expect(time).toBe(1000);
    });

    it('returns null when no latitude signal is detected', () => {
      const file = makeFile({ RPM: [{ x: 0, y: 1 }] });
      const time = service.findNearestTime(
        file,
        new MapLinearInterpolator([]),
        { lat: 0, lng: 0 }
      );
      expect(time).toBeNull();
    });
  });

  describe('detectGpsSignals', () => {
    it('resolves canonical Latitude/Longitude signal names', () => {
      const file = makeFile({
        Latitude: [{ x: 0, y: 1 }],
        Longitude: [{ x: 0, y: 1 }],
      });
      expect(service.detectGpsSignals(file)).toEqual({
        latKey: 'Latitude',
        lonKey: 'Longitude',
      });
    });
  });

  describe('hover state', () => {
    it('setStackHover/setOverlayHover/clearHover manage independent signals', () => {
      service.setStackHover(1, 500);
      service.setOverlayHover(250);
      expect(service.stackHover()).toEqual({ fileIndex: 1, time: 500 });
      expect(service.overlayHover()).toBe(250);

      service.clearHover();
      expect(service.stackHover()).toBeNull();
      expect(service.overlayHover()).toBeNull();
    });
  });
});
