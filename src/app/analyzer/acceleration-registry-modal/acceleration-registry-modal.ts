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
 * No legacy counterpart. Browses runs saved via AccelerationModal's "Save
 * to Registry" button (AccelerationService.saveActiveRunToRegistry) --
 * independent of whatever file happens to be loaded, since a saved run's
 * whole point is being inspectable (or compared against another) long
 * after its source file may no longer be loaded.
 *
 * Two display modes share one canvas/chart instance, mutually exclusive:
 * clicking a single row's "View" button shows that run's own detail chart
 * (mirrors AccelerationModal's chart -- target/start/end/split lines, gear
 * shift markers, chip list), which is the primary use case (inspecting one
 * run, possibly the only one saved). Checking 2+ rows overlays their speed
 * curves for a side-by-side comparison instead -- viewingRunId takes
 * priority when both are active, since it's the more specific request.
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

  protected readonly resultCanvasRef =
    viewChild<ElementRef<HTMLCanvasElement>>('resultCanvas');
  private chart: Chart | null = null;

  protected readonly viewingRunId = signal<number | null>(null);

  protected readonly viewingRun = computed(
    () =>
      this.accel.registry().find((r) => r.id === this.viewingRunId()) ?? null
  );

  protected readonly selectedRuns = computed(() => {
    const registry = this.accel.registry();
    return this.accel
      .compareIds()
      .map((id) => registry.find((r) => r.id === id))
      .filter((r): r is SavedAccelerationRun => !!r);
  });

  constructor() {
    effect(() => {
      const viewing = this.viewingRun();
      const compared = this.selectedRuns();
      const isOpen = this.accel.isRegistryOpen();
      const canvas = this.resultCanvasRef();

      if (!isOpen || !canvas) {
        this.chart?.destroy();
        this.chart = null;
        return;
      }
      if (viewing) {
        this.drawSingleRunChart(viewing);
      } else if (compared.length >= 2) {
        this.drawCompareChart(compared);
      } else {
        this.chart?.destroy();
        this.chart = null;
      }
    });
  }

  protected formatDate(ms: number): string {
    return new Date(ms).toLocaleString();
  }

  protected toggleView(id: number): void {
    this.viewingRunId.update((cur) => (cur === id ? null : id));
  }

  protected close(): void {
    this.chart?.destroy();
    this.chart = null;
    this.viewingRunId.set(null);
    this.accel.closeRegistry();
  }

  /** Reconstructs the exact chart AccelerationModal shows for a live run, but entirely from the saved snapshot -- no source file needed. */
  private drawSingleRunChart(run: SavedAccelerationRun): void {
    const canvasRef = this.resultCanvasRef();
    if (!canvasRef) return;

    this.chart?.destroy();

    const speedData: Point[] = run.points.map((p) => ({
      x: p.x / 1000,
      y: p.y,
    }));
    const runEnd = run.elapsedSeconds;
    const yMax = Math.ceil((run.targetSpeed * 1.1) / 10) * 10;

    const targetLine: Point[] = [
      { x: 0, y: run.targetSpeed },
      { x: runEnd, y: run.targetSpeed },
    ];
    const startLine: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: yMax },
    ];
    const endLine: Point[] = [
      { x: runEnd, y: 0 },
      { x: runEnd, y: yMax },
    ];
    const splitLine: Point[] | null =
      run.splitElapsedSeconds != null && run.splitSpeed
        ? [
            { x: run.splitElapsedSeconds, y: 0 },
            { x: run.splitElapsedSeconds, y: yMax },
          ]
        : null;

    let gearShiftScanIdx = 0;
    const gearShiftPoints: Point[] = run.gearShifts.map((shift) => {
      while (
        gearShiftScanIdx < run.points.length - 1 &&
        run.points[gearShiftScanIdx + 1].x <= shift.time
      ) {
        gearShiftScanIdx++;
      }
      return {
        x: shift.elapsedSeconds,
        y: run.points[gearShiftScanIdx]?.y ?? 0,
      };
    });

    const datasets: ChartDataset<'line', Point[]>[] = [
      {
        label: 'Speed (km/h)',
        data: speedData,
        borderColor: '#1c3d72',
        backgroundColor: 'rgba(28, 61, 114, 0.1)',
        yAxisID: 'ySpeed',
        tension: 0.3,
        cubicInterpolationMode: 'monotone',
        pointRadius: 0,
        borderWidth: 3,
      },
      {
        label: `Target (${run.targetSpeed} km/h)`,
        data: targetLine,
        borderColor: '#c22636',
        yAxisID: 'ySpeed',
        borderDash: [6, 6],
        pointRadius: 0,
        borderWidth: 1.5,
      },
      {
        label: 'Start',
        data: startLine,
        borderColor: '#2e7d32',
        yAxisID: 'ySpeed',
        borderDash: [3, 3],
        pointRadius: 0,
        borderWidth: 1.5,
      },
      {
        label: 'End',
        data: endLine,
        borderColor: '#2e7d32',
        yAxisID: 'ySpeed',
        borderDash: [3, 3],
        pointRadius: 0,
        borderWidth: 1.5,
      },
    ];

    if (splitLine) {
      datasets.push({
        label: `Split (${run.splitSpeed} km/h)`,
        data: splitLine,
        borderColor: '#f39c12',
        yAxisID: 'ySpeed',
        borderDash: [2, 4],
        pointRadius: 0,
        borderWidth: 1.5,
      });
    }

    if (gearShiftPoints.length > 0) {
      datasets.push({
        label: 'Gear Shift',
        data: gearShiftPoints,
        borderColor: '#8e44ad',
        backgroundColor: '#8e44ad',
        yAxisID: 'ySpeed',
        showLine: false,
        pointStyle: 'triangle',
        pointRadius: 7,
        pointHoverRadius: 9,
        borderWidth: 0,
      });
    }

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
            text:
              `${run.startSpeed} → ${run.targetSpeed} km/h: ${run.elapsedSeconds.toFixed(2)}s` +
              (run.splitElapsedSeconds != null && run.splitSpeed
                ? `   |   0-${run.splitSpeed}: ${run.splitElapsedSeconds.toFixed(2)}s`
                : ''),
            font: { size: 16, weight: 'bold' },
          },
          // See acceleration-modal.ts's identical tooltip filter: the sparse
          // Gear Shift dataset can't reliably align with index-mode tooltip
          // matching against the dense speed curve, so it's excluded here
          // too and surfaced via the chip list underneath instead.
          tooltip: {
            filter: (item) => item.dataset.label !== 'Gear Shift',
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

  private drawCompareChart(selected: SavedAccelerationRun[]): void {
    const canvasRef = this.resultCanvasRef();
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
