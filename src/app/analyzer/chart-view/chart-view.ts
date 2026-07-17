import {
  Component,
  ElementRef,
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
import { MapService } from '../../core/map.service';
import { ActiveHighlight, LoadedFile, ViewMode } from '../../core/models';
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

/**
 * Port of legacy/src/chartmanager.js's rendering core: stack and overlay
 * view modes, zoom/pan, tooltip with real-value transform, chart-hover-
 * drives-map-marker sync via MapService, point annotations (Alt+Click /
 * `A` keyboard shortcut), the per-card local range slider, and keyboard
 * pan/zoom/reset/legend-toggle shortcuts. File tagging, CSV export, and
 * Shift+Drag highlight-with-stats regions remain out of scope.
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

  protected readonly canvasRefs =
    viewChildren<ElementRef<HTMLCanvasElement>>('canvasEl');

  /** Keyed by chart index (fileIdx in stack mode, always 0 in overlay mode). */
  protected readonly sliderRanges = signal<Record<number, SliderRange>>({});

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
        this.buildAnnotationPlugin(() => this.appState.files()[fileIdx]),
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
      plugins: [this.buildAnnotationPlugin(() => this.appState.files()[0])],
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

  private buildAnnotationPlugin(
    getFile: () => LoadedFile | undefined
  ): Plugin<'line'> {
    return {
      id: 'pointAnnotations',
      afterDraw: (chart) => {
        const file = getFile();
        if (!file?.annotations?.length) return;
        const {
          ctx,
          chartArea: { top, bottom },
          scales: { x },
        } = chart;
        const xMin = x.min as number;
        const xMax = x.max as number;

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
      tension: 0,
      backgroundColor: 'transparent',
      fill: false,
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
    const xRange =
      (chart.scales['x'].max as number) - (chart.scales['x'].min as number);
    return (
      xRange < DATALABELS_TIME_RANGE_MS &&
      chart.data.datasets.filter((ds) => !ds.hidden).length <=
        DATALABELS_MAX_VISIBLE_DATASETS
    );
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
