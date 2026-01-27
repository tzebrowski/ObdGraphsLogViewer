import { AppState, SIGNAL_MAPPINGS } from './config.js';
import { messenger } from './bus.js';

class LinearInterpolator {
  constructor(data) {
    this.data = data;
  }

  getValueAt(time) {
    if (!this.data || this.data.length === 0) return null;
    const idx = this.data.findIndex((p) => p.x >= time);
    if (idx <= 0) return this.data[0]?.y || 0;
    if (idx >= this.data.length) return this.data[this.data.length - 1].y;

    const p1 = this.data[idx - 1];
    const p2 = this.data[idx];
    const range = p2.x - p1.x;
    if (range === 0) return p1.y;

    const factor = (time - p1.x) / range;
    return p1.y + (p2.y - p1.y) * factor;
  }
}

class MapManager {
  #map = null;
  #routeLayer = null;
  #positionMarker = null;
  #latInterpolator = null;
  #lonInterpolator = null;
  #infoControl = null;
  #isReady = false;
  #loadedFileIndex = -1;

  constructor() {}

  // --- 1. Private Getter for Container ---
  get #container() {
    return document.getElementById('mapContainer');
  }

  init() {
    if (this.#isReady) return;

    // Use the getter
    const container = this.#container;
    if (!container) return;

    this.#map = L.map(container).setView([0, 0], 2);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(this.#map);

    this.#isReady = true;

    // Listen for file removal to clean up map
    messenger.on('file:removed', (data) => {
      if (this.#loadedFileIndex === data.index) {
        this.clearMap();
        this.#loadedFileIndex = -1;

        // Use the getter
        const mapDiv = this.#container;
        if (mapDiv) mapDiv.style.display = 'none';
      } else if (this.#loadedFileIndex > data.index) {
        this.#loadedFileIndex--;
      }
    });

    // Handle Project Reset (if implemented in ProjectManager)
    messenger.on('project:reset', () => {
      this.clearMap();
      this.#loadedFileIndex = -1;
      const mapDiv = this.#container;
      if (mapDiv) mapDiv.style.display = 'none';
    });
  }

  loadRoute(fileIndex) {
    // Use the getter
    const mapDiv = this.#container;
    if (mapDiv) {
      mapDiv.style.display = 'block';
      mapDiv.style.height = '350px';
      void mapDiv.offsetHeight; // Reflow hack
    }

    if (!this.#isReady) this.init();

    const file = AppState.files[fileIndex];
    if (!file) return;

    this.#loadedFileIndex = fileIndex;

    const { latKey, lonKey } = this.#detectGpsSignals(file);

    if (!latKey || !lonKey) {
      if (mapDiv) mapDiv.style.display = 'none';
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

    // Clear old layers before drawing new ones
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

    const mapInstance = this.#map;
    const layerInstance = this.#routeLayer;
    mapInstance.invalidateSize();

    requestAnimationFrame(() => {
      setTimeout(() => {
        if (mapInstance && layerInstance) {
          mapInstance.invalidateSize();
          const bounds = layerInstance.getBounds();
          if (bounds.isValid()) {
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
    if (!this.#isReady || !this.#latInterpolator || !this.#lonInterpolator)
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
    if (this.#infoControl) {
      this.#map.removeControl(this.#infoControl);
      this.#infoControl = null;
    }
    this.#latInterpolator = null;
    this.#lonInterpolator = null;
  }

  // --- Private Helper Methods ---

  #clearLayers() {
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
    const signals = file.availableSignals;

    const findMappedSignal = (mappingKey) => {
      const aliases = SIGNAL_MAPPINGS[mappingKey] || [];
      for (const alias of aliases) {
        const match = signals.find(
          (s) => s.toLowerCase() === alias.toLowerCase()
        );
        if (match) return match;
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

    if (!latKey) {
      latKey = signals.find((s) => /lat/i.test(s) && !/lateral/i.test(s));
    }
    if (!lonKey) {
      lonKey = signals.find((s) => /lon/i.test(s) || /lng/i.test(s));
    }

    return { latKey, lonKey };
  }

  #isValidGps(lat, lon) {
    return (
      lat != null && lon != null && Math.abs(lat) > 0.1 && Math.abs(lon) > 0.1
    );
  }

  #calculateStats(latData, lonInterpolator) {
    let totalDistKm = 0;
    let maxSpeedKmh = 0;

    const validPoints = [];
    for (let i = 0; i < latData.length; i++) {
      const p = latData[i];
      const lat = parseFloat(p.y);
      const lon = parseFloat(lonInterpolator.getValueAt(p.x));
      const time = parseFloat(p.x);

      if (this.#isValidGps(lat, lon) && !isNaN(time)) {
        validPoints.push({ x: time, y: lat, lon: lon });
      }
    }

    if (validPoints.length < 2) return { dist: '0.00', avg: '0.0', max: '0.0' };

    let lastP = validPoints[0];
    for (let i = 1; i < validPoints.length; i++) {
      const p = validPoints[i];
      const d = this.#getDistanceFromLatLonInKm(lastP.y, lastP.lon, p.y, p.lon);

      if (d > 0.002) {
        totalDistKm += d;
        lastP = p;
      }
    }

    const timeWindow = 1000;
    let rightIndex = 0;

    for (let i = 0; i < validPoints.length; i++) {
      const startP = validPoints[i];

      while (
        rightIndex < validPoints.length &&
        validPoints[rightIndex].x < startP.x + timeWindow
      ) {
        rightIndex++;
      }

      if (rightIndex >= validPoints.length) break;

      const endP = validPoints[rightIndex];

      const distSegment = this.#getDistanceFromLatLonInKm(
        startP.y,
        startP.lon,
        endP.y,
        endP.lon
      );
      const timeHours = (endP.x - startP.x) / 3600000;

      if (timeHours > 0) {
        const speed = distSegment / timeHours;
        if (speed > maxSpeedKmh && speed < 1000) {
          maxSpeedKmh = speed;
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

  #updateInfoControl(stats) {
    if (this.#infoControl) {
      this.#map.removeControl(this.#infoControl);
    }

    const InfoControl = L.Control.extend({
      onAdd: function () {
        const div = L.DomUtil.create('div', 'info-legend');
        div.style.backgroundColor = 'white';
        div.style.padding = '8px 12px';
        div.style.borderRadius = '5px';
        div.style.boxShadow = '0 0 10px rgba(0,0,0,0.2)';
        div.style.fontSize = '12px';
        div.style.lineHeight = '1.4';
        div.style.color = '#333';
        L.DomEvent.disableClickPropagation(div);

        div.innerHTML = `
                  <div style="font-weight:bold; margin-bottom:4px; color:#01804f; border-bottom:1px solid #eee;">GPS Stats</div>
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
      if (svg) {
        svg.style.transform = `rotate(${angle}deg)`;
      }
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
