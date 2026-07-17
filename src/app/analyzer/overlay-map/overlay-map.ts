import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import L from 'leaflet';
import { AppStateService } from '../../core/app-state.service';
import { MapLinearInterpolator, MapService } from '../../core/map.service';
import { LoadedFile } from '../../core/models';
import { PreferencesService } from '../../core/preferences.service';

const TILES_DARK =
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

interface OverlayContext {
  latInterpolator: MapLinearInterpolator;
  lonInterpolator: MapLinearInterpolator;
  valInterpolator: MapLinearInterpolator | null;
  positionMarker: L.Marker;
}

/**
 * Port of legacy/src/mapmanager.js's `loadOverlayMap`: one merged map
 * showing every loaded file's route, all markers driven by the single
 * overlay chart's hover position (`MapService.overlayHover`). The
 * color-metric picker and the reverse chart-zoom-drives-map-bounds sync
 * apply uniformly across every file's route, matching legacy's single
 * global `#activeColorSignal`/`syncMapBounds(..., null)` behavior.
 */
@Component({
  selector: 'app-overlay-map',
  imports: [],
  templateUrl: './overlay-map.html',
  styleUrl: './overlay-map.css',
})
export class OverlayMap implements OnDestroy {
  protected readonly appState = inject(AppStateService);
  protected readonly preferences = inject(PreferencesService);
  private readonly mapService = inject(MapService);

  protected readonly mapContainer =
    viewChild<ElementRef<HTMLDivElement>>('mapContainer');

  protected readonly hasRoute = signal(false);

  /** Union of every loaded file's signals, minus whichever ones each file uses as GPS lat/lon. */
  protected readonly colorableSignals = computed<string[]>(() => {
    const files = this.appState.files();
    const excluded = new Set<string>();
    files.forEach((file) => {
      const { latKey, lonKey } = this.mapService.detectGpsSignals(file);
      if (latKey) excluded.add(latKey);
      if (lonKey) excluded.add(lonKey);
    });
    const names = new Set<string>();
    files.forEach((file) =>
      file.availableSignals.forEach((s) => {
        if (!excluded.has(s)) names.add(s);
      })
    );
    return [...names].sort();
  });

  private map: L.Map | null = null;
  private readonly contexts = new Map<number, OverlayContext>();

  constructor() {
    effect(() => {
      const enabled = this.preferences.loadMap();
      const files = this.appState.files();
      const container = this.mapContainer();
      const override = this.mapService.colorSignalOverrides()[0] ?? null;

      if (enabled && files.length > 0 && container) {
        this.loadOverlay(files, container.nativeElement, override);
      } else if (!enabled) {
        this.destroyMap();
      }
    });

    effect(() => {
      const time = this.mapService.overlayHover();
      if (time === null) return;
      this.syncAllMarkers(time);
    });

    effect(() => {
      const range = this.mapService.overlayZoomRange();
      if (!range) return;
      this.applyZoomRange(range.start, range.end);
    });
  }

  protected selectedColorSignal(): string {
    return this.mapService.colorSignalOverrides()[0] ?? '';
  }

  protected onColorSignalChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.mapService.setColorSignalOverride(0, value || null);
  }

  ngOnDestroy(): void {
    this.destroyMap();
  }

  private loadOverlay(
    files: LoadedFile[],
    containerEl: HTMLDivElement,
    colorSignalOverride: string | null
  ): void {
    if (!this.map) {
      this.map = L.map(containerEl, { zoomControl: false });
      L.control.zoom({ position: 'topright' }).addTo(this.map);
      L.tileLayer(TILES_DARK, { attribution: '© CartoDB' }).addTo(this.map);
    }
    const map = this.map;

    this.contexts.clear();
    map.eachLayer((layer) => {
      if (!(layer instanceof L.TileLayer)) map.removeLayer(layer);
    });

    const allBounds = L.latLngBounds([]);
    let hasValidRoute = false;

    files.forEach((file, fileIndex) => {
      const processed = this.mapService.processGpsData(
        file,
        colorSignalOverride
      );
      if (!processed) return;

      const {
        routePoints,
        isHeatmap,
        latInterpolator,
        lonInterpolator,
        valInterpolator,
      } = processed;
      hasValidRoute = true;

      const positionMarker = this.addRouteVisuals(
        map,
        routePoints,
        fileIndex,
        isHeatmap
      );
      routePoints.forEach((p) => allBounds.extend([p.lat, p.lon]));

      this.contexts.set(fileIndex, {
        latInterpolator,
        lonInterpolator,
        valInterpolator,
        positionMarker,
      });
    });

    this.hasRoute.set(hasValidRoute);
    if (hasValidRoute) {
      map.fitBounds(allBounds, { padding: [20, 20] });
    }
  }

  private addRouteVisuals(
    mapInstance: L.Map,
    routePoints: Array<{ lat: number; lon: number; color: string }>,
    fileIndex: number,
    isHeatmap: boolean
  ): L.Marker {
    const layerGroup = L.layerGroup().addTo(mapInstance);
    const latLngs: L.LatLngExpression[] = routePoints.map((p) => [
      p.lat,
      p.lon,
    ]);

    L.polyline(latLngs, {
      color: '#000000',
      weight: 6,
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
            weight: 4,
            opacity: 1.0,
            lineCap: 'butt',
            interactive: false,
          }
        ).addTo(layerGroup);
      }
    } else {
      L.polyline(latLngs, {
        color: this.mapService.getRouteColor(fileIndex),
        weight: 4,
        opacity: 1.0,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layerGroup);
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
                  fill="${this.mapService.getMarkerColor(fileIndex)}" stroke="white" stroke-width="2"/>
        </svg>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    return L.marker(startPoint, {
      icon: arrowIcon,
      draggable: false,
      autoPan: false,
      zIndexOffset: 1000,
    }).addTo(mapInstance);
  }

  private syncAllMarkers(relativeTime: number): void {
    const files = this.appState.files();
    if (files.length === 0) return;
    const baseStart = files[0].startTime;

    this.contexts.forEach((ctx, fileIdx) => {
      const file = files[fileIdx];
      if (!file) return;

      const absTime = relativeTime - baseStart + file.startTime;
      const lat = ctx.latInterpolator.getValueAt(absTime);
      const lon = ctx.lonInterpolator.getValueAt(absTime);
      if (lat === null || lon === null || !this.mapService.isValidGps(lat, lon))
        return;

      ctx.positionMarker.setLatLng([lat, lon]);

      const nextLat = ctx.latInterpolator.getValueAt(absTime + 1000);
      const nextLon = ctx.lonInterpolator.getValueAt(absTime + 1000);
      if (
        nextLat !== null &&
        nextLon !== null &&
        this.mapService.isValidGps(nextLat, nextLon)
      ) {
        const angle = this.mapService.calculateBearing(
          lat,
          lon,
          nextLat,
          nextLon
        );
        const el = ctx.positionMarker.getElement();
        const svg = el?.querySelector('svg');
        if (svg) (svg as SVGElement).style.transform = `rotate(${angle}deg)`;
      }
    });
  }

  /** Port of legacy/src/mapmanager.js's `syncMapBounds` for the overlay (fileIndex === null) case. */
  private applyZoomRange(startAbs: number, endAbs: number): void {
    const files = this.appState.files();
    if (!this.map || files.length === 0) return;
    const baseStart = files[0].startTime;

    const bounds = L.latLngBounds([]);
    let hasPoints = false;
    files.forEach((file) => {
      const points = this.mapService.getBoundsPointsInRange(
        file,
        startAbs - baseStart + file.startTime,
        endAbs - baseStart + file.startTime
      );
      points.forEach((p) => {
        bounds.extend(p);
        hasPoints = true;
      });
    });

    if (hasPoints && bounds.isValid())
      this.map.fitBounds(bounds, { padding: [20, 20], animate: true });
  }

  private destroyMap(): void {
    this.map?.remove();
    this.map = null;
    this.contexts.clear();
    this.hasRoute.set(false);
  }
}
