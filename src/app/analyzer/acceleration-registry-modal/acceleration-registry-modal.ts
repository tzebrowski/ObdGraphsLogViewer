import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import {
  Chart,
  ChartDataset,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';
import {
  AccelerationService,
  SavedAccelerationRun,
} from '../../core/acceleration.service';
import { SignalPaletteService } from '../../core/signal-palette.service';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Title,
  Tooltip,
  Legend
);

type Point = { x: number; y: number };

/**
 * No legacy counterpart. Browses/compares runs saved via
 * AccelerationModal's "Save to Registry" button (AccelerationService.
 * saveActiveRunToRegistry) -- independent of whatever file happens to be
 * loaded, since comparing a run from today's log against one from last
 * week's means the two source files usually aren't loaded together.
 */
@Component({
  selector: 'app-acceleration-registry-modal',
  imports: [],
  templateUrl: './acceleration-registry-modal.html',
  styleUrl: './acceleration-registry-modal.css',
})
export class AccelerationRegistryModal {
  protected readonly accel = inject(AccelerationService);
  private readonly palette = inject(SignalPaletteService);

  protected readonly compareCanvasRef =
    viewChild<ElementRef<HTMLCanvasElement>>('compareCanvas');
  private chart: Chart | null = null;

  protected readonly selectedRuns = computed(() => {
    const registry = this.accel.registry();
    return this.accel
      .compareIds()
      .map((id) => registry.find((r) => r.id === id))
      .filter((r): r is SavedAccelerationRun => !!r);
  });

  constructor() {
    effect(() => {
      const selected = this.selectedRuns();
      const isOpen = this.accel.isRegistryOpen();
      const canvas = this.compareCanvasRef();
      if (isOpen && canvas && selected.length >= 2) {
        this.drawCompareChart(selected);
      } else {
        this.chart?.destroy();
        this.chart = null;
      }
    });
  }

  protected formatDate(ms: number): string {
    return new Date(ms).toLocaleString();
  }

  protected close(): void {
    this.chart?.destroy();
    this.chart = null;
    this.accel.closeRegistry();
  }

  private drawCompareChart(selected: SavedAccelerationRun[]): void {
    const canvasRef = this.compareCanvasRef();
    if (!canvasRef) return;

    this.chart?.destroy();

    const yMax =
      Math.ceil((Math.max(...selected.map((r) => r.targetSpeed)) * 1.1) / 10) *
      10;

    const datasets: ChartDataset<'line', Point[]>[] = selected.map(
      (run, idx) => ({
        label: `${this.formatDate(run.savedAt)} · ${run.elapsedSeconds.toFixed(2)}s`,
        data: run.points.map((p) => ({ x: p.x / 1000, y: p.y })),
        borderColor: this.palette.getColorForSignal(0, idx),
        yAxisID: 'ySpeed',
        tension: 0.3,
        cubicInterpolationMode: 'monotone',
        pointRadius: 0,
        borderWidth: 2.5,
      })
    );

    const ctx = canvasRef.nativeElement.getContext('2d');
    if (!ctx) return;

    this.chart = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          datalabels: { display: false },
          title: {
            display: true,
            text: 'Run Comparison',
            font: { size: 16, weight: 'bold' },
          },
          tooltip: {
            callbacks: {
              label: (context) =>
                `${context.dataset.label}: ${(context.parsed.y ?? 0).toFixed(1)}`,
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: 'Elapsed Time (s)' },
            grid: { color: 'rgba(128,128,128,0.1)' },
            min: 0,
          },
          ySpeed: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Speed (km/h)' },
            min: 0,
            max: yMax,
            grid: { color: 'rgba(128,128,128,0.1)' },
          },
        },
      },
    });
  }
}
