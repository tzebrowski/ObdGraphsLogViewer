const ChartManager = {
    hoverValue: null,
    activeChartIndex: null,

    render: () => {
        const container = DOM.get('chartContainer');
        if (!container) return;

        // Cleanup existing instances
        AppState.chartInstances.forEach(c => c.destroy());
        AppState.chartInstances = [];
        container.innerHTML = '';

        if (AppState.files.length === 0) {
            AppState.globalStartTime = 0;
            AppState.logDuration = 0;
            return;
        }

        // Re-sync Global Reference (Primary File)
        const primary = AppState.files[0];
        AppState.globalStartTime = primary.startTime;
        AppState.logDuration = primary.duration;

        AppState.files.forEach((file, idx) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'chart-card-compact';
            wrapper.innerHTML = `
                <div class="chart-header-sm">
                    <span class="chart-name">${file.name}</span>
                    <button class="btn-remove" onclick="ChartManager.removeFile(${idx})">×</button>
                </div>
                <div class="canvas-wrapper">
                    <canvas id="chart-${idx}" tabindex="0"></canvas>
                </div>
            `;
            container.appendChild(wrapper);

            const canvas = document.getElementById(`chart-${idx}`);
            ChartManager.createInstance(canvas, file, idx);
            ChartManager.initKeyboardControls(canvas, idx);
        });

        if (typeof Sliders !== 'undefined') Sliders.init(AppState.logDuration);
    },

    createInstance: (canvas, file, index) => {
        const ctx = canvas.getContext('2d');

        canvas.addEventListener('mousemove', (e) => {
            const chart = AppState.chartInstances[index];
            if (!chart) return;

            const prevIndex = ChartManager.activeChartIndex;
            ChartManager.hoverValue = chart.scales.x.getValueForPixel(e.offsetX);
            ChartManager.activeChartIndex = index;

            chart.draw();
            if (prevIndex !== null && prevIndex !== index && AppState.chartInstances[prevIndex]) {
                AppState.chartInstances[prevIndex].draw();
            }
        });

        canvas.addEventListener('mouseleave', () => {
            const prevIndex = ChartManager.activeChartIndex;
            ChartManager.hoverValue = null;
            ChartManager.activeChartIndex = null;
            if (prevIndex !== null && AppState.chartInstances[prevIndex]) {
                AppState.chartInstances[prevIndex].draw();
            }
        });

        const datasets = file.availableSignals.map((key, idx) => {
            const isImportant = ["Boost", "RPM", "Pedal", "Trim", "Advance"].some(k => key.includes(k));
            return {
                label: key,
                data: file.signals[key],
                borderColor: CHART_COLORS[idx % CHART_COLORS.length],
                borderWidth: 1.5,
                pointRadius: 0,
                hidden: !isImportant
            };
        });

        const chart = new Chart(ctx, {
            type: 'line',
            data: { datasets },
            plugins: [ChartManager.highlighterPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false, // Stretch to share height
                animation: false,
                interaction: {
                    mode: 'index',      // Shows all signal values in the "menu"
                    intersect: false    // Triggers tooltip without needing to hover a specific dot
                },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'second', displayFormats: { second: 'mm:ss' } },
                        min: file.startTime,
                        max: file.startTime + (file.duration * 1000)
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: true,
                        position: 'nearest',
                        callbacks: {
                            label: (c) => ` ${c.dataset.label}: ${Number(c.parsed.y).toFixed(2)}`
                        }
                    },
                    zoom: {
                        pan: { enabled: true, mode: 'x', onPan: ChartManager.syncAll },
                        zoom: { wheel: { enabled: true }, mode: 'x', onZoom: ChartManager.syncAll }
                    }
                }
            }
        });
        AppState.chartInstances[index] = chart;
    },

    removeFile: (index) => {
        ChartManager.hoverValue = null;
        ChartManager.activeChartIndex = null;

        AppState.files.splice(index, 1);

        ChartManager.render();
        UI.renderSignalList();
    },

    syncAll: ({ chart }) => {
        if (typeof Sliders !== 'undefined') Sliders.syncFromChart({ chart });
    },

    initKeyboardControls: (canvas, index) => {
        canvas.addEventListener('keydown', (e) => {
            const chart = AppState.chartInstances[index];
            if (!chart) return;

            const amount = e.shiftKey ? 0.05 : 0.01;
            switch (e.key) {
                case 'ArrowLeft': chart.pan({ x: chart.width * amount }, undefined, 'none'); break;
                case 'ArrowRight': chart.pan({ x: -chart.width * amount }, undefined, 'none'); break;
                case '+':
                case '=': chart.zoom(1.1, undefined, 'none'); break;
                case '-':
                case '_': chart.zoom(0.9, undefined, 'none'); break;
                case 'r':
                case 'R': Sliders.reset(); return;
                default: return;
            }

            // Sync pipe to center of view on keyboard move
            ChartManager.hoverValue = (chart.scales.x.min + chart.scales.x.max) / 2;
            ChartManager.activeChartIndex = index;
            ChartManager.syncAll({ chart });
            chart.draw();
        });
    },

    highlighterPlugin: {
        id: 'anomalyHighlighter',
        afterDraw(chart) {
            const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
            const chartIdx = AppState.chartInstances.indexOf(chart);
            ctx.save();

            // Draw Scanner Selection only on the chart that detected the event
            if (AppState.activeHighlight && AppState.activeHighlight.targetIndex === chartIdx) {
                // Calculate pixel values based on the specific file's start time
                const fileStart = AppState.files[chartIdx].startTime;
                const startVal = fileStart + (AppState.activeHighlight.start * 1000);
                const endVal = fileStart + (AppState.activeHighlight.end * 1000);

                const x1 = x.getPixelForValue(startVal);
                const x2 = x.getPixelForValue(endVal);

                ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
                ctx.fillRect(x1, top, x2 - x1, bottom - top);
                ctx.strokeStyle = 'rgba(255, 0, 0, 0.4)';
                ctx.setLineDash([5, 5]);
                ctx.strokeRect(x1, top, x2 - x1, bottom - top);
            }

            // 2. Draw Traveling Cursor (Marker Pipe) - remains localized to mouse
            if (ChartManager.activeChartIndex === chartIdx && ChartManager.hoverValue) {
                const xPixel = x.getPixelForValue(ChartManager.hoverValue);
                if (xPixel >= chart.chartArea.left && xPixel <= chart.chartArea.right) {
                    ctx.beginPath();
                    ctx.strokeStyle = '#9a0000';
                    ctx.lineWidth = 2;
                    ctx.moveTo(xPixel, top);
                    ctx.lineTo(xPixel, bottom);
                    ctx.stroke();
                }
            }
            ctx.restore();
        }
    },
};

const Sliders = {

    get els() {
        return {
            start: DOM.get('rangeStart'),
            end: DOM.get('rangeEnd'),
            txtStart: DOM.get('txtStart'),
            txtEnd: DOM.get('txtEnd'),
            bar: DOM.get('sliderHighlight')
        };
    },

    init: (maxDuration) => {
        const { start, end } = Sliders.els;
        if (!start || !end) return;
        start.max = maxDuration;
        end.max = maxDuration;
        start.value = 0;
        end.value = maxDuration;
        Sliders.updateUI(false);
    },

    zoomTo: (startSec, endSec, targetIndex = null) => {
        // 1. Store the highlight along with the specific chart index it belongs to
        AppState.activeHighlight = {
            start: startSec,
            end: endSec,
            targetIndex: targetIndex
        };

        if (targetIndex !== null && AppState.chartInstances[targetIndex]) {
            const chart = AppState.chartInstances[targetIndex];
            const fileStart = AppState.files[targetIndex].startTime; // Independent start time

            chart.options.scales.x.min = fileStart + (startSec * 1000);
            chart.options.scales.x.max = fileStart + (endSec * 1000);
            chart.update('none'); // Update only this instance
        };

        // 3. Update the physical slider UI
        const { start, end } = Sliders.els;
        if (start && end) {
            start.value = startSec;
            end.value = endSec;
            Sliders.updateVis(startSec, endSec);
        }
    },

    syncFromChart: ({ chart }) => {
        const { start, end } = Sliders.els;
        const s = Math.max(0, (chart.scales.x.min - AppState.globalStartTime) / 1000);
        const e = Math.min(AppState.logDuration, (chart.scales.x.max - AppState.globalStartTime) / 1000);
        if (start) start.value = s;
        if (end) end.value = e;
        Sliders.updateVis(s, e);
    },
    updateFromInput: () => Sliders.updateUI(true),
    updateUI: (shouldUpdateChart) => {
        const { start, end } = Sliders.els;
        if (!start || !end) return;
        let v1 = parseFloat(start.value);
        let v2 = parseFloat(end.value);
        if (v1 > v2) [v1, v2] = [v2, v1];
        Sliders.updateVis(v1, v2);
        if (shouldUpdateChart) {
            AppState.chartInstances.forEach(chart => {
                chart.options.scales.x.min = AppState.globalStartTime + (v1 * 1000);
                chart.options.scales.x.max = AppState.globalStartTime + (v2 * 1000);
                chart.update('none');
            });
        }
    },
    updateVis: (start, end) => {
        const { txtStart, txtEnd, bar, start: startEl } = Sliders.els;
        if (txtStart) txtStart.innerText = start.toFixed(1) + 's';
        if (txtEnd) txtEnd.innerText = end.toFixed(1) + 's';
        const total = parseFloat(startEl?.max) || 100;
        if (bar) {
            bar.style.left = ((start / total) * 100) + "%";
            bar.style.width = (((end - start) / total) * 100) + "%";
        }
    },
    reset: () => {
        // 1. Clear any scanner highlight boxes and selected list items
        AppState.activeHighlight = null;
        document.querySelectorAll('.result-item').forEach(el => el.classList.remove('selected'));

        // 2. Loop through every chart and reset to its specific file duration
        AppState.chartInstances.forEach((chart, idx) => {
            const file = AppState.files[idx];
            if (file) {
                chart.options.scales.x.min = file.startTime;
                chart.options.scales.x.max = file.startTime + (file.duration * 1000);
                chart.update('none');
            }
        });

        // 3. Reset the slider UI based on the primary file
        if (AppState.files.length > 0) {
            Sliders.init(AppState.files[0].duration);
        }
    },
};