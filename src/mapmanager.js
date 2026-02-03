import L from 'leaflet';
import { AppState, SIGNAL_MAPPINGS } from './config.js';
import { messenger } from './bus.js';
import { Preferences } from './preferences.js';

const TILES_LIGHT = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILES_DARK =
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

export class LinearInterpolator {
  constructor(data) {
    this.data = data;
  }

  getValueAt(time) {
    if (!this.data || this.data.length === 0) return null;

    const t = parseFloat(time);

    if (t <= this.data[0].x) return parseFloat(this.data[0].y);
    if (t >= this.data[this.data.length - 1].x)
      return parseFloat(this.data[this.data.length - 1].y);

    const idx = this.data.findIndex((p) => p.x >= t);
    if (idx <= 0) return parseFloat(this.data[0].y);

    const p1 = this.data[idx - 1];
    const p2 = this.data[idx];

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

  constructor() {}

  reset() {
    this.clearAllMaps();
    this.#isReady = false;
  }

  init() {
    this.#isReady = true;

    messenger.on('file:removed', (data) => this.#handleFileRemoved(data));

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

  updateTheme(theme) {
    const newUrl = theme === 'dark' ? TILES_DARK : TILES_LIGHT;
    this.#contexts.forEach((ctx) => {
      if (ctx.tileLayer) {
        ctx.tileLayer.setUrl(newUrl);
      }
    });
  }

  #handleFileRemoved(data) {
    this.#removeMapContext(data.index);
  }

  #removeMapContext(fileIndex) {
    if (this.#contexts.has(fileIndex)) {
      const ctx = this.#contexts.get(fileIndex);

      if (ctx.map) {
        ctx.map.remove();
      }

      this.#contexts.delete(fileIndex);

      // Hide the embedded container
      const container = document.getElementById(`embedded-map-${fileIndex}`);
      if (container) {
        container.classList.remove('active');
        container.innerHTML = ''; // Clean up DOM
      }
    }
  }

  loadRoute(fileIndex) {
    if (!Preferences.prefs.loadMap) return;
    if (!this.#isReady) this.init();

    const file = AppState.files[fileIndex];
    if (!file) return;

    // Check availability of GPS data
    const { latKey, lonKey } = this.#detectGpsSignals(file);
    if (!latKey || !lonKey) return;

    // TARGET THE EMBEDDED DIV
    const mapDivId = `embedded-map-${fileIndex}`;
    const mapContainer = document.getElementById(mapDivId);

    if (!mapContainer) {
      // Container might not be rendered yet if charts are still initializing
      return;
    }

    // Show the container
    mapContainer.classList.add('active');

    // Create Map Context if it doesn't exist
    if (!this.#contexts.has(fileIndex)) {
      // Initialize Leaflet
      const mapInstance = L.map(mapDivId, { zoomControl: false }).setView(
        [0, 0],
        2
      );
      L.control.zoom({ position: 'topright' }).addTo(mapInstance);

      const isDark = Preferences.prefs.darkTheme;
      const tileUrl = isDark ? TILES_DARK : TILES_LIGHT;

      const tileLayer = L.tileLayer(tileUrl, {
        attribution: '© OpenStreetMap contributors',
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

    const latData = file.signals[latKey];
    const lonData = file.signals[lonKey];

    // Setup Interpolators
    ctx.latInterpolator = new LinearInterpolator(latData);
    ctx.lonInterpolator = new LinearInterpolator(lonData);

    const routePoints = [];
    const step = Math.max(1, Math.ceil(latData.length / 2000));

    for (let i = 0; i < latData.length; i += step) {
      const p = latData[i];
      const lat = parseFloat(p.y);
      const lon = parseFloat(ctx.lonInterpolator.getValueAt(p.x));

      if (this.#isValidGps(lat, lon)) {
        routePoints.push([lat, lon]);
      }
    }

    if (routePoints.length === 0) return;

    // Clear existing layers
    if (ctx.routeLayer) ctx.map.removeLayer(ctx.routeLayer);
    if (ctx.positionMarker) ctx.map.removeLayer(ctx.positionMarker);

    // Draw Route
    ctx.routeLayer = L.polyline(routePoints, {
      color: this.#getRouteColor(fileIndex),
      weight: 4,
      opacity: 0.8,
    }).addTo(ctx.map);

    // Create Marker
    const arrowIcon = L.divIcon({
      className: 'gps-marker-icon',
      html: `
        <svg width="24" height="24" viewBox="0 0 24 24" style="transform-origin: center; display: block;">
            <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" fill="${this.#getMarkerColor(fileIndex)}" stroke="white" stroke-width="2"/>
        </svg>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    ctx.positionMarker = L.marker(routePoints[0], {
      icon: arrowIcon,
      draggable: true,
    }).addTo(ctx.map);

    ctx.positionMarker.on('drag', (e) => {
      this.#handleMapInteraction(fileIndex, e.target.getLatLng());
    });

    ctx.routeLayer.on('click', (e) => {
      this.#handleMapInteraction(fileIndex, e.latlng);
    });

    // Update Stats
    const stats = this.#calculateStats(latData, ctx.lonInterpolator);
    this.#updateInfoControl(ctx, stats);

    // Fit bounds
    requestAnimationFrame(() => {
      if (ctx.map && ctx.routeLayer) {
        ctx.map.invalidateSize();
        const bounds = ctx.routeLayer.getBounds();
        if (bounds.isValid()) {
          ctx.map.fitBounds(bounds, { padding: [10, 10] });
        }
      }
    });
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

  clearAllMaps() {
    this.#contexts.forEach((_, key) => {
      this.#removeMapContext(key);
    });
    this.#contexts.clear();
  }

  // --- PRIVATE HELPER METHODS ---

  #handleMapInteraction(fileIndex, latlng) {
    const time = this.#findNearestTime(fileIndex, latlng);
    if (time !== null) {
      messenger.emit('map:position-selected', { time, fileIndex });
    }
  }

  #findNearestTime(fileIndex, latlng) {
    const file = AppState.files[fileIndex];
    const latData = file.signals[this.#detectGpsSignals(file).latKey];
    if (!latData) return null;

    let minFormatDist = Infinity;
    let closestTime = null;

    // We check the sampled points to find the closest geographic match
    latData.forEach((p) => {
      const lat = parseFloat(p.y);
      const lon = parseFloat(
        this.#contexts.get(fileIndex).lonInterpolator.getValueAt(p.x)
      );

      // Simple Pythagorean distance is usually enough for local coordinate clicks
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
    const findMappedSignal = (mappingKey) => {
      const aliases = SIGNAL_MAPPINGS[mappingKey] || [];
      for (const alias of aliases) {
        if (signals.some((s) => s.toLowerCase() === alias.toLowerCase()))
          return alias;
      }
      for (const alias of aliases) {
        const match = signals.find((s) =>
          s.toLowerCase().includes(alias.toLowerCase())
        );
        if (match) return match;
      }
      return null;
    };

    let latKey = findMappedSignal('Latitude');
    let lonKey = findMappedSignal('Longitude');

    if (!latKey)
      latKey = signals.find((s) => /lat/i.test(s) && !/lateral/i.test(s));
    if (!lonKey) lonKey = signals.find((s) => /lon/i.test(s) || /lng/i.test(s));

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

    const firstTime = parseFloat(latData[0].x);
    const lastTime = parseFloat(latData[latData.length - 1].x);
    const avgStep = (lastTime - firstTime) / latData.length;
    const isSeconds = avgStep < 10;
    const timeMult = isSeconds ? 1000 : 1;

    let totalDistKm = 0;
    let maxSpeedKmh = 0;
    const SMOOTHING_FACTOR = 0.5;
    let currentSmoothedSpeed = 0;
    const validPoints = [];

    for (let i = 0; i < latData.length; i++) {
      const p = latData[i];
      const lat = parseFloat(p.y);
      const rawTime = parseFloat(p.x);
      const lon = parseFloat(lonInterpolator.getValueAt(rawTime));

      if (this.#isValidGps(lat, lon) && !isNaN(rawTime)) {
        validPoints.push({ x: rawTime * timeMult, y: lat, lon: lon });
      }
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
        const instantSpeed = dist / timeDiffHours;
        if (instantSpeed < 300) {
          if (currentSmoothedSpeed === 0) currentSmoothedSpeed = instantSpeed;
          else {
            currentSmoothedSpeed =
              currentSmoothedSpeed * SMOOTHING_FACTOR +
              instantSpeed * (1 - SMOOTHING_FACTOR);
          }
          if (currentSmoothedSpeed > maxSpeedKmh) {
            maxSpeedKmh = currentSmoothedSpeed;
          }
        }
      }
    }

    const totalTimeHours =
      (validPoints[validPoints.length - 1].x - validPoints[0].x) / 3600000;
    const avgSpeedKmh =
      totalTimeHours > 0.001 ? totalDistKm / totalTimeHours : 0;

    return {
      dist: totalDistKm.toFixed(2),
      avg: avgSpeedKmh.toFixed(1),
      max: maxSpeedKmh.toFixed(1),
    };
  }

  #updateInfoControl(ctx, stats) {
    if (!ctx.map) return;
    if (ctx.infoControl) ctx.map.removeControl(ctx.infoControl);

    const InfoControl = L.Control.extend({
      onAdd: function () {
        const div = L.DomUtil.create('div', 'info-legend');
        div.style.cssText =
          'background:rgba(0,0,0,0.7); color:#fff; padding:8px 12px; border-radius:6px; font-size: 0.8em;';
        div.innerHTML = `
           <div style="font-weight:bold; border-bottom:1px solid #aaa; margin-bottom:4px;">Stats</div>
           <div><b>Dist:</b> ${stats.dist} km</div>
           <div><b>Avg:</b> ${stats.avg} km/h</div>
           <div><b>Max:</b> ${stats.max} km/h</div>
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
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  #deg2rad(deg) {
    return deg * (Math.PI / 180);
  }

  #rotateMarker(marker, angle) {
    if (!marker) return;
    const markerEl = marker.getElement();
    if (markerEl) {
      const svg = markerEl.querySelector('svg');
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

    let brng = Math.atan2(y, x);
    brng = this.#toDegrees(brng);
    return (brng + 360) % 360;
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
