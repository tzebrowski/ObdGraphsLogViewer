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

    // Safety: ensure time is number
    const t = parseFloat(time);

    // Boundary checks
    if (t <= this.data[0].x) return parseFloat(this.data[0].y);
    if (t >= this.data[this.data.length - 1].x)
      return parseFloat(this.data[this.data.length - 1].y);

    const idx = this.data.findIndex((p) => p.x >= t);
    if (idx <= 0) return parseFloat(this.data[0].y);

    const p1 = this.data[idx - 1];
    const p2 = this.data[idx];

    // Explicitly parse values to prevent string concatenation
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
  #map = null;
  #tileLayer = null;
  #routeLayer = null;
  #positionMarker = null;
  #latInterpolator = null;
  #lonInterpolator = null;
  #infoControl = null;
  #isReady = false;
  #loadedFileIndex = -1;

  constructor() {}

  get #container() {
    return document.getElementById('mapContainer');
  }

  // --- ADDED FOR TESTING ---
  reset() {
    this.clearMap();
    if (this.#map) {
      this.#map.remove();
      this.#map = null;
    }
    this.#isReady = false;
    this.#loadedFileIndex = -1;

    if (this.#container) {
      this.#container.style.display = 'none';
    }
  }
  // -------------------------

  init() {
    if (this.#isReady && this.#map) return;

    const container = this.#container;
    if (!container) {
      console.warn('MapManager: #mapContainer not found in DOM.');
      return;
    }

    container.className = 'chart-card-compact';
    container.style.display = 'none';
    container.style.flexDirection = 'column';

    // NOTE: Changed width: 100% to width: auto to allow CSS margins to work
    container.innerHTML = `
      <div class="chart-header-sm" style="display: flex; justify-content: space-between; align-items: center; padding: 4px 10px; background: #f8f9fa; border-bottom: 1px solid #ddd;">
          <div style="display: flex; flex-direction: column; min-width: 0;">
             <span class="chart-name" style="font-weight: bold; font-size: 0.85em; color: #333;">
                <i class="fas fa-map-marked-alt"></i> GPS Track
             </span>
          </div>
          <div class="chart-actions">
             <button class="btn-remove" id="btn-hide-map" title="Hide Map">×</button>
          </div>
      </div>
      <div class="canvas-wrapper" style="flex: 1; position: relative; padding: 0;">
          <div id="gps-map-view" style="width: auto; height: 100%;"></div>
      </div>
    `;

    const closeBtn = container.querySelector('#btn-hide-map');
    if (closeBtn) {
      closeBtn.onclick = () => {
        container.style.display = 'none';
      };
    }

    this.#map = L.map('gps-map-view', { zoomControl: false }).setView(
      [0, 0],
      2
    );

    L.control.zoom({ position: 'topleft' }).addTo(this.#map);

    const isDark = Preferences.prefs.darkTheme;
    const initialUrl = isDark ? TILES_DARK : TILES_LIGHT;

    this.#tileLayer = L.tileLayer(initialUrl, {
      attribution: '© OpenStreetMap contributors',
    }).addTo(this.#map);

    this.#isReady = true;

    messenger.on('file:removed', (data) => this.#handleFileRemoved(data));

    messenger.on('preferences:updated', (prefs) => {
      if (prefs.loadMap) {
        if (AppState.files.length > 0) {
          mapManager.loadRoute(0);
        }
      } else {
        mapManager.reset();
      }
    });
  }

  updateTheme(theme) {
    if (!this.#tileLayer) return;
    const newUrl = theme === 'dark' ? TILES_DARK : TILES_LIGHT;
    this.#tileLayer.setUrl(newUrl);
  }

  #handleFileRemoved(data) {
    if (this.#loadedFileIndex === data.index) {
      this.clearMap();
      this.#loadedFileIndex = -1;
      if (this.#container) this.#container.style.display = 'none';
    } else if (this.#loadedFileIndex > data.index) {
      this.#loadedFileIndex--;
    }
  }

  loadRoute(fileIndex) {
    if (!Preferences.prefs.loadMap) {
      if (this.#container) this.#container.style.display = 'none';
      return;
    }

    if (!this.#isReady) this.init();

    const mapWrapper = this.#container;
    if (!this.#map || !mapWrapper) return;

    mapWrapper.style.display = 'flex';
    mapWrapper.style.height = '350px';

    const file = AppState.files[fileIndex];
    if (!file) return;

    this.#loadedFileIndex = fileIndex;
    const { latKey, lonKey } = this.#detectGpsSignals(file);

    if (!latKey || !lonKey) {
      mapWrapper.style.display = 'none';
      return;
    }

    const latData = file.signals[latKey];
    const lonData = file.signals[lonKey];

    this.#latInterpolator = new LinearInterpolator(latData);
    this.#lonInterpolator = new LinearInterpolator(lonData);

    const routePoints = [];
    const step = Math.max(1, Math.ceil(latData.length / 2000));

    for (let i = 0; i < latData.length; i += step) {
      const p = latData[i];
      const lat = parseFloat(p.y);
      const lon = parseFloat(this.#lonInterpolator.getValueAt(p.x));

      if (this.#isValidGps(lat, lon)) {
        routePoints.push([lat, lon]);
      }
    }

    this.#clearLayers();

    if (routePoints.length === 0) return;

    this.#routeLayer = L.polyline(routePoints, {
      color: '#3388ff',
      weight: 4,
      opacity: 0.8,
    }).addTo(this.#map);

    const arrowIcon = L.divIcon({
      className: 'gps-marker-icon',
      html: `
        <svg width="24" height="24" viewBox="0 0 24 24" style="transform-origin: center; display: block;">
            <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" fill="#ff0000" stroke="white" stroke-width="2"/>
        </svg>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    this.#positionMarker = L.marker(routePoints[0], { icon: arrowIcon }).addTo(
      this.#map
    );

    const stats = this.#calculateStats(latData, this.#lonInterpolator);
    this.#updateInfoControl(stats);

    this.#fitBoundsSafely();
  }

  #fitBoundsSafely() {
    const mapInstance = this.#map;
    const layerInstance = this.#routeLayer;
    if (!mapInstance || !layerInstance) return;

    mapInstance.invalidateSize();
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (mapInstance && layerInstance) {
          mapInstance.invalidateSize();
          const bounds = layerInstance.getBounds();
          if (
            bounds &&
            typeof bounds.isValid === 'function' &&
            bounds.isValid()
          ) {
            mapInstance.fitBounds(bounds, {
              padding: [30, 30],
              maxZoom: 18,
              animate: false,
            });
          }
        }
      }, 300);
    });
  }

  syncPosition(time) {
    if (
      !this.#isReady ||
      !this.#map ||
      !this.#latInterpolator ||
      !this.#lonInterpolator
    )
      return;

    const lat = this.#latInterpolator.getValueAt(time);
    const lon = this.#lonInterpolator.getValueAt(time);
    const nextLat = this.#latInterpolator.getValueAt(time + 1000);
    const nextLon = this.#lonInterpolator.getValueAt(time + 1000);

    if (this.#isValidGps(lat, lon)) {
      if (this.#positionMarker) {
        this.#positionMarker.setLatLng([lat, lon]);
      }
      if (this.#isValidGps(nextLat, nextLon)) {
        if (
          Math.abs(nextLat - lat) > 0.00005 ||
          Math.abs(nextLon - lon) > 0.00005
        ) {
          const angle = this.#calculateBearing(lat, lon, nextLat, nextLon);
          this.#rotateMarker(angle);
        }
      }
    }
  }

  clearMap() {
    this.#clearLayers();
    if (this.#infoControl && this.#map) {
      this.#map.removeControl(this.#infoControl);
      this.#infoControl = null;
    }
    this.#latInterpolator = null;
    this.#lonInterpolator = null;
  }

  #clearLayers() {
    if (!this.#map) return;
    if (this.#routeLayer) {
      this.#map.removeLayer(this.#routeLayer);
      this.#routeLayer = null;
    }
    if (this.#positionMarker) {
      this.#map.removeLayer(this.#positionMarker);
      this.#positionMarker = null;
    }
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
    // Auto-detect unit: if average step is small (<10), it's likely Seconds -> convert to MS
    const avgStep = (lastTime - firstTime) / latData.length;
    const isSeconds = avgStep < 10;
    const timeMult = isSeconds ? 1000 : 1;

    let totalDistKm = 0;
    let maxSpeedKmh = 0;

    const SMOOTHING_FACTOR = 0.5;
    let currentSmoothedSpeed = 0;

    const validPoints = [];

    // --- 1. Normalize Data ---
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
        // Avoid divide by zero or tiny deltas
        const instantSpeed = dist / timeDiffHours;

        if (instantSpeed < 300) {
          // If it's the first point, initialize
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

    // Average Speed (Total Distance / Total Time)
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

  #updateInfoControl(stats) {
    if (!this.#map) return;
    if (this.#infoControl) this.#map.removeControl(this.#infoControl);

    const InfoControl = L.Control.extend({
      onAdd: function () {
        const div = L.DomUtil.create('div', 'info-legend');
        div.style.cssText =
          'background:rgba(0,0,0,0.7); color:#fff; padding:8px 12px; border-radius:6px;';
        div.innerHTML = `
           <div style="font-weight:bold; border-bottom:1px solid #aaa; margin-bottom:4px;">GPS Stats</div>
           <div><b>Dist:</b> ${stats.dist} km</div>
           <div><b>Avg:</b> ${stats.avg} km/h</div>
           <div><b>Max:</b> ${stats.max} km/h</div>
        `;
        return div;
      },
    });

    this.#infoControl = new InfoControl({ position: 'topright' });
    this.#infoControl.addTo(this.#map);
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

  #rotateMarker(angle) {
    if (!this.#positionMarker) return;
    const markerEl = this.#positionMarker.getElement();
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
}

export const mapManager = new MapManager();
