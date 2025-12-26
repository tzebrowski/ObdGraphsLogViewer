const ChartManager = {
    hoverValue: null,
    activeChartIndex: null,

    render: () => {
        const container = DOM.get('chartContainer');
        if (!container) return;

        AppState.chartInstances.forEach(c => c.destroy());
        AppState.chartInstances = [];
        container.innerHTML = '';

        if (AppState.files.length === 0) {
            AppState.globalStartTime = 0;
            AppState.logDuration = 0;
            return;
        }

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

        // Set a dark background for the canvas itself
        canvas.style.backgroundColor = '#1a1a1a';

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
            const isImportant = DEFAULT_SIGNALS.some(k => key.includes(k));
            const color = CHART_COLORS[idx % CHART_COLORS.length];
            return {
                label: key,
                data: file.signals[key],
                borderColor: color,
                backgroundColor: getAlphaColor(color, 0.25), // Subtle glow fill
                borderWidth: 2,
                pointRadius: 0, // Keeps lines clean
                pointHoverRadius: 4,
                tension: 0.3,   // Smooths out jagged sensor noise
                fill: true,      // Adds the neon "area" look
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
                    legend: {
                        display: true,
                        position: 'top',
                        align: 'end', // Keeps it tucked to the right
                        labels: {
                            boxWidth: 12,
                            padding: 10,
                            font: {
                                size: 11
                            },
                            filter: (item) => {
                                const checkbox = document.querySelector(`#signalList input[data-key="${item.text}"]`);
                                return checkbox ? checkbox.checked : false;
                            }
                        }
                    },
                    tooltip: {
                        enabled: true,
                        mode: 'index',
                        intersect: false,
                        backgroundColor: '#222',
                        titleColor: '#fff',
                        bodyColor: '#eee',
                        borderColor: '#444',
                        borderWidth: 1,
                        padding: 10,
                        bodyFont: { family: 'monospace' }, // Monospace looks "techy" for data
                        position: 'nearest',
                        callbacks: {
                            label: (c) => ` ${c.dataset.label}: ${Number(c.parsed.y).toFixed(2)}`
                        }
                    },
                    zoom: {
                        pan: {
                            enabled: true,
                            mode: 'x', // Only pan left/right
                            threshold: 10, // Minimum drag distance
                            onPan: ChartManager.syncAll // Keeps charts aligned
                        },
                        zoom: {
                            wheel: {
                                enabled: true, // Mouse wheel to zoom
                                speed: 0.1
                            },
                            pinch: {
                                enabled: true // Touch support
                            },
                            mode: 'x', // Only zoom time axis
                            onZoom: ChartManager.syncAll // Keeps charts aligned
                        }
                    },
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

            ChartManager.hoverValue = (chart.scales.x.min + chart.scales.x.max) / 2;
            ChartManager.activeChartIndex = index;
            ChartManager.syncAll({ chart });
            chart.draw();
        });
    },

    highlighterPlugin: {
        id: 'anomalyHighlighter',
        afterDraw(chart) {
            const { ctx, chartArea: { top, bottom, left, right }, scales: { x } } = chart;
            const chartIdx = AppState.chartInstances.indexOf(chart);

            if (chartIdx === -1) return;

            ctx.save();

            if (AppState.activeHighlight && AppState.activeHighlight.targetIndex === chartIdx) {
                const file = AppState.files[chartIdx];

                const pxStart = x.getPixelForValue(file.startTime + (AppState.activeHighlight.start * 1000));
                const pxEnd = x.getPixelForValue(file.startTime + (AppState.activeHighlight.end * 1000));

                const visibleXStart = Math.max(pxStart, left);
                const visibleXEnd = Math.min(pxEnd, right);
                const drawWidth = visibleXEnd - visibleXStart;

                if (drawWidth > 0) {
                    ctx.fillStyle = 'rgba(255, 0, 0, 0.08)';
                    ctx.fillRect(visibleXStart, top, drawWidth, bottom - top);

                    ctx.strokeStyle = 'rgba(255, 0, 0, 0.4)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 4]);

                    if (pxStart >= left && pxStart <= right) {
                        ctx.beginPath(); ctx.moveTo(pxStart, top); ctx.lineTo(pxStart, bottom); ctx.stroke();
                    }
                    if (pxEnd >= left && pxEnd <= right) {
                        ctx.beginPath(); ctx.moveTo(pxEnd, top); ctx.lineTo(pxEnd, bottom); ctx.stroke();
                    }
                }
            }

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
        AppState.activeHighlight = {
            start: startSec,
            end: endSec,
            targetIndex: targetIndex
        };

        if (targetIndex !== null && AppState.chartInstances[targetIndex]) {
            const chart = AppState.chartInstances[targetIndex];
            const file = AppState.files[targetIndex];

            const duration = endSec - startSec;
            const padding = duration * 4.0;

            const viewMin = Math.max(0, startSec - padding);
            const viewMax = Math.min(file.duration, endSec + padding);

            chart.options.scales.x.min = file.startTime + (viewMin * 1000);
            chart.options.scales.x.max = file.startTime + (viewMax * 1000);
            chart.update('none');
        }

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
        AppState.activeHighlight = null;
        document.querySelectorAll('.result-item').forEach(el => el.classList.remove('selected'));

        AppState.chartInstances.forEach((chart, idx) => {
            const file = AppState.files[idx];
            if (file) {
                chart.options.scales.x.min = file.startTime;
                chart.options.scales.x.max = file.startTime + (file.duration * 1000);
                chart.update('none');
            }
        });

        if (AppState.files.length > 0) {
            Sliders.init(AppState.files[0].duration);
        }
    },
};