import L from 'leaflet';
import { AppState, EVENTS } from './config.js';
import { messenger } from './bus.js';
import { Preferences } from './preferences.js';
import { signalRegistry } from './signalregistry.js';

// Using CartoDB Voyager for high contrast and clean look
const TILES_LIGHT =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILES_DARK =
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

export class LinearInterpolator {
  constructor(data) {
    this.data = data;
    this.lastIndex = 0;
  }

  getValueAt(time) {
    if (!this.data || this.data.length === 0) return null;

    const t = parseFloat(time);

    if (t <= this.data[0].x) return parseFloat(this.data[0].y);
    if (t >= this.data[this.data.length - 1].x)
      return parseFloat(this.data[this.data.length - 1].y);

    let i = this.lastIndex;
    if (this.data[i].x > t) i = 0;

    while (i < this.data.length - 1 && this.data[i + 1].x < t) {
      i++;
    }
    this.lastIndex = i;

    const p1 = this.data[i];
    const p2 = this.data[i + 1];

    if (!p1 || !p2) return parseFloat(this.data[0].y);

    const y1 = parseFloat(p1.y);
    const y2 = parseFloat(p2.y);
    const x1 = parseFloat(p1.x);
    const x2 = parseFloat(p2.x);

    const range = x2 - x1;
    if (range === 0) return y1;

    const factor = (t - x1) / range;
    return y1 + (y2 - y1) * factor;
  }
}

class MapManager {
  #contexts = new Map();
  #isReady = false;
  #activeColorSignal = null;

  constructor() {}

  reset() {
    this.clearAllMaps();
    this.#isReady = false;
    this.#activeColorSignal = null;
  }

  init() {
    this.#isReady = true;

    messenger.on(EVENTS.FILE_REMOVED, (data) => this.#handleFileRemoved(data));

    messenger.on('preferences:updated', (prefs) => {
      if (prefs.loadMap) {
        AppState.files.forEach((_, index) => {
          this.loadRoute(index);
        });
      } else {
        this.reset();
      }
    });
  }

  setColorMetric(signalName) {
    console.log(`[MapManager] Color metric set to: ${signalName || 'Auto'}`);
    this.#activeColorSignal = signalName;
    this.#contexts.forEach((ctx, fileIndex) => {
      this.loadRoute(fileIndex);
    });
    this.loadOverlayMap();
  }

  updateTheme(theme) {
    const newUrl = theme === 'dark' ? TILES_DARK : TILES_LIGHT;
    const updatedMaps = new Set();
    this.#contexts.forEach((ctx) => {
      if (ctx.tileLayer && ctx.map && !updatedMaps.has(ctx.map)) {
        ctx.tileLayer.setUrl(newUrl);
        updatedMaps.add(ctx.map);
      }
    });
  }

  #handleFileRemoved(data) {
    this.#removeMapContext(data.index);
  }

  #removeMapContext(fileIndex) {
    if (this.#contexts.has(fileIndex)) {
      this.#contexts.delete(fileIndex);
      const container = document.getElementById(`embedded-map-${fileIndex}`);
      if (container) {
        container.classList.remove('active');
        container.innerHTML = '';
      }
    }
  }

  #processGpsData(file) {
    const { latKey, lonKey } = this.#detectGpsSignals(file);
    if (!latKey || !lonKey) return null;

    const latData = file.signals[latKey];
    const lonData = file.signals[lonKey];

    // --- HEATMAP DATA PREP ---
    let valueData = null;
    let minVal = 0;
    let maxVal = 100;
    let usedSignalName = this.#activeColorSignal;
    let heatmapMeta = null;

    // 1. Auto-Detection Priority:
    if (!usedSignalName) {
      if (file.signals['Math: GPS Speed (Auto)']) {
        usedSignalName = 'Math: GPS Speed (Auto)';
      } else if (file.signals['Math: GPS Speed']) {
        usedSignalName = 'Math: GPS Speed';
      } else {
        usedSignalName =
          signalRegistry.findSignal('GPS Speed', file.availableSignals) ||
          signalRegistry.findSignal('Vehicle Speed', file.availableSignals);
      }
    }

    // 2. Load Data & Calculate Min/Max
    if (usedSignalName && file.signals[usedSignalName]) {
      valueData = file.signals[usedSignalName];

      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < valueData.length; i++) {
        const v = parseFloat(valueData[i].y);
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

      if (maxVal - minVal < 1) {
        maxVal = minVal + 10;
      }

      heatmapMeta = {
        name: usedSignalName,
        min: minVal,
        max: maxVal,
      };
    }

    const valInterpolator = valueData
      ? new LinearInterpolator(valueData)
      : null;
    const latInterpolator = new LinearInterpolator(latData);
    const lonInterpolator = new LinearInterpolator(lonData);

    const routePoints = [];
    const step = Math.max(1, Math.ceil(latData.length / 3000));

    for (let i = 0; i < latData.length; i += step) {
      const p = latData[i];
      const lat = parseFloat(p.y);
      const lon = parseFloat(lonInterpolator.getValueAt(p.x));

      if (this.#isValidGps(lat, lon)) {
        let color = this.#getRouteColor(0);

        if (valInterpolator) {
          const val = parseFloat(valInterpolator.getValueAt(p.x));
          color = this.#getValueColor(val, minVal, maxVal);
        }

        routePoints.push({ lat, lon, color });
      }
    }

    if (routePoints.length === 0) return null;

    return {
      routePoints,
      latInterpolator,
      lonInterpolator,
      latData,
      isHeatmap: !!valInterpolator,
      heatmapMeta,
    };
  }

  #addRouteVisuals(mapInstance, routePoints, fileIndex, options = {}) {
    const { isOverlay = false, isHeatmap = false } = options;

    const layerGroup = L.layerGroup().addTo(mapInstance);

    const latLngs = routePoints.map((p) => [p.lat, p.lon]);

    // 1. Backing Line (Black Border)
    L.polyline(latLngs, {
      color: '#000000',
      weight: isOverlay ? 6 : 9,
      opacity: 0.6,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
    }).addTo(layerGroup);

    // 2. Colored Path
    const weight = isOverlay ? 4 : 6;

    if (isHeatmap) {
      for (let i = 0; i < routePoints.length - 1; i++) {
        const p1 = routePoints[i];
        const p2 = routePoints[i + 1];

        L.polyline(
          [
            [p1.lat, p1.lon],
            [p2.lat, p2.lon],
          ],
          {
            color: p1.color,
            weight: weight,
            opacity: 1.0,
            lineCap: 'butt',
            interactive: false,
          }
        ).addTo(layerGroup);
      }
    } else {
      const line = L.polyline(latLngs, {
        color: this.#getRouteColor(fileIndex),
        weight: weight,
        opacity: 1.0,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layerGroup);

      if (!isOverlay) {
        line.on('click', (e) =>
          this.#handleMapInteraction(fileIndex, e.latlng)
        );
      }
    }

    // 3. Marker
    const startPoint = [routePoints[0].lat, routePoints[0].lon];
    const arrowIcon = L.divIcon({
      className: 'gps-marker-icon',
      html: `
        <svg width="24" height="24" viewBox="0 0 24 24" style="transform-origin: center; display: block; filter: drop-shadow(0px 0px 3px rgba(0,0,0,0.5));">
            <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" 
                  fill="${this.#getMarkerColor(fileIndex)}" stroke="white" stroke-width="2"/>
        </svg>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    const positionMarker = L.marker(startPoint, {
      icon: arrowIcon,
      draggable: true,
      autoPan: !isOverlay,
      zIndexOffset: 1000,
    }).addTo(mapInstance);

    positionMarker.on('drag', (e) => {
      this.#handleMapInteraction(fileIndex, e.target.getLatLng());
    });

    return { routeLayer: layerGroup, positionMarker };
  }

  loadOverlayMap() {
    if (!Preferences.prefs.loadMap) return;
    if (!this.#isReady) this.init();

    const containerId = 'overlay-map-container';
    const mapContainer = document.getElementById(containerId);
    if (!mapContainer) return;

    const mapInstance = L.map(containerId, { zoomControl: false });

    L.control.zoom({ position: 'topright' }).addTo(mapInstance);

    const isDark = Preferences.prefs.darkTheme;
    const tileUrl = isDark ? TILES_DARK : TILES_LIGHT;
    const tileLayer = L.tileLayer(tileUrl, {
      attribution: '© CartoDB',
    }).addTo(mapInstance);

    const allBounds = L.latLngBounds([]);
    let hasValidRoute = false;

    AppState.files.forEach((file, fileIndex) => {
      const processed = this.#processGpsData(file);
      if (!processed) return;

      const { routePoints, isHeatmap } = processed;
      hasValidRoute = true;

      const visuals = this.#addRouteVisuals(
        mapInstance,
        routePoints,
        fileIndex,
        { isOverlay: true, isHeatmap }
      );

      routePoints.forEach((p) => allBounds.extend([p.lat, p.lon]));

      this.#contexts.set(fileIndex, {
        map: mapInstance,
        tileLayer,
        routeLayer: visuals.routeLayer,
        positionMarker: visuals.positionMarker,
        latInterpolator: processed.latInterpolator,
        lonInterpolator: processed.lonInterpolator,
        infoControl: null,
      });
    });

    if (hasValidRoute) {
      mapInstance.fitBounds(allBounds, { padding: [20, 20] });
    }
  }

  loadRoute(fileIndex) {
    if (!Preferences.prefs.loadMap) return;
    if (!this.#isReady) this.init();

    const file = AppState.files[fileIndex];
    if (!file) return;

    const processed = this.#processGpsData(file);
    if (!processed) return;

    const {
      routePoints,
      latInterpolator,
      lonInterpolator,
      latData,
      isHeatmap,
      heatmapMeta,
    } = processed;

    const mapDivId = `embedded-map-${fileIndex}`;
    const mapContainer = document.getElementById(mapDivId);
    if (!mapContainer) return;

    mapContainer.classList.add('active');

    if (!this.#contexts.has(fileIndex)) {
      const mapInstance = L.map(mapDivId, { zoomControl: false }).setView(
        [0, 0],
        2
      );

      L.control.zoom({ position: 'topright' }).addTo(mapInstance);

      const isDark = Preferences.prefs.darkTheme;
      const tileUrl = isDark ? TILES_DARK : TILES_LIGHT;
      const tileLayer = L.tileLayer(tileUrl, {
        attribution: '© CartoDB',
      }).addTo(mapInstance);

      this.#contexts.set(fileIndex, {
        map: mapInstance,
        tileLayer: tileLayer,
        routeLayer: null,
        positionMarker: null,
        latInterpolator: null,
        lonInterpolator: null,
        infoControl: null,
      });
    }

    const ctx = this.#contexts.get(fileIndex);
    ctx.latInterpolator = latInterpolator;
    ctx.lonInterpolator = lonInterpolator;

    if (ctx.routeLayer) {
      ctx.routeLayer.clearLayers();
      ctx.routeLayer.remove();
    }
    if (ctx.positionMarker) ctx.map.removeLayer(ctx.positionMarker);

    const visuals = this.#addRouteVisuals(ctx.map, routePoints, fileIndex, {
      isOverlay: false,
      isHeatmap: isHeatmap,
    });

    ctx.routeLayer = visuals.routeLayer;
    ctx.positionMarker = visuals.positionMarker;

    const stats = this.#calculateStats(latData, ctx.lonInterpolator);
    this.#updateInfoControl(ctx, stats, heatmapMeta);

    requestAnimationFrame(() => {
      if (ctx.map) {
        ctx.map.invalidateSize();
        const latLngs = routePoints.map((p) => [p.lat, p.lon]);
        const bounds = L.latLngBounds(latLngs);
        if (bounds.isValid()) {
          ctx.map.fitBounds(bounds, { padding: [10, 10] });
        }
      }
    });
  }

  // --- Helpers ---

  #getValueColor(value, min, max) {
    if (isNaN(value)) return '#888';
    let ratio = (value - min) / (max - min);
    ratio = Math.max(0, Math.min(1, ratio));
    const hue = ((1 - ratio) * 120).toFixed(0);
    return `hsl(${hue}, 100%, 50%)`;
  }

  syncPosition(time) {
    if (!this.#isReady || this.#contexts.size === 0) return;

    this.#contexts.forEach((ctx) => {
      if (!ctx.latInterpolator || !ctx.lonInterpolator) return;

      const lat = ctx.latInterpolator.getValueAt(time);
      const lon = ctx.lonInterpolator.getValueAt(time);
      const nextLat = ctx.latInterpolator.getValueAt(time + 1000);
      const nextLon = ctx.lonInterpolator.getValueAt(time + 1000);

      if (this.#isValidGps(lat, lon)) {
        if (ctx.positionMarker) {
          ctx.positionMarker.setLatLng([lat, lon]);
        }
        if (this.#isValidGps(nextLat, nextLon)) {
          if (
            Math.abs(nextLat - lat) > 0.00005 ||
            Math.abs(nextLon - lon) > 0.00005
          ) {
            const angle = this.#calculateBearing(lat, lon, nextLat, nextLon);
            this.#rotateMarker(ctx.positionMarker, angle);
          }
        }
      }
    });
  }

  syncOverlayPosition(relativeTime) {
    const baseStart = AppState.files[0].startTime;
    this.#contexts.forEach((ctx, fileIdx) => {
      const file = AppState.files[fileIdx];
      if (!file) return;
      if (
        ctx.positionMarker?.dragging?.enabled() &&
        ctx.positionMarker
          .getElement()
          ?.classList.contains('leaflet-drag-target')
      )
        return;

      const absTime = relativeTime - baseStart + file.startTime;
      if (!ctx.latInterpolator || !ctx.lonInterpolator) return;

      const lat = ctx.latInterpolator.getValueAt(absTime);
      const lon = ctx.lonInterpolator.getValueAt(absTime);
      const nextLat = ctx.latInterpolator.getValueAt(absTime + 1000);
      const nextLon = ctx.lonInterpolator.getValueAt(absTime + 1000);

      if (this.#isValidGps(lat, lon)) {
        if (ctx.positionMarker) ctx.positionMarker.setLatLng([lat, lon]);
        if (this.#isValidGps(nextLat, nextLon)) {
          const angle = this.#calculateBearing(lat, lon, nextLat, nextLon);
          this.#rotateMarker(ctx.positionMarker, angle);
        }
      }
    });
  }

  syncMapBounds(start, end, fileIndex) {
    if (!this.#isReady || this.#contexts.size === 0) return;
    const bounds = L.latLngBounds([]);
    let hasPoints = false;
    const processFile = (idx, tStart, tEnd) => {
      const file = AppState.files[idx];
      const ctx = this.#contexts.get(idx);
      if (!file || !ctx || !ctx.latInterpolator || !ctx.lonInterpolator) return;
      const { latKey } = this.#detectGpsSignals(file);
      if (!latKey) return;
      const latData = file.signals[latKey];
      for (let i = 0; i < latData.length; i += 10) {
        const p = latData[i];
        if (p.x >= tStart && p.x <= tEnd) {
          const lat = parseFloat(p.y);
          const lon = parseFloat(ctx.lonInterpolator.getValueAt(p.x));
          if (this.#isValidGps(lat, lon)) {
            bounds.extend([lat, lon]);
            hasPoints = true;
          }
        }
      }
    };

    if (fileIndex !== null && fileIndex !== undefined) {
      processFile(fileIndex, start, end);
      const ctx = this.#contexts.get(fileIndex);
      if (hasPoints && ctx?.map)
        ctx.map.fitBounds(bounds, { padding: [20, 20], animate: true });
    } else {
      const baseStart = AppState.files[0].startTime;
      AppState.files.forEach((file, idx) => {
        processFile(
          idx,
          start - baseStart + file.startTime,
          end - baseStart + file.startTime
        );
      });
      const ctx = this.#contexts.get(0);
      if (hasPoints && ctx?.map)
        ctx.map.fitBounds(bounds, { padding: [20, 20], animate: true });
    }
  }

  clearAllMaps() {
    const uniqueMaps = new Set();
    this.#contexts.forEach((ctx) => {
      if (ctx.map) uniqueMaps.add(ctx.map);
    });
    uniqueMaps.forEach((mapInstance) => mapInstance.remove());
    this.#contexts.clear();
  }

  #handleMapInteraction(fileIndex, latlng) {
    const time = this.#findNearestTime(fileIndex, latlng);
    if (time !== null) messenger.emit(EVENTS.MAP_SELECTED, { time, fileIndex });
  }

  #findNearestTime(fileIndex, latlng) {
    const file = AppState.files[fileIndex];
    const latData = file.signals[this.#detectGpsSignals(file).latKey];
    if (!latData) return null;
    let minFormatDist = Infinity;
    let closestTime = null;
    latData.forEach((p) => {
      const lat = parseFloat(p.y);
      const lon = parseFloat(
        this.#contexts.get(fileIndex).lonInterpolator.getValueAt(p.x)
      );
      const d = Math.pow(lat - latlng.lat, 2) + Math.pow(lon - latlng.lng, 2);
      if (d < minFormatDist) {
        minFormatDist = d;
        closestTime = p.x;
      }
    });
    return closestTime;
  }

  #detectGpsSignals(file) {
    const signals = file.availableSignals || [];
    let latKey = signalRegistry.findSignal('Latitude', signals);
    let lonKey = signalRegistry.findSignal('Longitude', signals);
    return { latKey, lonKey };
  }

  #isValidGps(lat, lon) {
    return (
      lat != null &&
      lon != null &&
      !isNaN(lat) &&
      !isNaN(lon) &&
      Math.abs(lat) > 0.1 &&
      Math.abs(lon) > 0.1
    );
  }

  #calculateStats(latData, lonInterpolator) {
    if (!latData || latData.length < 2)
      return { dist: '0.00', avg: '0.0', max: '0.0' };
    let totalDistKm = 0;
    let maxSpeedKmh = 0;
    const validPoints = [];
    const timeMult =
      (parseFloat(latData[latData.length - 1].x) - parseFloat(latData[0].x)) /
        latData.length <
      10
        ? 1000
        : 1;

    for (let i = 0; i < latData.length; i++) {
      const p = latData[i];
      const lat = parseFloat(p.y);
      const lon = parseFloat(lonInterpolator.getValueAt(p.x));
      if (this.#isValidGps(lat, lon))
        validPoints.push({ x: p.x * timeMult, y: lat, lon });
    }
    if (validPoints.length < 2) return { dist: '0.00', avg: '0.0', max: '0.0' };

    let lastP = validPoints[0];
    for (let i = 1; i < validPoints.length; i++) {
      const p = validPoints[i];
      const dist = this.#getDistanceFromLatLonInKm(
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

  #updateInfoControl(ctx, stats, heatmapMeta = null) {
    if (!ctx.map) return;
    if (ctx.infoControl) ctx.map.removeControl(ctx.infoControl);

    const InfoControl = L.Control.extend({
      onAdd: function () {
        const div = L.DomUtil.create('div', 'info-legend');
        // REFACTORED CSS: Smaller box (180px), Bigger Font (12px), Tighter padding
        div.style.cssText =
          'background:rgba(0,0,0,0.85); color:#fff; padding:6px 8px; border-radius:4px; font-size: 12px; box-shadow: 0 0 10px rgba(0,0,0,0.5); min-width: 180px; font-family: monospace; z-index: 1000; line-height: 1.3;';

        let heatmapHtml = '';
        if (heatmapMeta) {
          heatmapHtml = `
            <div style="margin-bottom:6px; padding-bottom:6px; border-bottom:1px solid #555;">
                <div style="font-weight:bold; margin-bottom:2px; font-size:1.1em; color:#ddd; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${heatmapMeta.name}">${heatmapMeta.name}</div>
                
                <div style="height:10px; border-radius:3px; background: linear-gradient(to right, hsl(120,100%,40%), hsl(60,100%,50%), hsl(0,100%,50%)); margin-bottom: 2px; border: 1px solid #444;"></div>
                
                <div style="display:flex; justify-content:space-between; font-size:1.0em; font-weight:bold; color:#eee;">
                    <span>${heatmapMeta.min.toFixed(0)}</span>
                    <span>${heatmapMeta.max.toFixed(0)}</span>
                </div>
            </div>
            `;
        }

        div.innerHTML = `
           ${heatmapHtml}
           <div style="display:grid; grid-template-columns: auto 1fr; gap: 4px 10px; align-items: center;">
             <div style="color:#aaa;">Dist:</div> <div style="text-align:right;">${stats.dist} km</div>
             <div style="color:#aaa;">Avg:</div> <div style="text-align:right;">${stats.avg} <span style="font-size:0.9em; color:#888;">km/h</span></div>
             <div style="color:#aaa;">Max:</div> <div style="text-align:right;">${stats.max} <span style="font-size:0.9em; color:#888;">km/h</span></div>
           </div>
        `;
        return div;
      },
    });
    ctx.infoControl = new InfoControl({ position: 'bottomleft' });
    ctx.infoControl.addTo(ctx.map);
  }

  #getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = this.#deg2rad(lat2 - lat1);
    const dLon = this.#deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.#deg2rad(lat1)) *
        Math.cos(this.#deg2rad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  #deg2rad(deg) {
    return deg * (Math.PI / 180);
  }

  #rotateMarker(marker, angle) {
    if (!marker) return;
    const el = marker.getElement();
    if (el) {
      const svg = el.querySelector('svg');
      if (svg) svg.style.transform = `rotate(${angle}deg)`;
    }
  }

  #calculateBearing(startLat, startLng, destLat, destLng) {
    const startLatRad = this.#toRadians(startLat);
    const startLngRad = this.#toRadians(startLng);
    const destLatRad = this.#toRadians(destLat);
    const destLngRad = this.#toRadians(destLng);
    const y = Math.sin(destLngRad - startLngRad) * Math.cos(destLatRad);
    const x =
      Math.cos(startLatRad) * Math.sin(destLatRad) -
      Math.sin(startLatRad) *
        Math.cos(destLatRad) *
        Math.cos(destLngRad - startLngRad);
    return (this.#toDegrees(Math.atan2(y, x)) + 360) % 360;
  }

  #toRadians(deg) {
    return (deg * Math.PI) / 180;
  }
  #toDegrees(rad) {
    return (rad * 180) / Math.PI;
  }

  #getRouteColor(index) {
    const colors = ['#3388ff', '#ff3333', '#33ff33', '#ffa500'];
    return colors[index % colors.length];
  }

  #getMarkerColor(index) {
    const colors = ['#ff0000', '#0000ff', '#00aa00', '#aa00aa'];
    return colors[index % colors.length];
  }
}

export const mapManager = new MapManager();
