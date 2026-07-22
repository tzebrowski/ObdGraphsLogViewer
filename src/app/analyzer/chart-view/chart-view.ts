import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import {
  Chart,
  ChartDataset,
  ChartOptions,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  LogarithmicScale,
  Plugin,
  PointElement,
  TimeScale,
  Title,
  Tooltip,
  TooltipPositionerFunction,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import zoomPlugin from 'chartjs-plugin-zoom';
import Hammer from 'hammerjs';
import { AppStateService } from '../../core/app-state.service';
import { EventBusService } from '../../core/event-bus.service';
import { MapService } from '../../core/map.service';
import {
  ActiveHighlight,
  EVENTS,
  LoadedFile,
  SignalPoint,
  ViewMode,
} from '../../core/models';
import { PreferencesService } from '../../core/preferences.service';
import { SignalPaletteService } from '../../core/signal-palette.service';
import { EmbeddedMap } from '../embedded-map/embedded-map';
import { OverlayMap } from '../overlay-map/overlay-map';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  LogarithmicScale,
  TimeScale,
  Title,
  Tooltip,
  Legend,
  Filler,
  ChartDataLabels,
  zoomPlugin
);

declare module 'chart.js' {
  interface TooltipPositionerMap {
    topRightCorner: TooltipPositionerFunction<never>;
  }
}
Tooltip.positioners.topRightCorner = function (_elements, _eventPosition) {
  const chart = this.chart;
  if (!chart) return false as never;
  const { chartArea } = chart;
  return { x: chartArea.right - 10, y: chartArea.top };
};

(window as unknown as { Hammer: typeof Hammer }).Hammer = Hammer;

const DATALABELS_TIME_RANGE_MS = 5000;
const DATALABELS_MAX_VISIBLE_DATASETS = 5;
const TOOLTIP_MATCH_THRESHOLD_MS = 5000;

interface ChartDatasetExtra {
  originalMin: number;
  originalMax: number;
  _fileIdx: number;
  _signalKey: string;
}

type Point = { x: number; y: number };
type LineDataset = ChartDataset<'line', Point[]> & ChartDatasetExtra;

interface SliderRange {
  start: number;
  end: number;
}

interface MetaRow {
  label: string;
  value: string;
}

const SHORTCUTS_TEXT = `Keyboard Shortcuts:
← / → : Pan Left/Right (Shift for faster)
+ / - : Zoom In / Out
R : Reset View
A : Add point annotation at cursor
L : Toggle Legend Visibility
Alt + Click : Add / Delete Annotation`;

/**
 * Port of legacy/src/chartmanager.js's rendering core: stack and overlay
 * view modes, zoom/pan, tooltip with real-value transform, chart-hover-
 * drives-map-marker sync via MapService, point annotations (Alt+Click /
 * `A` keyboard shortcut), the per-card local range slider, keyboard
 * pan/zoom/reset/legend-toggle shortcuts, fine cursor stepping, visible-
 * range CSV export, file tagging (synced to Drive when the name matches a
 * loaded Drive entry), and the Log Details modal. Shift+Drag
 * highlight-with-stats regions remain out of scope.
 */
@Component({
  selector: 'app-chart-view',
  imports: [EmbeddedMap, OverlayMap],
  templateUrl: './chart-view.html',
  styleUrl: './chart-view.css',
})
export class ChartView {
  protected readonly appState = inject(AppStateService);
  private readonly palette = inject(SignalPaletteService);
  private readonly mapService = inject(MapService);
  private readonly preferences = inject(PreferencesService);
  private readonly bus = inject(EventBusService);

  protected readonly canvasRefs =
    viewChildren<ElementRef<HTMLCanvasElement>>('canvasEl');

  /** Keyed by chart index (fileIdx in stack mode, always 0 in overlay mode). */
  protected readonly sliderRanges = signal<Record<number, SliderRange>>({});

  protected readonly chartInfoIndex = signal<number | null>(null);
  /** Bundles the index with its file so the template's `@if...as` doesn't treat index 0 as falsy. */
  protected readonly chartInfo = computed(() => {
    const index = this.chartInfoIndex();
    if (index === null) return null;
    const file = this.appState.files()[index];
    return file ? { index, file } : null;
  });
  protected readonly shortcutsText = SHORTCUTS_TEXT;

  private charts: Chart[] = [];
  private readonly lastHoverTime = new Map<number, number>();
  /**
   * Angular's `@for` reuses canvas DOM nodes across rebuilds when a file's
   * `dbId` trackBy key is unchanged (e.g. an annotation add/delete mutates
   * `files()` but keeps the same files) — `chart.destroy()` only tears down
   * Chart.js's own listeners, so without this cleanup, re-running
   * `attachCanvasListeners` on a reused canvas would stack duplicate
   * click/keydown handlers on top of the old ones.
   */
  private readonly canvasListenerCleanup = new WeakMap<
    HTMLCanvasElement,
    () => void
  >();

  constructor() {
    effect(() => {
      const files = this.appState.files();
      const mode = this.appState.viewMode();
      const canvases = this.canvasRefs();
      this.preferences.darkTheme();
      this.preferences.showAreaFills();
      this.preferences.smoothLines();
      this.preferences.showLabels();

      const expectedCanvases =
        files.length === 0 ? 0 : mode === 'overlay' ? 1 : files.length;
      if (canvases.length !== expectedCanvases) return;

      this.rebuild(files, mode, canvases);
    });

    effect(() => {
      this.appState.hiddenSignalKeys();
      this.syncVisibility();
    });

    effect(() => {
      this.applyActiveHighlight(this.appState.activeHighlight());
    });

    this.bus.on(EVENTS.CHART_RESET_ALL).subscribe(() => this.resetAll());
  }

  /** Port of legacy/src/chartmanager.js's `reset()` — TopNav's global "Reset Zoom" button. */
  private resetAll(): void {
    this.charts.forEach((_, index) => this.resetChart(index));
  }

  protected trackByFile(index: number, file: LoadedFile): unknown {
    return file.dbId ?? file.name + index;
  }

  protected formatDuration(totalSeconds: number): string {
    if (typeof totalSeconds !== 'number' || isNaN(totalSeconds)) return '0s';
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }

  protected formatDate(startTime: number): string {
    const date = new Date(startTime);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  }

  protected removeFile(index: number): void {
    this.appState.removeFileAt(index);
  }

  protected resetChart(index: number): void {
    const chart = this.charts[index];
    const files = this.appState.files();
    const mode = this.appState.viewMode();
    const file = mode === 'overlay' ? files[0] : files[index];
    if (!chart || !file) return;

    // Port of legacy/src/chartmanager.js's resetChart: clears any active
    // anomaly-scanner highlight so it doesn't get redrawn at stale pixel
    // coordinates once the view has moved on.
    this.appState.clearActiveHighlight();

    const min = file.startTime;
    const max =
      file.startTime +
      (mode === 'overlay'
        ? Math.max(...files.map((f) => f.duration)) * 1000
        : file.duration * 1000);

    chart.options.scales!['x']!.min = min;
    chart.options.scales!['x']!.max = max;
    chart.resetZoom();
    chart.update('none');
    this.syncSliderFromChart(index);
    this.syncMapBounds(index, mode);
  }

  protected manualZoom(index: number, zoomLevel: number): void {
    this.charts[index]?.zoom(zoomLevel);
    this.syncSliderFromChart(index);
    this.syncMapBounds(index, this.appState.viewMode());
  }

  /**
   * Port of legacy/src/chartmanager.js's `stepCursor` — nudges the
   * last-known hover position and pans the view to keep it in frame once it
   * reaches an edge. `index` is a file index in stack mode; overlay mode's
   * template always passes 0 (its single merged chart).
   */
  protected stepCursor(index: number, stepCount: number): void {
    const mode = this.appState.viewMode();
    const chartIdx = mode === 'overlay' ? 0 : index;
    const chart = this.charts[chartIdx];
    const files = this.appState.files();
    const file = mode === 'overlay' ? files[0] : files[index];
    if (!chart || !file) return;

    const currentMin = chart.scales['x'].min as number;
    const currentMax = chart.scales['x'].max as number;
    let currentVal = this.lastHoverTime.get(chartIdx);
    if (currentVal === undefined) currentVal = (currentMin + currentMax) / 2;

    const STEP_SIZE_MS = 100;
    let newVal = currentVal + stepCount * STEP_SIZE_MS;

    if (mode === 'overlay') {
      const maxDuration = Math.max(...files.map((f) => f.duration));
      const baseStart = files[0].startTime;
      newVal = Math.max(
        baseStart,
        Math.min(newVal, baseStart + maxDuration * 1000)
      );
    } else {
      const maxTime = file.startTime + file.duration * 1000;
      newVal = Math.max(file.startTime, Math.min(newVal, maxTime));
    }

    this.lastHoverTime.set(chartIdx, newVal);

    const viewDuration = currentMax - currentMin;
    let viewChanged = false;
    if (newVal >= currentMax) {
      const newMin = newVal - viewDuration * 0.2;
      chart.options.scales!['x']!.min = newMin;
      chart.options.scales!['x']!.max = newMin + viewDuration;
      viewChanged = true;
    } else if (newVal <= currentMin) {
      const newMin = newVal - viewDuration * 0.8;
      chart.options.scales!['x']!.min = newMin;
      chart.options.scales!['x']!.max = newMin + viewDuration;
      viewChanged = true;
    }

    if (viewChanged) {
      chart.update('none');
      this.syncSliderFromChart(index);
      this.syncMapBounds(chartIdx, mode);
    }

    if (mode === 'overlay') {
      this.mapService.setOverlayHover(newVal);
    } else {
      this.mapService.setStackHover(index, newVal);
    }
  }

  /** Port of legacy/src/chartmanager.js's `exportDataRange` — CSV of the currently-visible time window, one column per visible signal. */
  protected exportDataRange(index: number): void {
    const chart = this.charts[index];
    const file = this.appState.files()[index];
    if (!chart || !file) return;

    const minTime = chart.scales['x'].min as number;
    const maxTime = chart.scales['x'].max as number;

    const visibleSignals = file.availableSignals.filter((sig) =>
      this.appState.isSignalVisible(index, sig)
    );
    if (visibleSignals.length === 0) {
      this.appState.showAlert('No signals visible to export.');
      return;
    }

    const timeSet = new Set<number>();
    const dataBySignal: Record<string, SignalPoint[]> = {};
    visibleSignals.forEach((sigKey) => {
      dataBySignal[sigKey] = file.signals[sigKey].filter(
        (p) => p.x >= minTime && p.x <= maxTime
      );
      dataBySignal[sigKey].forEach((p) => timeSet.add(p.x));
    });

    if (timeSet.size === 0) {
      this.appState.showAlert('No data in the selected time range.');
      return;
    }

    const sortedTimes = [...timeSet].sort((a, b) => a - b);
    const csvRows = [`Time (s),${visibleSignals.join(',')}`];
    const currentIndices: Record<string, number> = {};
    visibleSignals.forEach((sig) => (currentIndices[sig] = 0));

    sortedTimes.forEach((time) => {
      const relTime = (time - file.startTime) / 1000;
      const row = [relTime.toFixed(3)];

      visibleSignals.forEach((sigKey) => {
        const sigData = dataBySignal[sigKey];
        if (sigData.length === 0) {
          row.push('');
          return;
        }

        let idx = currentIndices[sigKey];
        while (idx < sigData.length - 1 && sigData[idx].x < time) idx++;
        currentIndices[sigKey] = idx;

        let value: number;
        if (sigData[idx].x === time) {
          value = sigData[idx].y;
        } else if (time <= sigData[0].x) {
          value = sigData[0].y;
        } else if (time >= sigData[sigData.length - 1].x) {
          value = sigData[sigData.length - 1].y;
        } else {
          const p0 = sigData[idx - 1];
          const p1 = sigData[idx];
          const timeRange = p1.x - p0.x;
          const fraction = timeRange === 0 ? 0 : (time - p0.x) / timeRange;
          value = p0.y + (p1.y - p0.y) * fraction;
        }
        row.push(value.toFixed(3));
      });

      csvRows.push(row.join(','));
    });

    const blob = new Blob([csvRows.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${file.name}_export_${Math.round(minTime)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /** Port of legacy/src/chartmanager.js's `_promptForTag`. */
  protected promptChartTag(index: number): void {
    const file = this.appState.files()[index];
    if (!file) return;

    const newTag = prompt(
      `Enter a new tag for ${file.name}\n(e.g., Track, Commute, Rain):`
    );
    if (!newTag || !newTag.trim()) return;

    const added = this.appState.addFileTag(index, newTag.trim().toLowerCase());
    if (!added) {
      this.appState.showAlert('This tag is already applied to this log.');
    }
  }

  /** Port of legacy/src/chartmanager.js's `_getTagStyle` — deterministic hue per tag name. */
  protected tagStyle(tag: string): string {
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
      hash = tag.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `background: hsla(${hue}, 70%, 50%, 0.15); color: var(--text-color); border: 1px solid hsla(${hue}, 70%, 50%, 0.3);`;
  }

  /** Port of legacy/src/chartmanager.js's `showChartInfo`. */
  protected showChartInfo(index: number): void {
    this.chartInfoIndex.set(index);
  }

  protected closeChartInfo(): void {
    this.chartInfoIndex.set(null);
  }

  protected collectionRate(index: number): string {
    const file = this.appState.files()[index];
    if (!file) return 'N/A';

    let totalRealSamples = 0;
    let realSignalCount = 0;
    Object.keys(file.signals).forEach((key) => {
      if (key.startsWith('Math:')) return;
      totalRealSamples += file.signals[key].length;
      realSignalCount++;
    });

    if (file.duration <= 0 || totalRealSamples === 0 || realSignalCount === 0)
      return 'N/A';
    const totalHz = totalRealSamples / file.duration;
    const perSignalHz = totalHz / realSignalCount;
    return `${totalHz.toFixed(1)} req/sec (~${perSignalHz.toFixed(1)} Hz per signal)`;
  }

  /** Port of legacy/src/chartmanager.js's `showChartInfo`'s dynamic-metadata section. */
  protected metadataRows(index: number): MetaRow[] {
    const file = this.appState.files()[index];
    if (!file?.metadata) return [];

    const ignoredKeys = new Set([
      'duration',
      'trip.duration',
      'starttime',
      'trip.starttime',
    ]);

    return Object.entries(file.metadata)
      .filter(([key]) => !ignoredKeys.has(key.toLowerCase()))
      .map(([key, value]) => ({
        label: key
          .replace('trip.', '')
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, (s) => s.toUpperCase()),
        value: this.formatMetaValue(key, value),
      }));
  }

  private formatMetaValue(key: string, value: unknown): string {
    if (value && typeof value === 'object') {
      const v = value as { min?: number; max?: number; unit?: string };
      if (v.min !== undefined && v.max !== undefined) {
        const unitStr = v.unit && v.unit !== 'Math' ? ` [${v.unit}]` : '';
        return `Min: ${v.min.toFixed(2)}, Max: ${v.max.toFixed(2)}${unitStr}`;
      }
      return JSON.stringify(value).replace(/["{}]/g, '').replace(/:/g, ': ');
    }
    const numeric = Number(value);
    if (
      key.toLowerCase().includes('time') &&
      !isNaN(numeric) &&
      numeric > 1_000_000_000
    ) {
      return new Date(numeric).toLocaleString();
    }
    return value === undefined || value === null ? 'N/A' : String(value);
  }

  /** Current [start, end] in seconds-from-file-start for the local range slider, defaulting to the full duration. */
  protected sliderRange(index: number, file: LoadedFile): SliderRange {
    return this.sliderRanges()[index] ?? { start: 0, end: file.duration };
  }

  protected onSliderInput(
    index: number,
    file: LoadedFile,
    which: 'start' | 'end',
    event: Event
  ): void {
    const value = parseFloat((event.target as HTMLInputElement).value);
    const current = this.sliderRange(index, file);
    let start = which === 'start' ? value : current.start;
    let end = which === 'end' ? value : current.end;
    if (start > end) [start, end] = [end, start];

    const chart = this.charts[index];
    if (!chart) return;
    chart.options.scales!['x']!.min = file.startTime + start * 1000;
    chart.options.scales!['x']!.max = file.startTime + end * 1000;
    chart.update('none');
    this.setSliderRange(index, start, end);
  }

  private setSliderRange(index: number, start: number, end: number): void {
    this.sliderRanges.update((ranges) => ({
      ...ranges,
      [index]: { start, end },
    }));
  }

  /** Port of legacy/src/chartmanager.js's `mapManager.syncMapBounds(...)` calls on zoom/pan/reset. */
  private syncMapBounds(index: number, mode: ViewMode): void {
    const chart = this.charts[index];
    if (!chart) return;
    const min = chart.scales['x'].min as number;
    const max = chart.scales['x'].max as number;
    if (mode === 'overlay') {
      this.mapService.setOverlayZoomRange(min, max);
    } else {
      this.mapService.setStackZoomRange(index, min, max);
    }
  }

  /** Recomputes the slider thumbs from the chart's current zoom/pan window. No-op in overlay mode, matching legacy. */
  private syncSliderFromChart(index: number): void {
    if (this.appState.viewMode() === 'overlay') return;
    const chart = this.charts[index];
    const file = this.appState.files()[index];
    if (!chart || !file) return;

    const start = Math.max(
      0,
      ((chart.scales['x'].min as number) - file.startTime) / 1000
    );
    const end = Math.min(
      file.duration,
      ((chart.scales['x'].max as number) - file.startTime) / 1000
    );
    this.setSliderRange(index, start, end);
  }

  /**
   * Pans/zooms the target file's chart to a result range (e.g. from the
   * anomaly scanner), matching legacy/src/chartmanager.js's `zoomTo`. Only
   * takes effect in stack mode — like legacy, overlay mode has a single
   * merged chart instance so per-file indices beyond 0 don't resolve.
   */
  private applyActiveHighlight(highlight: ActiveHighlight | null): void {
    // Redraw every other stack chart too: whichever one previously held the
    // highlight rectangle needs a repaint to erase it now that
    // buildAnnotationPlugin's targetIndex check no longer matches.
    this.charts.forEach((chart, idx) => {
      if (idx !== highlight?.targetIndex) chart.draw();
    });

    if (!highlight || highlight.targetIndex === null) return;
    const chart = this.charts[highlight.targetIndex];
    const file = this.appState.files()[highlight.targetIndex];
    if (!chart || !file) return;

    const duration = highlight.end - highlight.start;
    const padding = duration * 4.0;
    chart.options.scales!['x']!.min =
      file.startTime + Math.max(0, highlight.start - padding) * 1000;
    chart.options.scales!['x']!.max =
      file.startTime + Math.min(file.duration, highlight.end + padding) * 1000;
    chart.update('none');
  }

  private rebuild(
    files: LoadedFile[],
    mode: ViewMode,
    canvases: readonly ElementRef<HTMLCanvasElement>[]
  ): void {
    this.charts.forEach((chart) => chart.destroy());
    this.charts = [];
    this.lastHoverTime.clear();
    this.sliderRanges.set({});

    if (files.length === 0) return;

    if (mode === 'overlay') {
      this.charts.push(
        this.buildOverlayChart(files, canvases[0].nativeElement)
      );
    } else {
      files.forEach((file, idx) => {
        this.charts.push(
          this.buildStackChart(file, idx, canvases[idx].nativeElement)
        );
        this.setSliderRange(idx, 0, file.duration);
      });
    }
  }

  private buildStackChart(
    file: LoadedFile,
    fileIdx: number,
    canvas: HTMLCanvasElement
  ): Chart {
    const ctx = canvas.getContext('2d')!;
    const datasets = file.availableSignals.map((key, sigIdx) =>
      this.buildDataset(file, key, fileIdx, sigIdx, key)
    );

    this.attachCanvasListeners(canvas, fileIdx, 'stack');

    return new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: this.getChartOptions(
        file,
        file.startTime,
        file.startTime + file.duration * 1000,
        'stack',
        fileIdx
      ),
      plugins: [
        this.buildAnnotationPlugin(
          () => this.appState.files()[fileIdx],
          fileIdx,
          fileIdx
        ),
      ],
    });
  }

  private buildOverlayChart(
    files: LoadedFile[],
    canvas: HTMLCanvasElement
  ): Chart {
    const ctx = canvas.getContext('2d')!;
    this.attachCanvasListeners(canvas, 0, 'overlay');
    const baseStartTime = files[0].startTime;
    const maxDuration = Math.max(...files.map((f) => f.duration));

    const datasets = files.flatMap((file, fileIdx) =>
      file.availableSignals.map((key, sigIdx) => {
        const label = `${file.name.substring(0, 15)}... - ${key}`;
        const ds = this.buildDataset(file, key, fileIdx, sigIdx, label);
        const fileStart = file.startTime;
        ds.data = ds.data.map((p) => ({
          x: baseStartTime + (p as Point).x - fileStart,
          y: (p as Point).y,
        }));
        if (fileIdx > 0) {
          ds.borderDash = [5, 5];
          ds.pointRadius = 0;
        }
        return ds;
      })
    );

    return new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: this.getChartOptions(
        files[0],
        baseStartTime,
        baseStartTime + maxDuration * 1000,
        'overlay',
        0
      ),
      plugins: [
        this.buildAnnotationPlugin(() => this.appState.files()[0], null, 0),
      ],
    });
  }

  private attachCanvasListeners(
    canvas: HTMLCanvasElement,
    fileIdx: number,
    mode: ViewMode
  ): void {
    this.canvasListenerCleanup.get(canvas)?.();

    const onMouseLeave = () => this.mapService.clearHover();
    const onClick = (event: MouseEvent) =>
      this.handleAltClick(fileIdx, mode, event, canvas);
    const onKeydown = (event: KeyboardEvent) =>
      this.handleKeydown(event, fileIdx, mode);

    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('keydown', onKeydown);

    this.canvasListenerCleanup.set(canvas, () => {
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('keydown', onKeydown);
    });
  }

  /**
   * Port of legacy/src/chartmanager.js's `highlighterPlugin`: the
   * anomaly-scanner's active-highlight rectangle (stack mode only, matching
   * `applyActiveHighlight`'s scope), point annotations, and the dashed
   * vertical hover-cursor line. `highlightFileIdx` is `null` for the overlay
   * chart, which has no single corresponding file index to compare against
   * `activeHighlight.targetIndex`. `hoverKey` is this chart's key into
   * `lastHoverTime` (fileIdx in stack mode, always 0 in overlay mode).
   */
  private buildAnnotationPlugin(
    getFile: () => LoadedFile | undefined,
    highlightFileIdx: number | null,
    hoverKey: number
  ): Plugin<'line'> {
    return {
      id: 'chartOverlays',
      afterDraw: (chart) => {
        const file = getFile();
        if (!file) return;
        const {
          ctx,
          chartArea: { top, bottom, left, right },
          scales: { x },
        } = chart;
        const xMin = x.min as number;
        const xMax = x.max as number;

        const highlight = this.appState.activeHighlight();
        if (highlight && highlightFileIdx === highlight.targetIndex) {
          const pxStart = x.getPixelForValue(
            file.startTime + highlight.start * 1000
          );
          const pxEnd = x.getPixelForValue(
            file.startTime + highlight.end * 1000
          );
          if (!isNaN(pxStart) && !isNaN(pxEnd)) {
            ctx.save();
            ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
            ctx.fillRect(pxStart, top, pxEnd - pxStart, bottom - top);
            ctx.restore();
          }
        }

        if (file.annotations?.length) {
          ctx.save();
          ctx.font = '11px Arial';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          file.annotations.forEach((note) => {
            const absTime = file.startTime + note.time * 1000;
            if (absTime < xMin || absTime > xMax) return;

            const xPix = x.getPixelForValue(absTime);
            ctx.beginPath();
            ctx.strokeStyle = '#FFA500';
            ctx.lineWidth = 2;
            ctx.moveTo(xPix, top);
            ctx.lineTo(xPix, bottom);
            ctx.stroke();

            const textWidth = ctx.measureText(note.text).width;
            ctx.fillStyle = 'rgba(255, 165, 0, 0.8)';
            ctx.fillRect(xPix + 2, top + 5, textWidth + 6, 20);
            ctx.fillStyle = 'white';
            ctx.fillText(note.text, xPix + 5, top + 19);
          });
          ctx.restore();
        }

        const hoverTime = this.lastHoverTime.get(hoverKey);
        if (hoverTime === undefined) return;
        const xPixel = x.getPixelForValue(hoverTime);
        if (xPixel < left || xPixel > right) return;

        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(227, 24, 55, 0.85)';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.moveTo(xPixel, top);
        ctx.lineTo(xPixel, bottom);
        ctx.stroke();
        ctx.restore();
      },
    };
  }

  /**
   * Alt+Click adds a point annotation at the clicked time, or deletes one
   * within a small pixel radius of an existing annotation — matches
   * legacy/src/chartmanager.js's Alt+Click handler.
   */
  private handleAltClick(
    fileIdx: number,
    mode: ViewMode,
    event: MouseEvent,
    canvas: HTMLCanvasElement
  ): void {
    if (!event.altKey) return;
    const chartIdx = mode === 'overlay' ? 0 : fileIdx;
    const chart = this.charts[chartIdx];
    const file =
      mode === 'overlay'
        ? this.appState.files()[0]
        : this.appState.files()[fileIdx];
    if (!chart || !file) return;

    const rect = canvas.getBoundingClientRect();
    const clickPixel = event.clientX - rect.left;
    const xValue = chart.scales['x'].getValueForPixel(clickPixel);
    if (xValue === undefined) return;

    const annotations = file.annotations ?? [];
    const nearbyIndex = annotations.findIndex((note) => {
      const notePixel = chart.scales['x'].getPixelForValue(
        file.startTime + note.time * 1000
      );
      return Math.abs(notePixel - clickPixel) < 8;
    });

    if (nearbyIndex !== -1) {
      if (confirm('Delete this point annotation?')) {
        this.appState.removeAnnotationAt(
          mode === 'overlay' ? 0 : fileIdx,
          nearbyIndex
        );
      }
      return;
    }

    const relTime = (xValue - file.startTime) / 1000;
    const text = prompt(
      `Add point annotation (Alt+Click) at ${relTime.toFixed(2)}s:`,
      ''
    );
    if (text && text.trim()) {
      this.appState.addAnnotation(mode === 'overlay' ? 0 : fileIdx, {
        time: relTime,
        text: text.trim(),
      });
    }
  }

  /**
   * Port of legacy/src/chartmanager.js's `initKeyboardControls`. Tag (`T`)
   * and CSV export (`E`) shortcuts are dropped along with those features.
   */
  private handleKeydown(
    event: KeyboardEvent,
    fileIdx: number,
    mode: ViewMode
  ): void {
    const chartIdx = mode === 'overlay' ? 0 : fileIdx;
    const chart = this.charts[chartIdx];
    if (!chart) return;
    const amount = event.shiftKey ? 0.05 : 0.01;

    switch (event.key) {
      case 'ArrowLeft':
        chart.pan({ x: chart.width * amount }, undefined, 'none');
        break;
      case 'ArrowRight':
        chart.pan({ x: -chart.width * amount }, undefined, 'none');
        break;
      case '+':
      case '=':
        chart.zoom(1.1);
        break;
      case '-':
      case '_':
        chart.zoom(0.9);
        break;
      case 'a':
      case 'A':
        this.addAnnotationAtHover(chartIdx, fileIdx, mode);
        return;
      case 'l':
      case 'L':
        this.toggleLegend(chartIdx);
        return;
      case 'r':
      case 'R':
        this.resetChart(fileIdx);
        return;
      default:
        return;
    }

    chart.update('none');
    this.syncSliderFromChart(fileIdx);
    this.syncMapBounds(chartIdx, mode);
  }

  private addAnnotationAtHover(
    chartIdx: number,
    fileIdx: number,
    mode: ViewMode
  ): void {
    const hoverTime = this.lastHoverTime.get(chartIdx);
    if (hoverTime === undefined) {
      alert('Hover over the chart to add an annotation.');
      return;
    }
    const file =
      mode === 'overlay'
        ? this.appState.files()[0]
        : this.appState.files()[fileIdx];
    if (!file) return;

    const relTime = (hoverTime - file.startTime) / 1000;
    const text = prompt(`Add annotation at ${relTime.toFixed(2)}s:`, '');
    if (text && text.trim()) {
      this.appState.addAnnotation(mode === 'overlay' ? 0 : fileIdx, {
        time: relTime,
        text: text.trim(),
      });
    }
  }

  private toggleLegend(chartIdx: number): void {
    const chart = this.charts[chartIdx];
    const legend = chart?.options.plugins?.legend;
    if (!legend) return;
    legend.display = !legend.display;
    chart.update();
  }

  private buildDataset(
    file: LoadedFile,
    key: string,
    fileIdx: number,
    sigIdx: number,
    label: string
  ): LineDataset {
    const rawData = file.signals[key];
    const yValues = rawData.map((d) => parseFloat(String(d.y)) || 0);
    const min = Math.min(...yValues);
    const max = Math.max(...yValues);
    const range = max - min;

    const normalizedData = rawData.map((d) => ({
      x: d.x,
      y:
        range === 0
          ? max > 0
            ? 0.8
            : 0
          : (parseFloat(String(d.y)) - min) / range,
    }));

    const color = this.palette.getColorForSignal(fileIdx, sigIdx);
    const isVisible = this.appState.isSignalVisible(fileIdx, key);
    const showAreaFills = this.preferences.showAreaFills();
    const smoothLines = this.preferences.smoothLines();

    return {
      label,
      originalMin: min,
      originalMax: max,
      _fileIdx: fileIdx,
      _signalKey: key,
      data: normalizedData,
      borderColor: color,
      borderWidth: isVisible ? 3 : 1.5,
      pointRadius: 0,
      tension: smoothLines ? 0.4 : 0,
      cubicInterpolationMode: smoothLines ? 'monotone' : 'default',
      backgroundColor: showAreaFills
        ? this.getAlphaColor(color, 0.1)
        : 'transparent',
      fill: showAreaFills ? 'origin' : false,
      hidden: !isVisible,
    };
  }

  private getChartOptions(
    file: LoadedFile,
    xMin: number,
    xMax: number,
    mode: ViewMode,
    hoverFileIdx: number
  ): ChartOptions<'line'> {
    const appState = this.appState;
    const mapService = this.mapService;
    const isDark = this.preferences.darkTheme();
    const textColor = isDark ? '#F8F9FA' : '#333333';
    const gridColor = isDark
      ? 'rgba(255, 255, 255, 0.1)'
      : 'rgba(0, 0, 0, 0.1)';
    const options: ChartOptions<'line'> = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      // Omits 'mouseout': legacy/src/chartmanager.js disables Chart.js's own
      // event handling entirely (events: []) and drives the tooltip itself
      // via chart.tooltip.setActiveElements, so it (like the hover-cursor
      // line) never auto-clears when the pointer leaves the canvas. Chart.js
      // otherwise hides the tooltip on its default 'mouseout' handling.
      events: ['mousemove', 'click', 'touchstart', 'touchmove'],
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      onHover: (event, _elements, chart) => {
        if (event.x === null || event.x === undefined) return;
        const timeValue = chart.scales['x'].getValueForPixel(event.x);
        if (timeValue === undefined) return;
        this.lastHoverTime.set(
          mode === 'overlay' ? 0 : hoverFileIdx,
          timeValue
        );
        if (mode === 'overlay') {
          mapService.setOverlayHover(timeValue);
        } else {
          mapService.setStackHover(hoverFileIdx, timeValue);
        }
        this.syncTooltipActiveElements(chart, timeValue);
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 1.2,
          ticks: { display: false },
          grid: { color: gridColor },
        },
        x: {
          type: 'linear' as const,
          min: xMin,
          max: xMax,
          title: {
            display: true,
            text: 'Trip Duration (mm:ss)',
            color: textColor,
          },
          ticks: {
            color: textColor,
            callback: (value) => {
              const date = new Date(value as number);
              const mm = (date.getMonth() + 1).toString().padStart(2, '0');
              const dd = date.getDate().toString().padStart(2, '0');
              const hh = date.getHours().toString().padStart(2, '0');
              const min = date.getMinutes().toString().padStart(2, '0');
              const ss = date.getSeconds().toString().padStart(2, '0');
              return `${mm}-${dd} ${hh}:${min}:${ss}`;
            },
          },
          grid: { color: gridColor },
        },
      },
      plugins: {
        datalabels: {
          display: (ctx) => this.shouldShowLabels(ctx.chart),
          anchor: 'end',
          align: 'top',
          backgroundColor: (ctx) => ctx.dataset.borderColor as string,
          color: 'white',
          formatter: (value: { y: number }, context) => {
            const ds = context.dataset as unknown as ChartDatasetExtra;
            const realY =
              value.y * (ds.originalMax - ds.originalMin) + ds.originalMin;
            return realY.toFixed(1);
          },
        },
        tooltip: {
          enabled: true,
          mode: 'index',
          position: 'topRightCorner',
          yAlign: 'top',
          xAlign: 'right',
          caretSize: 0,
          intersect: false,
          itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
          callbacks: {
            title: (items) => {
              if (!items.length) return '';
              const xVal = items[0].parsed.x ?? 0;
              if (mode === 'overlay') {
                const seconds = (xVal - file.startTime) / 1000;
                return `T + ${Math.max(0, seconds).toFixed(2)}s`;
              }
              const date = new Date(xVal);
              const mm = (date.getMonth() + 1).toString().padStart(2, '0');
              const dd = date.getDate().toString().padStart(2, '0');
              const hh = date.getHours().toString().padStart(2, '0');
              const min = date.getMinutes().toString().padStart(2, '0');
              const ss = date.getSeconds().toString().padStart(2, '0');
              const ms = date.getMilliseconds().toString().padStart(3, '0');
              return `${mm}-${dd} ${hh}:${min}:${ss}.${ms}`;
            },
            label: (context) => {
              const ds = context.dataset as unknown as ChartDatasetExtra;
              const realY =
                (context.parsed.y ?? 0) * (ds.originalMax - ds.originalMin) +
                ds.originalMin;
              const label = context.dataset.label ?? '';
              return (label ? label + ': ' : '') + realY.toFixed(2);
            },
          },
        },
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            font: { size: 11 },
            color: textColor,
            filter: (item, chartData) => {
              const ds = chartData.datasets[
                item.datasetIndex!
              ] as unknown as ChartDatasetExtra;
              return appState.isSignalVisible(ds._fileIdx, ds._signalKey);
            },
          },
        },
        zoom: {
          pan: {
            enabled: true,
            mode: 'x',
            onPanComplete: () => {
              this.syncSliderFromChart(hoverFileIdx);
              this.syncMapBounds(hoverFileIdx, mode);
            },
          },
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: 'x',
            onZoomComplete: () => {
              this.syncSliderFromChart(hoverFileIdx);
              this.syncMapBounds(hoverFileIdx, mode);
            },
          },
        },
      },
    };
    return options;
  }

  private shouldShowLabels(chart: Chart): boolean {
    if (!this.preferences.showLabels()) return false;

    const xRange =
      (chart.scales['x'].max as number) - (chart.scales['x'].min as number);
    return (
      xRange < DATALABELS_TIME_RANGE_MS &&
      chart.data.datasets.filter((ds) => !ds.hidden).length <=
        DATALABELS_MAX_VISIBLE_DATASETS
    );
  }

  /** Port of legacy/src/chartmanager.js's `getAlphaColor`. */
  private getAlphaColor(hex: string, alpha = 0.1): string {
    if (!hex || typeof hex !== 'string') return `rgba(128,128,128, ${alpha})`;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * Port of legacy/src/chartmanager.js's `_syncTooltip`. Chart.js's own
   * `interaction: { mode: 'nearest' }` picks a single shared data-array
   * index across all datasets, but each PID is sampled independently at its
   * own rate/timestamps — a shared index rarely lines up to the same real
   * time across datasets, so the tooltip's PID list flickered between the
   * full set and 2-3 entries depending on which index Chart.js happened to
   * resolve. Finding each dataset's own nearest point in time (like legacy)
   * gives a full, stable PID list every time.
   */
  private syncTooltipActiveElements(chart: Chart, timeValue: number): void {
    const activeElements: { datasetIndex: number; index: number }[] = [];

    chart.data.datasets.forEach((ds, dsIdx) => {
      if (!chart.isDatasetVisible(dsIdx)) return;
      const data = ds.data as Point[];
      const index = this.findNearestIndex(data, timeValue);
      if (index === -1) return;
      if (Math.abs(data[index].x - timeValue) < TOOLTIP_MATCH_THRESHOLD_MS) {
        activeElements.push({ datasetIndex: dsIdx, index });
      }
    });

    if (activeElements.length === 0) return;
    chart.setActiveElements(activeElements);
    chart.tooltip?.setActiveElements(activeElements, {
      x: chart.scales['x'].getPixelForValue(timeValue),
      y: (chart.chartArea.top + chart.chartArea.bottom) / 2,
    });
    chart.update('none');
  }

  /** Port of legacy/src/chartmanager.js's `_findNearestIndex` (binary search). */
  private findNearestIndex(data: Point[], targetTime: number): number {
    if (!data || data.length === 0) return -1;
    if (targetTime <= data[0].x) return 0;
    if (targetTime >= data[data.length - 1].x) return data.length - 1;

    let start = 0;
    let end = data.length - 1;
    while (start <= end) {
      const mid = Math.floor((start + end) / 2);
      if (data[mid].x === targetTime) return mid;
      else if (data[mid].x < targetTime) start = mid + 1;
      else end = mid - 1;
    }

    const p1 = data[end];
    const p2 = data[start];
    if (!p1) return start;
    if (!p2) return end;
    return Math.abs(targetTime - p1.x) < Math.abs(targetTime - p2.x)
      ? end
      : start;
  }

  private syncVisibility(): void {
    this.charts.forEach((chart) => {
      let changed = false;
      chart.data.datasets.forEach((ds) => {
        const extra = ds as unknown as ChartDatasetExtra;
        const isVisible = this.appState.isSignalVisible(
          extra._fileIdx,
          extra._signalKey
        );
        // consistent state has ds.hidden === !isVisible, so equality here means it's stale
        if (ds.hidden === isVisible) {
          ds.hidden = !isVisible;
          ds.borderWidth = isVisible ? 3 : 1.5;
          changed = true;
        }
      });
      if (changed) chart.update('none');
    });
  }
}
