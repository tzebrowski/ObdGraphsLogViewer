import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import L from 'leaflet';
import { AppStateService } from '../../core/app-state.service';
import {
  GpsStats,
  HeatmapMeta,
  MapLinearInterpolator,
  MapService,
  RoutePoint,
} from '../../core/map.service';
import { LoadedFile } from '../../core/models';
import { PreferencesService } from '../../core/preferences.service';

const TILES_DARK =
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

/**
 * Port of legacy/src/mapmanager.js's per-file embedded map (`loadRoute`,
 * `#addRouteVisuals`, `#updateInfoControl`). Scope cuts vs. legacy: no
 * color-metric picker (auto-detects GPS/vehicle speed), always dark tiles
 * (no theme toggle yet — see Milestone 4 plan), and no reverse
 * chart-zoom-drives-map-bounds sync.
 */
@Component({
  selector: 'app-embedded-map',
  imports: [],
  templateUrl: './embedded-map.html',
  styleUrl: './embedded-map.css',
})
export class EmbeddedMap implements OnDestroy {
  readonly fileIndex = input.required<number>();

  protected readonly appState = inject(AppStateService);
  protected readonly preferences = inject(PreferencesService);
  private readonly mapService = inject(MapService);

  protected readonly mapContainer =
    viewChild<ElementRef<HTMLDivElement>>('mapContainer');

  protected readonly file = computed<LoadedFile | undefined>(
    () => this.appState.files()[this.fileIndex()]
  );

  protected readonly hasRoute = signal(false);

  private map: L.Map | null = null;
  private routeLayer: L.LayerGroup | null = null;
  private positionMarker: L.Marker | null = null;
  private infoControl: L.Control | null = null;
  private latInterpolator: MapLinearInterpolator | null = null;
  private lonInterpolator: MapLinearInterpolator | null = null;
  private valInterpolator: MapLinearInterpolator | null = null;

  constructor() {
    effect(() => {
      const enabled = this.preferences.loadMap();
      const file = this.file();
      const container = this.mapContainer();

      if (enabled && file && container) {
        this.loadRoute(file, container.nativeElement);
      } else if (!enabled) {
        this.destroyMap();
      }
    });

    effect(() => {
      const hover = this.mapService.stackHover();
      if (!hover || hover.fileIndex !== this.fileIndex()) return;
      this.syncMarkerPosition(hover.time);
    });
  }

  ngOnDestroy(): void {
    this.destroyMap();
  }

  private loadRoute(file: LoadedFile, containerEl: HTMLDivElement): void {
    const processed = this.mapService.processGpsData(file);
    if (!processed) {
      this.hasRoute.set(false);
      return;
    }
    this.hasRoute.set(true);

    const {
      routePoints,
      latInterpolator,
      lonInterpolator,
      valInterpolator,
      latData,
      isHeatmap,
      heatmapMeta,
    } = processed;

    if (!this.map) {
      this.map = L.map(containerEl, { zoomControl: false }).setView([0, 0], 2);
      L.control.zoom({ position: 'topright' }).addTo(this.map);
      L.tileLayer(TILES_DARK, { attribution: '© CartoDB' }).addTo(this.map);
    }

    this.latInterpolator = latInterpolator;
    this.lonInterpolator = lonInterpolator;
    this.valInterpolator = valInterpolator;

    if (this.routeLayer) {
      this.routeLayer.clearLayers();
      this.routeLayer.remove();
    }
    if (this.positionMarker) this.map.removeLayer(this.positionMarker);

    const visuals = this.addRouteVisuals(this.map, routePoints, isHeatmap);
    this.routeLayer = visuals.routeLayer;
    this.positionMarker = visuals.positionMarker;

    const stats = this.mapService.calculateStats(latData, lonInterpolator);
    this.updateInfoControl(stats, heatmapMeta);

    const map = this.map;
    requestAnimationFrame(() => {
      map.invalidateSize();
      const latLngs: L.LatLngExpression[] = routePoints.map((p) => [
        p.lat,
        p.lon,
      ]);
      const bounds = L.latLngBounds(latLngs);
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [10, 10] });
    });
  }

  private addRouteVisuals(
    mapInstance: L.Map,
    routePoints: RoutePoint[],
    isHeatmap: boolean
  ): { routeLayer: L.LayerGroup; positionMarker: L.Marker } {
    const layerGroup = L.layerGroup().addTo(mapInstance);
    const latLngs: L.LatLngExpression[] = routePoints.map((p) => [
      p.lat,
      p.lon,
    ]);

    L.polyline(latLngs, {
      color: '#000000',
      weight: 9,
      opacity: 0.6,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
    }).addTo(layerGroup);

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
            weight: 6,
            opacity: 1.0,
            lineCap: 'butt',
            interactive: false,
          }
        ).addTo(layerGroup);
      }
    } else {
      const line = L.polyline(latLngs, {
        color: this.mapService.getRouteColor(this.fileIndex()),
        weight: 6,
        opacity: 1.0,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layerGroup);

      line.on('click', (e) => this.handleMapInteraction(e.latlng));
    }

    const startPoint: L.LatLngExpression = [
      routePoints[0].lat,
      routePoints[0].lon,
    ];
    const arrowIcon = L.divIcon({
      className: 'gps-marker-icon',
      html: `
        <svg width="24" height="24" viewBox="0 0 24 24" style="transform-origin: center; display: block; filter: drop-shadow(0px 0px 3px rgba(0,0,0,0.5));">
            <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"
                  fill="${this.mapService.getMarkerColor(this.fileIndex())}" stroke="white" stroke-width="2"/>
        </svg>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    const positionMarker = L.marker(startPoint, {
      icon: arrowIcon,
      draggable: true,
      autoPan: true,
      zIndexOffset: 1000,
    }).addTo(mapInstance);

    positionMarker.on('drag', (e) =>
      this.handleMapInteraction((e.target as L.Marker).getLatLng())
    );

    return { routeLayer: layerGroup, positionMarker };
  }

  private updateInfoControl(
    stats: GpsStats,
    heatmapMeta: HeatmapMeta | null
  ): void {
    if (!this.map) return;
    if (this.infoControl) this.map.removeControl(this.infoControl);

    const legendId = `map-legend-val-${this.fileIndex()}`;
    const InfoControlClass = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div', 'info-legend');
        div.style.cssText =
          'background:rgba(0,0,0,0.85); color:#fff; padding:6px 8px; border-radius:4px; font-size: 12px; box-shadow: 0 0 10px rgba(0,0,0,0.5); min-width: 180px; font-family: monospace; z-index: 1000; line-height: 1.3; pointer-events: none;';

        let heatmapHtml = '';
        if (heatmapMeta) {
          heatmapHtml = `
            <div style="margin-bottom:6px; padding-bottom:6px; border-bottom:1px solid #555;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
                    <div style="font-weight:bold; font-size:1.1em; color:#ddd; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width: 120px;" title="${heatmapMeta.name}">${heatmapMeta.name}</div>
                    <div style="font-weight:bold; font-size:1.1em; color:#4f9;" id="${legendId}">--</div>
                </div>
                <div style="height:8px; border-radius:2px; background: linear-gradient(to right, hsl(120,100%,40%), hsl(60,100%,50%), hsl(0,100%,50%)); margin-bottom: 2px; border: 1px solid #444;"></div>
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
    this.infoControl = new InfoControlClass({ position: 'topleft' });
    this.infoControl.addTo(this.map);
  }

  private syncMarkerPosition(time: number): void {
    if (!this.latInterpolator || !this.lonInterpolator || !this.positionMarker)
      return;

    const lat = this.latInterpolator.getValueAt(time);
    const lon = this.lonInterpolator.getValueAt(time);
    if (lat === null || lon === null || !this.mapService.isValidGps(lat, lon))
      return;

    this.positionMarker.setLatLng([lat, lon]);

    if (this.valInterpolator) {
      const val = this.valInterpolator.getValueAt(time);
      if (val !== null) {
        const valEl = document.getElementById(
          `map-legend-val-${this.fileIndex()}`
        );
        if (valEl) valEl.innerText = val.toFixed(1);
      }
    }

    const nextLat = this.latInterpolator.getValueAt(time + 1000);
    const nextLon = this.lonInterpolator.getValueAt(time + 1000);
    if (
      nextLat !== null &&
      nextLon !== null &&
      this.mapService.isValidGps(nextLat, nextLon) &&
      (Math.abs(nextLat - lat) > 0.00005 || Math.abs(nextLon - lon) > 0.00005)
    ) {
      const angle = this.mapService.calculateBearing(
        lat,
        lon,
        nextLat,
        nextLon
      );
      this.rotateMarker(angle);
    }
  }

  private rotateMarker(angle: number): void {
    const el = this.positionMarker?.getElement();
    const svg = el?.querySelector('svg');
    if (svg) (svg as SVGElement).style.transform = `rotate(${angle}deg)`;
  }

  private handleMapInteraction(latlng: L.LatLng): void {
    const file = this.file();
    if (!file || !this.lonInterpolator) return;

    const time = this.mapService.findNearestTime(
      file,
      this.lonInterpolator,
      latlng
    );
    if (time === null) return;

    const centerSec = (time - file.startTime) / 1000;
    this.appState.setActiveHighlight(
      centerSec - 0.5,
      centerSec + 0.5,
      this.fileIndex()
    );
  }

  private destroyMap(): void {
    this.map?.remove();
    this.map = null;
    this.routeLayer = null;
    this.positionMarker = null;
    this.infoControl = null;
    this.latInterpolator = null;
    this.lonInterpolator = null;
    this.valInterpolator = null;
    this.hasRoute.set(false);
  }
}
