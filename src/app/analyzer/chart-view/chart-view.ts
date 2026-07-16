import {
  Component,
  ElementRef,
  effect,
  inject,
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

/**
 * Port of legacy/src/chartmanager.js's rendering core: stack and overlay
 * view modes, zoom/pan, tooltip with real-value transform, and (Milestone 4)
 * chart-hover-drives-map-marker sync via MapService. Tag annotations, the
 * per-card local range slider, and keyboard shortcuts remain out of scope.
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

  protected readonly canvasRefs =
    viewChildren<ElementRef<HTMLCanvasElement>>('canvasEl');

  private charts: Chart[] = [];

  constructor() {
    effect(() => {
      const files = this.appState.files();
      const mode = this.appState.viewMode();
      const canvases = this.canvasRefs();

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
  }

  protected manualZoom(index: number, zoomLevel: number): void {
    this.charts[index]?.zoom(zoomLevel);
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

    canvas.addEventListener('mouseleave', () => this.mapService.clearHover());

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
    });
  }

  private buildOverlayChart(
    files: LoadedFile[],
    canvas: HTMLCanvasElement
  ): Chart {
    const ctx = canvas.getContext('2d')!;
    canvas.addEventListener('mouseleave', () => this.mapService.clearHover());
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
    });
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
    const options: ChartOptions<'line'> = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      onHover: (event, _elements, chart) => {
        if (event.x === null || event.x === undefined) return;
        const timeValue = chart.scales['x'].getValueForPixel(event.x);
        if (timeValue === undefined) return;
        if (mode === 'overlay') {
          mapService.setOverlayHover(timeValue);
        } else {
          mapService.setStackHover(hoverFileIdx, timeValue);
        }
      },
      scales: {
        y: { beginAtZero: true, max: 1.2, ticks: { display: false } },
        x: {
          type: 'linear' as const,
          min: xMin,
          max: xMax,
          title: { display: true, text: 'Trip Duration (mm:ss)' },
          ticks: {
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
            filter: (item, chartData) => {
              const ds = chartData.datasets[
                item.datasetIndex!
              ] as unknown as ChartDatasetExtra;
              return appState.isSignalVisible(ds._fileIdx, ds._signalKey);
            },
          },
        },
        zoom: {
          pan: { enabled: true, mode: 'x' },
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: 'x',
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
