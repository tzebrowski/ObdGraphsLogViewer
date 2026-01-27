import { AppState } from './config.js';

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
  #isReady = false;

  constructor() {}

  init() {
    if (this.#isReady) return;

    const container = document.getElementById('mapContainer');
    if (!container) return;

    this.#map = L.map('mapContainer').setView([0, 0], 2);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(this.#map);

    this.#isReady = true;
  }

  loadRoute(fileIndex) {
    const mapDiv = document.getElementById('mapContainer');
    if (mapDiv) {
      mapDiv.style.display = 'block';
      mapDiv.style.height = '350px';

      void mapDiv.offsetHeight;
    }

    if (!this.#isReady) this.init();

    const file = AppState.files[fileIndex];
    if (!file) return;

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
      const lat = p.y;
      const lon = this.#lonInterpolator.getValueAt(p.x);

      if (lat && lon && Math.abs(lat) > 0.1 && Math.abs(lon) > 0.1) {
        routePoints.push([lat, lon]);
      }
    }

    if (this.#routeLayer) this.#map.removeLayer(this.#routeLayer);
    if (this.#positionMarker) this.#map.removeLayer(this.#positionMarker);

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
      }, 300); // 300ms delay is imperceptible to user but eternity for browser layout
    });
  }

  syncPosition(time) {
    if (!this.#isReady || !this.#latInterpolator || !this.#lonInterpolator)
      return;

    const lat = this.#latInterpolator.getValueAt(time);
    const lon = this.#lonInterpolator.getValueAt(time);

    const nextLat = this.#latInterpolator.getValueAt(time + 1000);
    const nextLon = this.#lonInterpolator.getValueAt(time + 1000);

    if (
      lat != null &&
      lon != null &&
      Math.abs(lat) > 0.1 &&
      Math.abs(lon) > 0.1
    ) {
      if (this.#positionMarker) {
        this.#positionMarker.setLatLng([lat, lon]);
      }

      if (nextLat != null && nextLon != null) {
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

  #detectGpsSignals(file) {
    const signals = file.availableSignals;
    const latKey = signals.find(
      (s) => /GPS Latitude/i.test(s) && !/lateral/i.test(s)
    );
    const lonKey = signals.find(
      (s) => /GPS Longitude/i.test(s) || /lng/i.test(s)
    );
    return { latKey, lonKey };
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
