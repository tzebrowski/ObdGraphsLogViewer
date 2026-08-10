import { Injectable, signal } from '@angular/core';
import { LoadedFile, SignalPoint } from './models';
import { SignalRegistryService } from './signal-registry.service';

const ROUTE_COLORS = ['#3388ff', '#ff3333', '#33ff33', '#ffa500'];
const MARKER_COLORS = ['#ff0000', '#0000ff', '#00aa00', '#aa00aa'];

export interface StackHoverState {
  fileIndex: number;
  time: number;
}

export interface ZoomRange {
  start: number;
  end: number;
}

export interface StackZoomRange extends ZoomRange {
  fileIndex: number;
}

export interface RoutePoint {
  lat: number;
  lon: number;
  color: string;
}

export interface HeatmapMeta {
  name: string;
  min: number;
  max: number;
}

export interface ProcessedGpsData {
  routePoints: RoutePoint[];
  latInterpolator: MapLinearInterpolator;
  lonInterpolator: MapLinearInterpolator;
  valInterpolator: MapLinearInterpolator | null;
  latData: SignalPoint[];
  isHeatmap: boolean;
  heatmapMeta: HeatmapMeta | null;
}

export interface GpsStats {
  dist: string;
  avg: string;
  max: string;
}

/** Port of legacy/src/mapmanager.js's `LinearInterpolator` — returns null (not 0) for empty data. */
export class MapLinearInterpolator {
  private lastIndex = 0;

  constructor(private readonly data: SignalPoint[]) {}

  getValueAt(time: number): number | null {
    if (!this.data || this.data.length === 0) return null;

    if (time <= this.data[0].x) return this.data[0].y;
    if (time >= this.data[this.data.length - 1].x)
      return this.data[this.data.length - 1].y;

    let i = this.lastIndex;
    if (this.data[i].x > time) i = 0;

    while (i < this.data.length - 1 && this.data[i + 1].x < time) {
      i++;
    }
    this.lastIndex = i;

    const p1 = this.data[i];
    const p2 = this.data[i + 1];
    if (!p1 || !p2) return this.data[0].y;

    const range = p2.x - p1.x;
    if (range === 0) return p1.y;

    const factor = (time - p1.x) / range;
    return p1.y + (p2.y - p1.y) * factor;
  }
}

/**
 * Port of legacy/src/mapmanager.js's pure GPS-processing logic: signal
 * detection, route/heatmap point generation, trip stats, bearing/distance
 * math, and nearest-time lookup for click-to-seek. Leaflet instance
 * management (map/layer/marker lifecycle) lives in EmbeddedMap/OverlayMap
 * since it's inherently imperative, matching how Chart.js instances are
 * owned by ChartView rather than a service.
 *
 * Also ports legacy/src/mapmanager.js's `setColorMetric` (manual
 * color-metric override, exposed as `colorSignalOverrides`) and
 * `syncMapBounds` (reverse chart-zoom-drives-map-bounds sync, exposed as
 * `stackZoomRange`/`overlayZoomRange` + `getBoundsPointsInRange`) — both
 * were unused dead code in legacy (defined but never wired to any UI or
 * caller), so this is a from-scratch UI wiring against legacy's existing
 * plumbing rather than a straight behavioral port.
 */
@Injectable({ providedIn: 'root' })
export class MapService {
  /** Set by ChartView's Chart.js onHover (stack mode); EmbeddedMap reacts by moving its marker. */
  readonly stackHover = signal<StackHoverState | null>(null);
  /** Same, for overlay mode: one merged chart drives every file's map simultaneously. */
  readonly overlayHover = signal<number | null>(null);

  /** Keyed by fileIndex; `null`/absent means auto-detect (GPS/vehicle speed). */
  readonly colorSignalOverrides = signal<Record<number, string | null>>({});

  /** Set by ChartView on zoom/pan/reset (stack mode); EmbeddedMap reacts by fitting its bounds. */
  readonly stackZoomRange = signal<StackZoomRange | null>(null);
  /** Same, for overlay mode. */
  readonly overlayZoomRange = signal<ZoomRange | null>(null);

  constructor(private readonly signalRegistry: SignalRegistryService) {}

  setStackHover(fileIndex: number, time: number): void {
    this.stackHover.set({ fileIndex, time });
  }

  setOverlayHover(time: number): void {
    this.overlayHover.set(time);
  }

  clearHover(): void {
    this.stackHover.set(null);
    this.overlayHover.set(null);
  }

  setColorSignalOverride(fileIndex: number, signalName: string | null): void {
    this.colorSignalOverrides.update((overrides) => ({
      ...overrides,
      [fileIndex]: signalName,
    }));
  }

  setStackZoomRange(fileIndex: number, start: number, end: number): void {
    this.stackZoomRange.set({ fileIndex, start, end });
  }

  setOverlayZoomRange(start: number, end: number): void {
    this.overlayZoomRange.set({ start, end });
  }

  /** Port of legacy/src/mapmanager.js's `syncMapBounds`'s per-file point-sampling loop. */
  getBoundsPointsInRange(
    file: LoadedFile,
    startAbs: number,
    endAbs: number
  ): Array<[number, number]> {
    const { latKey, lonKey } = this.detectGpsSignals(file);
    if (!latKey || !lonKey) return [];

    const latData = file.signals[latKey];
    const lonInterpolator = new MapLinearInterpolator(file.signals[lonKey]);
    const points: Array<[number, number]> = [];

    for (let i = 0; i < latData.length; i += 10) {
      const p = latData[i];
      if (p.x < startAbs || p.x > endAbs) continue;
      const lat = p.y;
      const lon = lonInterpolator.getValueAt(p.x);
      if (lon !== null && this.isValidGps(lat, lon)) points.push([lat, lon]);
    }
    return points;
  }

  detectGpsSignals(file: LoadedFile): {
    latKey: string | null;
    lonKey: string | null;
  } {
    const signals = file.availableSignals || [];
    return {
      latKey: this.signalRegistry.findSignal('Latitude', signals),
      lonKey: this.signalRegistry.findSignal('Longitude', signals),
    };
  }

  isValidGps(lat: number | null, lon: number | null): boolean {
    return (
      lat != null &&
      lon != null &&
      !isNaN(lat) &&
      !isNaN(lon) &&
      Math.abs(lat) > 0.1 &&
      Math.abs(lon) > 0.1
    );
  }

  getValueColor(value: number, min: number, max: number): string {
    if (isNaN(value)) return '#888';
    let ratio = (value - min) / (max - min);
    ratio = Math.max(0, Math.min(1, ratio));
    const hue = ((1 - ratio) * 120).toFixed(0);
    return `hsl(${hue}, 100%, 50%)`;
  }

  getRouteColor(index: number): string {
    return ROUTE_COLORS[index % ROUTE_COLORS.length];
  }

  getMarkerColor(index: number): string {
    return MARKER_COLORS[index % MARKER_COLORS.length];
  }

  processGpsData(
    file: LoadedFile,
    colorSignalOverride: string | null = null
  ): ProcessedGpsData | null {
    const { latKey, lonKey } = this.detectGpsSignals(file);
    if (!latKey || !lonKey) return null;

    const latData = file.signals[latKey];
    const lonData = file.signals[lonKey];

    let valueData: SignalPoint[] | null = null;
    let minVal = 0;
    let maxVal = 100;
    let usedSignalName = colorSignalOverride;
    let heatmapMeta: HeatmapMeta | null = null;

    if (!usedSignalName) {
      if (file.signals['Math: GPS Speed (Auto)']) {
        usedSignalName = 'Math: GPS Speed (Auto)';
      } else if (file.signals['Math: GPS Speed']) {
        usedSignalName = 'Math: GPS Speed';
      } else {
        usedSignalName =
          this.signalRegistry.findSignal('GPS Speed', file.availableSignals) ||
          this.signalRegistry.findSignal(
            'Vehicle Speed',
            file.availableSignals
          );
      }
    }

    if (usedSignalName && file.signals[usedSignalName]) {
      valueData = file.signals[usedSignalName];
      let min = Infinity;
      let max = -Infinity;
      for (const point of valueData) {
        const v = point.y;
        if (!isNaN(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      if (min === Infinity) {
        min = 0;
        max = 100;
      }
      minVal = min;
      maxVal = max;
      if (maxVal - minVal < 1) maxVal = minVal + 10;
      heatmapMeta = { name: usedSignalName, min: minVal, max: maxVal };
    }

    const valInterpolator = valueData
      ? new MapLinearInterpolator(valueData)
      : null;
    const latInterpolator = new MapLinearInterpolator(latData);
    const lonInterpolator = new MapLinearInterpolator(lonData);

    const routePoints: RoutePoint[] = [];
    const step = Math.max(1, Math.ceil(latData.length / 3000));

    for (let i = 0; i < latData.length; i += step) {
      const p = latData[i];
      const lat = p.y;
      const lon = lonInterpolator.getValueAt(p.x);

      if (lon !== null && this.isValidGps(lat, lon)) {
        let color = this.getRouteColor(0);

        if (valInterpolator) {
          const val = valInterpolator.getValueAt(p.x);
          if (val !== null) color = this.getValueColor(val, minVal, maxVal);
        }

        routePoints.push({ lat, lon, color });
      }
    }

    if (routePoints.length === 0) return null;

    return {
      routePoints,
      latInterpolator,
      lonInterpolator,
      valInterpolator,
      latData,
      isHeatmap: !!valInterpolator,
      heatmapMeta,
    };
  }

  calculateStats(
    latData: SignalPoint[],
    lonInterpolator: MapLinearInterpolator
  ): GpsStats {
    if (!latData || latData.length < 2)
      return { dist: '0.00', avg: '0.0', max: '0.0' };

    let totalDistKm = 0;
    let maxSpeedKmh = 0;
    const validPoints: Array<{ x: number; y: number; lon: number }> = [];
    const timeMult =
      (latData[latData.length - 1].x - latData[0].x) / latData.length < 10
        ? 1000
        : 1;

    for (const p of latData) {
      const lat = p.y;
      const lon = lonInterpolator.getValueAt(p.x);
      if (lon !== null && this.isValidGps(lat, lon)) {
        validPoints.push({ x: p.x * timeMult, y: lat, lon });
      }
    }
    if (validPoints.length < 2) return { dist: '0.00', avg: '0.0', max: '0.0' };

    let lastP = validPoints[0];
    for (let i = 1; i < validPoints.length; i++) {
      const p = validPoints[i];
      const dist = this.getDistanceFromLatLonInKm(
        lastP.y,
        lastP.lon,
        p.y,
        p.lon
      );
      const timeDiffHours = (p.x - lastP.x) / 3600000;
      if (dist > 0.0005) {
        totalDistKm += dist;
        lastP = p;
      }
      if (timeDiffHours > 0.00005) {
        const speed = dist / timeDiffHours;
        if (speed < 300 && speed > maxSpeedKmh) maxSpeedKmh = speed;
      }
    }
    const totalTimeHours =
      (validPoints[validPoints.length - 1].x - validPoints[0].x) / 3600000;
    return {
      dist: totalDistKm.toFixed(2),
      avg:
        totalTimeHours > 0.001
          ? (totalDistKm / totalTimeHours).toFixed(1)
          : '0.0',
      max: maxSpeedKmh.toFixed(1),
    };
  }

  getDistanceFromLatLonInKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371;
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) *
        Math.cos(this.deg2rad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  calculateBearing(
    startLat: number,
    startLng: number,
    destLat: number,
    destLng: number
  ): number {
    const startLatRad = this.deg2rad(startLat);
    const startLngRad = this.deg2rad(startLng);
    const destLatRad = this.deg2rad(destLat);
    const destLngRad = this.deg2rad(destLng);
    const y = Math.sin(destLngRad - startLngRad) * Math.cos(destLatRad);
    const x =
      Math.cos(startLatRad) * Math.sin(destLatRad) -
      Math.sin(startLatRad) *
        Math.cos(destLatRad) *
        Math.cos(destLngRad - startLngRad);
    return (this.rad2deg(Math.atan2(y, x)) + 360) % 360;
  }

  findNearestTime(
    file: LoadedFile,
    lonInterpolator: MapLinearInterpolator,
    latlng: { lat: number; lng: number }
  ): number | null {
    const { latKey } = this.detectGpsSignals(file);
    if (!latKey) return null;
    const latData = file.signals[latKey];
    if (!latData) return null;

    let minDist = Infinity;
    let closestTime: number | null = null;
    latData.forEach((p) => {
      const lat = p.y;
      const lon = lonInterpolator.getValueAt(p.x);
      if (lon === null) return;
      const d = Math.pow(lat - latlng.lat, 2) + Math.pow(lon - latlng.lng, 2);
      if (d < minDist) {
        minDist = d;
        closestTime = p.x;
      }
    });
    return closestTime;
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  private rad2deg(rad: number): number {
    return (rad * 180) / Math.PI;
  }
}
