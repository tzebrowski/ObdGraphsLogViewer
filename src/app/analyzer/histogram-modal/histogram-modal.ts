import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js';
import { AppStateService } from '../../core/app-state.service';
import { HistogramService } from '../../core/histogram.service';
import { PreferencesService } from '../../core/preferences.service';

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend
);

/**
 * Port of legacy/src/histogram.js's UI. Legacy required an explicit
 * "Update" click to regenerate; this recomputes reactively whenever the
 * file/signal/bin-count selection changes, which is simpler and matches how
 * the other analysis modals in this app behave.
 */
@Component({
  selector: 'app-histogram-modal',
  imports: [],
  templateUrl: './histogram-modal.html',
  styleUrl: './histogram-modal.css',
})
export class HistogramModal {
  protected readonly histogram = inject(HistogramService);
  protected readonly appState = inject(AppStateService);
  private readonly preferences = inject(PreferencesService);

  protected readonly canvasRef =
    viewChild<ElementRef<HTMLCanvasElement>>('histCanvas');
  private chart: Chart | null = null;

  protected readonly availableSignals = computed(() => {
    const file = this.appState.files()[this.histogram.fileIndex()];
    return [...(file?.availableSignals ?? [])].sort();
  });

  constructor() {
    effect(() => {
      const fileIdx = this.histogram.fileIndex();
      const signalName = this.histogram.signalName();
      const binCount = this.histogram.binCount();
      const canvas = this.canvasRef();
      if (this.histogram.isModalOpen() && canvas) {
        this.draw(fileIdx, signalName, binCount);
      }
    });
  }

  protected onFileChange(index: number): void {
    this.histogram.setFileIndex(index);
  }

  protected close(): void {
    this.chart?.destroy();
    this.chart = null;
    this.histogram.closeModal();
  }

  private draw(fileIdx: number, signalName: string, binCount: number): void {
    const canvasRef = this.canvasRef();
    const file = this.appState.files()[fileIdx];
    if (!canvasRef || !file || !signalName || !file.signals[signalName]) return;

    const values = file.signals[signalName].map((p) => p.y);
    const { labels, bins } = this.histogram.computeBins(values, binCount);

    this.chart?.destroy();
    const ctx = canvasRef.nativeElement.getContext('2d');
    if (!ctx) return;

    const isDark = this.preferences.darkTheme();
    const textColor = isDark ? '#eee' : '#333';
    const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

    this.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: `Distribution: ${signalName}`,
            data: bins,
            backgroundColor: 'rgba(54, 162, 235, 0.6)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            ticks: { color: textColor },
            grid: { color: gridColor },
          },
          x: {
            ticks: { color: textColor, maxRotation: 45, minRotation: 45 },
            grid: { display: false },
          },
        },
        plugins: {
          legend: { labels: { color: textColor } },
          tooltip: {
            callbacks: { label: (ctx) => `Samples: ${ctx.raw}` },
          },
        },
      },
    });
  }
}
