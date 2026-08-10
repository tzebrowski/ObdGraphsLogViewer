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
import { AppStateService } from '../../core/app-state.service';
import { DynoPull, DynoService } from '../../core/dyno.service';
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
 * Port of legacy/src/dynomanager.js's UI: setup step (signal pickers +
 * sweep-detection thresholds) then the chart modal (torque/power vs RPM,
 * with optional extra-signal overlays, pull selector, "View on Chart", and
 * PNG export). The overlay-signal checklist replaces legacy's DOM-injected
 * checkboxes with a native list bound to DynoService's selection signal.
 */
@Component({
  selector: 'app-dyno-modal',
  imports: [],
  templateUrl: './dyno-modal.html',
  styleUrl: './dyno-modal.css',
})
export class DynoModal {
  protected readonly dyno = inject(DynoService);
  protected readonly appState = inject(AppStateService);
  private readonly palette = inject(SignalPaletteService);

  protected readonly canvasRef =
    viewChild<ElementRef<HTMLCanvasElement>>('dynoCanvas');
  private chart: Chart | null = null;

  protected readonly setupRpmKey = signal('');
  protected readonly setupTorqueKey = signal('');
  protected readonly setupPedalKey = signal('');
  protected readonly setupPedalStart = signal(60);
  protected readonly setupPedalWot = signal(85);
  protected readonly setupRpmDelta = signal(1200);
  protected readonly signalSearch = signal('');

  protected readonly currentFile = computed(() => this.appState.files()[0]);

  protected readonly availableSignals = computed(() =>
    [...(this.currentFile()?.availableSignals ?? [])].sort()
  );

  protected readonly extraSignalCandidates = computed(() => {
    const cfg = this.dyno.config();
    const term = this.signalSearch().toLowerCase().trim();
    return this.availableSignals().filter((sig) => {
      if (
        cfg &&
        (sig === cfg.rpmKey || sig === cfg.torqueKey || sig === cfg.pedalKey)
      )
        return false;
      return !term || sig.toLowerCase().includes(term);
    });
  });

  constructor() {
    effect(() => {
      if (this.dyno.isSetupOpen()) this.resetSetupForm();
    });

    effect(() => {
      this.dyno.selectedPullIndex();
      this.dyno.selectedExtraSignals();
      const isOpen = this.dyno.isModalOpen();
      const canvas = this.canvasRef();
      if (isOpen && canvas) this.drawChart();
    });
  }

  protected pullLabel(pull: DynoPull, idx: number): string {
    const min = Math.min(...pull.rpm).toFixed(0);
    const max = Math.max(...pull.rpm).toFixed(0);
    return `Pull ${idx + 1}: ${min} - ${max} RPM`;
  }

  protected generate(): void {
    if (
      !this.setupRpmKey() ||
      !this.setupTorqueKey() ||
      !this.setupPedalKey()
    ) {
      this.appState.showAlert(
        'Please select Engine Speed, Torque, and Pedal Position signals.'
      );
      return;
    }

    const result = this.dyno.generate({
      rpmKey: this.setupRpmKey(),
      torqueKey: this.setupTorqueKey(),
      pedalKey: this.setupPedalKey(),
      pedalStart: this.setupPedalStart(),
      pedalWot: this.setupPedalWot(),
      rpmDelta: this.setupRpmDelta(),
    });

    if (!result.success) {
      this.appState.showAlert(result.message ?? 'No sweeps found.');
    }
  }

  protected viewOnChart(): void {
    const file = this.currentFile();
    if (!file) return;
    const range = this.dyno.highlightRangeForActivePull(file);
    if (!range) return;
    this.appState.setActiveHighlight(range.start, range.end, 0);
    this.dyno.closeModal();
  }

  protected exportPng(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = document.body.classList.contains('dark-theme')
      ? '#1e1e1e'
      : '#ffffff';
    ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    ctx.drawImage(canvas, 0, 0);

    const link = document.createElement('a');
    link.download = 'mygiulia_virtual_dyno.png';
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
  }

  protected closeSetup(): void {
    this.dyno.closeSetup();
  }

  protected close(): void {
    this.chart?.destroy();
    this.chart = null;
    this.dyno.closeModal();
  }

  private resetSetupForm(): void {
    const signals = this.availableSignals();
    this.setupRpmKey.set(
      this.dyno.suggestSignal(signals, ['engine speed', 'rpm'])
    );
    this.setupTorqueKey.set(
      this.dyno.suggestSignal(signals, [
        'measured engine torque',
        'engine torque',
        'torque',
      ])
    );
    this.setupPedalKey.set(
      this.dyno.suggestSignal(signals, [
        'gas pedal',
        'throttle position',
        'pedal',
      ])
    );
    this.setupPedalStart.set(60);
    this.setupPedalWot.set(85);
    this.setupRpmDelta.set(1200);
    this.signalSearch.set('');
  }

  private drawChart(): void {
    const canvasRef = this.canvasRef();
    const file = this.currentFile();
    const pull = this.dyno.pulls()[this.dyno.selectedPullIndex()];
    if (!canvasRef || !file || !pull) return;

    const extraSignals = this.dyno.selectedExtraSignals();
    const points = this.dyno.computeDynoPoints(file, pull, extraSignals);
    this.chart?.destroy();
    if (points.length === 0) return;

    const torqueData: Point[] = points.map((p) => ({ x: p.rpm, y: p.torque }));
    const powerData: Point[] = points.map((p) => ({ x: p.rpm, y: p.power }));
    const maxTorque = Math.max(...points.map((p) => p.torque));
    const maxPower = Math.max(...points.map((p) => p.power));

    const datasets: ChartDataset<'line', Point[]>[] = [
      {
        label: 'Torque (Nm)',
        data: torqueData,
        borderColor: '#1c3d72',
        backgroundColor: 'rgba(28, 61, 114, 0.1)',
        yAxisID: 'yTorque',
        tension: 0.4,
        cubicInterpolationMode: 'monotone',
        pointRadius: 0,
        borderWidth: 3,
      },
      {
        label: 'Power (HP)',
        data: powerData,
        borderColor: '#c22636',
        backgroundColor: 'rgba(194, 38, 54, 0.1)',
        yAxisID: 'yPower',
        tension: 0.4,
        cubicInterpolationMode: 'monotone',
        pointRadius: 0,
        borderWidth: 3,
      },
    ];

    extraSignals.forEach((sig) => {
      const sigIdx = file.availableSignals.indexOf(sig);
      const color = this.palette.getColorForSignal(0, sigIdx);
      datasets.push({
        label: sig,
        data: points.map((p) => ({ x: p.rpm, y: p.extras[sig] })),
        borderColor: color,
        yAxisID: 'yExtra',
        tension: 0.4,
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
            text: `Virtual Dyno - Max Power: ${maxPower.toFixed(1)} HP | Max Torque: ${maxTorque.toFixed(1)} Nm`,
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
            title: { display: true, text: 'Engine Speed (RPM)' },
            grid: { color: 'rgba(128,128,128,0.1)' },
            min: Math.floor(Math.min(...pull.rpm) / 500) * 500,
            max: Math.ceil(Math.max(...pull.rpm) / 500) * 500,
          },
          yTorque: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Torque (Nm)' },
            min: 0,
            max: 1000,
            grid: { color: 'rgba(128,128,128,0.1)' },
          },
          yPower: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'Power (HP)' },
            min: 0,
            max: Math.ceil(maxPower / 100) * 100 + 50,
            grid: { drawOnChartArea: false },
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
