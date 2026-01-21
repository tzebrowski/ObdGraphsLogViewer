import { AppState } from './config.js';
import { Chart, registerables } from 'chart.js';

class HistogramManager {
  #modalId = 'histModal';
  #canvasId = 'histCanvas';

  constructor() {}

  init() {
    Chart.register(...registerables);
    this.#renderModal();
  }

  openModal() {
    const modal = document.getElementById(this.#modalId);
    if (modal) {
      this.#populateControls();
      modal.style.display = 'flex';
      setTimeout(() => this.generate(), 100);
    }
  }

  generate() {
    const fileSelect = document.getElementById('histFileSelect');
    const signalSelect = document.getElementById('histSignalSelect');

    if (!fileSelect || !signalSelect) return;

    const fileIdx = fileSelect.value;
    const signalName = signalSelect.value;
    const binsInput = document.getElementById('histBins');
    const binsCount = binsInput ? parseInt(binsInput.value) || 20 : 20;

    const file = AppState.files[fileIdx];
    if (!file || !file.signals[signalName]) return;

    const dataPoints = file.signals[signalName].map((p) => parseFloat(p.y));
    const min = Math.min(...dataPoints);
    const max = Math.max(...dataPoints);

    const step = (max - min) / binsCount;
    const bins = new Array(binsCount).fill(0);
    const labels = [];

    if (step === 0) {
      bins[0] = dataPoints.length;
      labels.push(min.toFixed(1));
    } else {
      for (let i = 0; i < binsCount; i++) {
        const start = min + i * step;
        const end = min + (i + 1) * step;
        labels.push(`${start.toFixed(1)} - ${end.toFixed(1)}`);
      }

      dataPoints.forEach((val) => {
        let bucket = Math.floor((val - min) / step);
        if (bucket >= binsCount) bucket = binsCount - 1;
        bins[bucket]++;
      });
    }

    this.#drawChart(signalName, labels, bins);
  }

  #drawChart(signalName, labels, bins) {
    const existingChart = Chart.getChart(this.#canvasId);
    if (existingChart) {
      existingChart.destroy();
    }

    const canvas = document.getElementById(this.#canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const isDark = document.body.classList.contains('dark-theme');
    const textColor = isDark ? '#eee' : '#333';

    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
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
            grid: {
              color: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
            },
          },
          x: {
            ticks: { color: textColor, maxRotation: 45, minRotation: 45 },
            grid: { display: false },
          },
        },
        plugins: {
          legend: { labels: { color: textColor } },
          tooltip: {
            callbacks: {
              label: (ctx) => `Samples: ${ctx.raw}`,
            },
          },
        },
      },
    });
  }

  #populateControls() {
    const fileSelect = document.getElementById('histFileSelect');

    if (!AppState.files || AppState.files.length === 0) {
      if (fileSelect) fileSelect.innerHTML = '<option>No files loaded</option>';
      return;
    }

    if (fileSelect) {
      fileSelect.innerHTML = AppState.files
        .map((f, i) => `<option value="${i}">${f.name}</option>`)
        .join('');
      fileSelect.onchange = () => this.#updateSignals();
    }

    this.#updateSignals();
  }

  #updateSignals() {
    const fileSelect = document.getElementById('histFileSelect');
    const sigSelect = document.getElementById('histSignalSelect');
    if (!fileSelect || !sigSelect) return;

    const file = AppState.files[fileSelect.value];
    if (file) {
      sigSelect.innerHTML = file.availableSignals
        .sort()
        .map((s) => `<option value="${s}">${s}</option>`)
        .join('');
    }
  }

  #renderModal() {
    if (document.getElementById(this.#modalId)) return;

    const html = `
    <div id="${this.#modalId}" class="modal-overlay" style="display: none;">
      <div class="modal-content" style="width: 80vw; height: 80vh; display: flex; flex-direction: column;">
        <div class="modal-header">
          <h2><i class="fas fa-chart-bar"></i> Histogram Analysis</h2>
          <button class="btn-close" onclick="document.getElementById('${this.#modalId}').style.display='none'">×</button>
        </div>
        <div class="modal-body" style="flex: 1; display: flex; flex-direction: column; overflow: hidden; padding: 10px;">
            <div style="display: flex; gap: 10px; padding-bottom: 10px; border-bottom: 1px solid #ccc; align-items: center; flex-wrap: wrap;">
                <div style="display:flex; flex-direction: column;">
                    <label style="font-size:0.8em; color:#666">Log File</label>
                    <select id="histFileSelect" class="template-select" style="min-width: 200px;"></select>
                </div>
                <div style="display:flex; flex-direction: column;">
                    <label style="font-size:0.8em; color:#666">Signal</label>
                    <select id="histSignalSelect" class="template-select" style="min-width: 200px;"></select>
                </div>
                <div style="display:flex; flex-direction: column;">
                    <label style="font-size:0.8em; color:#666">Bins</label>
                    <input type="number" id="histBins" value="20" min="5" max="100" style="width: 60px; padding: 5px;">
                </div>
                <button class="btn btn-primary" style="align-self: flex-end;" onclick="import('./src/histogram.js').then(m => m.Histogram.generate())">Update</button>
            </div>
            <div style="flex: 1; position: relative; min-height: 0; margin-top: 10px; width: 100%;">
                <canvas id="${this.#canvasId}" style="width: 100%; height: 100%;"></canvas>
            </div>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  }
}

export const Histogram = new HistogramManager();
