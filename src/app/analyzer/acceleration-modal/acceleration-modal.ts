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
  AccelerationRun,
  AccelerationService,
} from '../../core/acceleration.service';
import { AppStateService } from '../../core/app-state.service';
import { PreferencesService } from '../../core/preferences.service';
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
 * Purely cosmetic: how many seconds of extra context to show before the
 * launch and after the target is reached, so the chart reads as "car
 * sitting still, then goes, then a moment after" rather than starting and
 * ending mid-motion. Never affects run detection or the elapsedSeconds
 * timing -- AccelerationService's launch/target crossings are computed
 * independently of what the chart happens to display. The vertical Start/
 * End lines mark exactly where the timed window itself begins and ends,
 * so the roll-off on either side reads as context, not part of the run.
 */
const CHART_ROLL_SECONDS = 3;

/**
 * No legacy counterpart. UI twin of DynoModal: a setup step (signal picker
 * + run-detection thresholds) then a chart modal (speed vs. elapsed time,
 * with optional extra-signal overlays, run selector, "View on Chart", and
 * PNG export) driven by AccelerationService.
 */
@Component({
  selector: 'app-acceleration-modal',
  imports: [],
  templateUrl: './acceleration-modal.html',
  styleUrl: './acceleration-modal.css',
})
export class AccelerationModal {
  protected readonly accel = inject(AccelerationService);
  protected readonly appState = inject(AppStateService);
  private readonly palette = inject(SignalPaletteService);
  private readonly preferences = inject(PreferencesService);

  protected readonly canvasRef =
    viewChild<ElementRef<HTMLCanvasElement>>('accelCanvas');
  private chart: Chart | null = null;

  protected readonly setupSpeedKey = signal('');
  protected readonly setupStartSpeed = signal(2);
  protected readonly setupTargetSpeed = signal(100);
  protected readonly setupMaxDuration = signal(30);
  protected readonly setupBackslideTolerance = signal(5);
  protected readonly signalSearch = signal('');

  protected readonly currentFile = computed(() => this.appState.files()[0]);

  protected readonly availableSignals = computed(() =>
    [...(this.currentFile()?.availableSignals ?? [])].sort()
  );

  protected readonly extraSignalCandidates = computed(() => {
    const cfg = this.accel.config();
    const term = this.signalSearch().toLowerCase().trim();
    return this.availableSignals().filter((sig) => {
      if (cfg && sig === cfg.speedKey) return false;
      return !term || sig.toLowerCase().includes(term);
    });
  });

  constructor() {
    effect(() => {
      if (this.accel.isSetupOpen()) this.resetSetupForm();
    });

    effect(() => {
      this.accel.selectedRunIndex();
      this.accel.selectedExtraSignals();
      const isOpen = this.accel.isModalOpen();
      const canvas = this.canvasRef();
      if (isOpen && canvas) this.drawChart();
    });
  }

  protected runLabel(run: AccelerationRun, idx: number): string {
    return `Run ${idx + 1}: ${run.elapsedSeconds.toFixed(2)}s`;
  }

  protected generate(): void {
    if (!this.setupSpeedKey()) {
      this.appState.showAlert('Please select a Vehicle Speed signal.');
      return;
    }

    const result = this.accel.generate({
      speedKey: this.setupSpeedKey(),
      startSpeed: this.setupStartSpeed(),
      targetSpeed: this.setupTargetSpeed(),
      maxDuration: this.setupMaxDuration(),
      backslideTolerance: this.setupBackslideTolerance(),
    });

    if (!result.success) {
      this.appState.showAlert(result.message ?? 'No runs found.');
    }
  }

  protected viewOnChart(): void {
    const file = this.currentFile();
    if (!file) return;
    const range = this.accel.highlightRangeForActiveRun(file);
    if (!range) return;
    this.appState.setActiveHighlight(range.start, range.end, 0);
    this.accel.closeModal();
  }

  protected exportPng(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = this.preferences.darkTheme() ? '#1e1e1e' : '#ffffff';
    ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    ctx.drawImage(canvas, 0, 0);

    const link = document.createElement('a');
    link.download = 'mygiulia_acceleration_run.png';
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
  }

  protected closeSetup(): void {
    this.accel.closeSetup();
  }

  protected close(): void {
    this.chart?.destroy();
    this.chart = null;
    this.accel.closeModal();
  }

  private resetSetupForm(): void {
    const signals = this.availableSignals();
    this.setupSpeedKey.set(
      this.accel.suggestSignal(
        signals,
        ['vehicle speed', 'wheel speed', 'gps speed', 'road speed', 'speed'],
        ['engine', 'rpm']
      )
    );
    this.setupStartSpeed.set(2);
    this.setupTargetSpeed.set(100);
    this.setupMaxDuration.set(30);
    this.setupBackslideTolerance.set(5);
    this.signalSearch.set('');
  }

  private drawChart(): void {
    const canvasRef = this.canvasRef();
    const file = this.currentFile();
    const config = this.accel.config();
    const run = this.accel.runs()[this.accel.selectedRunIndex()];
    if (!canvasRef || !file || !config || !run) return;

    this.chart?.destroy();

    const extraSignals = this.accel.selectedExtraSignals();

    // Pull straight from the file's raw speed signal (not run.time/speed,
    // which only cover the launch->target detection window) so the chart
    // can show a few seconds of standstill before the launch and a few
    // seconds of context after the target is reached.
    const speedSignal = file.signals[config.speedKey] || [];
    const displayStart = run.startTime - CHART_ROLL_SECONDS * 1000;
    const displayEnd = run.targetTime + CHART_ROLL_SECONDS * 1000;
    const displayPoints = speedSignal.filter(
      (p) => p.x >= displayStart && p.x <= displayEnd
    );

    const speedData: Point[] = displayPoints.map((p) => ({
      x: (p.x - run.startTime) / 1000,
      y: p.y,
    }));
    const chartStart = speedData.length > 0 ? speedData[0].x : 0;
    const runEnd = (run.targetTime - run.startTime) / 1000;
    const yMax = Math.ceil((config.targetSpeed * 1.1) / 10) * 10;
    const targetLine: Point[] = [
      { x: chartStart, y: config.targetSpeed },
      { x: runEnd, y: config.targetSpeed },
    ];
    // Vertical markers for exactly where the timed 0->target window begins
    // and ends, so the pre/post roll-off reads as surrounding context
    // rather than being mistaken for part of the run itself.
    const startLine: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: yMax },
    ];
    const endLine: Point[] = [
      { x: runEnd, y: 0 },
      { x: runEnd, y: yMax },
    ];

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
        label: `Target (${config.targetSpeed} km/h)`,
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

    extraSignals.forEach((sig) => {
      const sigIdx = file.availableSignals.indexOf(sig);
      const color = this.palette.getColorForSignal(0, sigIdx);
      const raw = file.signals[sig] || [];
      let rIdx = 0;
      let lastVal = 0;
      const extraData: Point[] = displayPoints.map((p) => {
        while (rIdx < raw.length && raw[rIdx].x <= p.x) {
          lastVal = raw[rIdx].y;
          rIdx++;
        }
        return { x: (p.x - run.startTime) / 1000, y: lastVal };
      });
      datasets.push({
        label: sig,
        data: extraData,
        borderColor: color,
        yAxisID: 'yExtra',
        tension: 0.3,
        cubicInterpolationMode: 'monotone',
        pointRadius: 0,
        borderWidth: 2,
        borderDash: [5, 5],
      });
    });

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
            text: `${config.startSpeed} → ${config.targetSpeed} km/h: ${run.elapsedSeconds.toFixed(2)}s`,
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
            min: chartStart,
          },
          ySpeed: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Speed (km/h)' },
            min: 0,
            max: yMax,
            grid: { color: 'rgba(128,128,128,0.1)' },
          },
          yExtra: {
            type: 'linear',
            position: 'right',
            display: false,
            grid: { drawOnChartArea: false },
          },
        },
      },
    });
  }
}
