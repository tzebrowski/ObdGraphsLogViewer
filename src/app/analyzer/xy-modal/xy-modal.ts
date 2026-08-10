import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  Chart,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  Plugin,
  PointElement,
  ScatterController,
  Tooltip,
  TooltipPositionerFunction,
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { AppStateService } from '../../core/app-state.service';
import { LoadedFile } from '../../core/models';
import { PreferencesService } from '../../core/preferences.service';
import { SignalPaletteService } from '../../core/signal-palette.service';
import {
  PanelIndex,
  ScatterPoint,
  XyAnalysisService,
  XyPanelSelection,
} from '../../core/xy-analysis.service';

Chart.register(
  ScatterController,
  LineController,
  PointElement,
  LineElement,
  LinearScale,
  Tooltip,
  Legend,
  zoomPlugin
);

declare module 'chart.js' {
  interface TooltipPositionerMap {
    xyFixed: TooltipPositionerFunction<never>;
  }
}
/** Port of legacy/src/xyanalysis.js's `xyFixed` tooltip positioner — pins the timeline tooltip to the chart's top-right corner instead of following the cursor. */
Tooltip.positioners.xyFixed = function (_elements, _eventPosition) {
  const chart = this.chart;
  if (!chart) return false as never;
  const { chartArea } = chart;
  return { x: chartArea.right - 10, y: chartArea.top + 10 };
};

interface Legend2 {
  min: number;
  max: number;
  label: string;
}

/**
 * Port of legacy/src/xyanalysis.js's UI: two scatter heatmap panels
 * (X/Y/Z-selected signals, points colored by Z) plus a shared normalized
 * timeline of every signal in play. Uses native `<select>`s instead of
 * legacy's custom searchable-autocomplete widget, and Chart.js's built-in
 * tooltip instead of the custom external-HTML tooltip table.
 */
@Component({
  selector: 'app-xy-modal',
  imports: [],
  templateUrl: './xy-modal.html',
  styleUrl: './xy-modal.css',
})
export class XyModal {
  protected readonly xy = inject(XyAnalysisService);
  protected readonly appState = inject(AppStateService);
  private readonly palette = inject(SignalPaletteService);
  private readonly preferences = inject(PreferencesService);

  protected readonly panel0Canvas =
    viewChild<ElementRef<HTMLCanvasElement>>('xyCanvas0');
  protected readonly panel1Canvas =
    viewChild<ElementRef<HTMLCanvasElement>>('xyCanvas1');
  protected readonly timelineCanvas =
    viewChild<ElementRef<HTMLCanvasElement>>('xyTimelineCanvas');

  protected readonly legends = signal<[Legend2 | null, Legend2 | null]>([
    null,
    null,
  ]);

  private charts: [Chart | null, Chart | null] = [null, null];
  private timelineChart: Chart | null = null;

  protected readonly currentFile = computed<LoadedFile | undefined>(
    () => this.appState.files()[this.xy.currentFileIndex()]
  );

  protected readonly availableSignals = computed(() =>
    [...(this.currentFile()?.availableSignals ?? [])].sort()
  );

  constructor() {
    effect(() => {
      if (this.xy.isModalOpen()) this.seedDefaults();
    });

    effect(() => {
      const panels = this.xy.panels();
      const file = this.currentFile();
      const c0 = this.panel0Canvas();
      const c1 = this.panel1Canvas();
      const tc = this.timelineCanvas();
      this.preferences.darkTheme();
      if (!this.xy.isModalOpen() || !file || !c0 || !c1 || !tc) return;

      this.drawPanel(0, file, panels[0]);
      this.drawPanel(1, file, panels[1]);
      this.drawTimeline(file, panels);
    });
  }

  protected onFileChange(index: number): void {
    this.xy.setFileIndex(index);
    this.seedDefaults();
  }

  protected setSignal(
    panelIdx: PanelIndex,
    axis: 'xSignal' | 'ySignal' | 'zSignal',
    value: string
  ): void {
    this.xy.setPanelSignal(panelIdx, axis, value);
  }

  protected close(): void {
    this.charts.forEach((c) => c?.destroy());
    this.charts = [null, null];
    this.timelineChart?.destroy();
    this.timelineChart = null;
    this.xy.closeModal();
  }

  private seedDefaults(): void {
    const file = this.currentFile();
    if (!file) return;
    const signals = [...file.availableSignals].sort();
    this.xy.setPanelSelection(0, this.xy.defaultSelection(signals, 0));
    this.xy.setPanelSelection(1, this.xy.defaultSelection(signals, 1));
  }

  private drawPanel(
    panelIdx: PanelIndex,
    file: LoadedFile,
    selection: XyPanelSelection
  ): void {
    const canvasRef =
      panelIdx === 0 ? this.panel0Canvas() : this.panel1Canvas();
    if (!canvasRef) return;

    this.charts[panelIdx]?.destroy();
    this.charts[panelIdx] = null;

    const { xSignal, ySignal, zSignal } = selection;
    if (!xSignal || !ySignal || !zSignal) {
      this.setLegend(panelIdx, null);
      return;
    }

    const data = this.xy.generateScatterData(file, xSignal, ySignal, zSignal);
    if (data.length === 0) {
      this.setLegend(panelIdx, null);
      return;
    }

    const zValues = data.map((p) => p.z);
    const minZ = Math.min(...zValues);
    const maxZ = Math.max(...zValues);
    const pointColors = data.map((p) => this.xy.getHeatColor(p.z, minZ, maxZ));

    this.setLegend(panelIdx, { min: minZ, max: maxZ, label: zSignal });

    const ctx = canvasRef.nativeElement.getContext('2d');
    if (!ctx) return;

    const isDark = this.preferences.darkTheme();
    const textColor = isDark ? '#eee' : '#333';
    const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

    this.charts[panelIdx] = new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: `${ySignal} vs ${xSignal}`,
            data,
            backgroundColor: pointColors,
            borderColor: pointColors,
            borderWidth: 1,
            pointRadius: 3,
            pointHoverRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            position: 'bottom',
            title: { display: true, text: xSignal, color: textColor },
            grid: { color: gridColor },
            ticks: { color: textColor },
          },
          y: {
            title: { display: true, text: ySignal, color: textColor },
            grid: { color: gridColor },
            ticks: { color: textColor },
          },
        },
        plugins: {
          datalabels: { display: false },
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => {
                const p = context.raw as ScatterPoint;
                return [
                  `${xSignal}: ${p.x.toFixed(2)}`,
                  `${ySignal}: ${p.y.toFixed(2)}`,
                  `${zSignal}: ${p.z.toFixed(2)}`,
                ];
              },
            },
          },
          zoom: {
            zoom: { wheel: { enabled: true }, mode: 'xy' },
            pan: { enabled: true, mode: 'xy' },
          },
        },
      },
    });
  }

  private drawTimeline(
    file: LoadedFile,
    panels: [XyPanelSelection, XyPanelSelection]
  ): void {
    const canvasRef = this.timelineCanvas();
    if (!canvasRef) return;

    this.timelineChart?.destroy();
    this.timelineChart = null;

    const signalSet = new Set<string>();
    panels.forEach((p) => {
      if (p.xSignal) signalSet.add(p.xSignal);
      if (p.ySignal) signalSet.add(p.ySignal);
      if (p.zSignal) signalSet.add(p.zSignal);
    });
    const signalNames = [...signalSet];
    if (signalNames.length === 0) return;

    const fileIdx = this.xy.currentFileIndex();

    const datasets = signalNames
      .map((sigName) => {
        const rawData = file.signals[sigName];
        if (!rawData) return null;

        const yValues = rawData.map((p) => p.y);
        const min = Math.min(...yValues);
        const max = Math.max(...yValues);
        const range = max - min || 1;

        const data = rawData.map((p) => ({
          x: (p.x - file.startTime) / 1000,
          y: (p.y - min) / range,
          originalValue: p.y,
        }));

        const color = this.palette.getColorForSignal(
          fileIdx,
          file.availableSignals.indexOf(sigName)
        );

        return {
          label: sigName,
          data,
          borderColor: color,
          backgroundColor: color,
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 0,
          hitRadius: 10,
          fill: false,
          tension: 0.1,
        };
      })
      .filter((ds): ds is NonNullable<typeof ds> => ds !== null);

    const ctx = canvasRef.nativeElement.getContext('2d');
    if (!ctx) return;

    const isDark = this.preferences.darkTheme();
    const textColor = isDark ? '#eee' : '#333';
    const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

    /** Port of legacy/src/xyanalysis.js's `xyHoverLine` plugin: a vertical guide line at the active tooltip point. */
    const hoverLinePlugin: Plugin<'line'> = {
      id: 'xyHoverLine',
      afterDraw: (chart) => {
        // `_active` is a runtime-only field on Chart.js's Tooltip class, not
        // part of the public TooltipModel type.
        const tooltip = chart.tooltip as unknown as {
          _active?: { element: { x: number } }[];
        };
        const active = tooltip?._active;
        if (!active || active.length === 0) return;
        const x = active[0].element.x;
        const topY = chart.scales['y'].top;
        const bottomY = chart.scales['y'].bottom;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x, topY);
        ctx.lineTo(x, bottomY);
        ctx.lineWidth = 1;
        ctx.strokeStyle = isDark
          ? 'rgba(255, 255, 255, 0.5)'
          : 'rgba(0, 0, 0, 0.5)';
        ctx.stroke();
        ctx.restore();
      },
    };

    this.timelineChart = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      plugins: [hoverLinePlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'linear',
            title: {
              display: true,
              text: 'Time (s)',
              font: { size: 10 },
              color: textColor,
            },
            grid: { color: gridColor },
            ticks: { font: { size: 10 }, color: textColor },
          },
          y: { display: false, min: -0.05, max: 1.05 },
        },
        plugins: {
          datalabels: { display: false },
          legend: {
            display: true,
            position: 'top',
            labels: {
              boxWidth: 10,
              font: { size: 10 },
              usePointStyle: true,
              color: textColor,
            },
          },
          tooltip: {
            position: 'xyFixed',
            mode: 'index',
            intersect: false,
            callbacks: {
              label: (context) => {
                const raw = context.raw as { originalValue: number };
                return `${context.dataset.label}: ${raw.originalValue.toFixed(2)}`;
              },
            },
          },
          zoom: {
            zoom: { wheel: { enabled: true }, mode: 'x' },
            pan: { enabled: true, mode: 'x' },
          },
        },
      },
    });
  }

  private setLegend(panelIdx: PanelIndex, value: Legend2 | null): void {
    this.legends.update((legends) => {
      const next: [Legend2 | null, Legend2 | null] = [...legends];
      next[panelIdx] = value;
      return next;
    });
  }
}
