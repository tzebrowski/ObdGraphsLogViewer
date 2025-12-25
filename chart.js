/**
 * chart.js
 * Independent timelines per chart with optional synchronization.
 */
const ChartManager = {
    hoverValue: null,
    activeChartIndex: null,

    render: () => {
        const container = DOM.get('chartContainer');
        if (!container) return;

        AppState.chartInstances.forEach(c => c.destroy());
        AppState.chartInstances = [];
        container.innerHTML = '';

        if (AppState.files.length === 0) return;

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
            ChartManager.initKeyboardControls(canvas, idx); // Pass index for context
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
                maintainAspectRatio: false, // Stretch vertically
                animation: false,
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
        const min = chart.scales.x.min;
        const max = chart.scales.x.max;
        AppState.chartInstances.forEach(other => {
            // if (other === chart) return;
            // other.options.scales.x.min = min;
            // other.options.scales.x.max = max;
            // other.update('none');
        });
        if (typeof Sliders !== 'undefined') Sliders.syncFromChart({ chart });
    },

    initKeyboardControls: (canvas, index) => {
        canvas.addEventListener('keydown', (e) => {
            const chart = AppState.chartInstances[index];
            if (!chart) return;

            const amount = e.shiftKey ? 0.05 : 0.01;
            const xScale = chart.scales.x;

            switch (e.key) {
                case 'ArrowLeft':
                    chart.pan({ x: chart.width * amount }, undefined, 'none');
                    break;
                case 'ArrowRight':
                    chart.pan({ x: -chart.width * amount }, undefined, 'none');
                    break;
                case '+':
                case '=':
                    chart.zoom(1.1, undefined, 'none');
                    break;
                case '-':
                case '_':
                    chart.zoom(0.9, undefined, 'none');
                    break;
                case 'r':
                case 'R':
                    Sliders.reset();
                    return;
            }

            // Move the pipe to the center of the new view during keyboard nav
            ChartManager.hoverValue = (xScale.min + xScale.max) / 2;
            ChartManager.activeChartIndex = index;

            // Sync all charts and force redraw of marker
            ChartManager.syncAll({ chart });
            chart.draw();
        });
    },

    highlighterPlugin: {
        id: 'anomalyHighlighter',
        afterDraw(chart) {
            const chartIdx = AppState.chartInstances.indexOf(chart);
            if (chartIdx === -1 || ChartManager.activeChartIndex !== chartIdx || !ChartManager.hoverValue) return;

            const file = AppState.files[chartIdx];
            if (!file) return;

            const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
            ctx.save();
            const xPixel = x.getPixelForValue(ChartManager.hoverValue);

            if (xPixel >= chart.chartArea.left && xPixel <= chart.chartArea.right) {
                ctx.beginPath();
                ctx.strokeStyle = '#9a0000';
                ctx.lineWidth = 2;
                ctx.moveTo(xPixel, top);
                ctx.lineTo(xPixel, bottom);
                ctx.stroke();

                const timeSec = (ChartManager.hoverValue - file.startTime) / 1000;
                ctx.fillStyle = '#000';
                ctx.font = 'bold 10px sans-serif';
                ctx.fillText(`${timeSec.toFixed(2)}s`, xPixel + 5, top + 12);
            }
            ctx.restore();
        }
    },
};

const Sliders = {
    get els() { return { start: DOM.get('rangeStart'), end: DOM.get('rangeEnd'), txtStart: DOM.get('txtStart'), txtEnd: DOM.get('txtEnd'), bar: DOM.get('sliderHighlight') }; },
    init: (maxDuration) => {
        const { start, end } = Sliders.els;
        if (!start || !end) return;
        start.max = maxDuration;
        end.max = maxDuration;
        Sliders.updateUI(false);
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
        Sliders.init(AppState.logDuration);
        Sliders.updateUI(true);
    }
};