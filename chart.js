/**
 * chart.js
 * Manages the Chart.js instance, keyboard navigation, 
 * and the dynamic traveling highlighter.
 */

const ChartManager = {
    hoverValue: null, // Tracks the current time position of the traveling cursor

    /**
     * Renders or updates the telemetry chart
     */
    render: () => {
        const canvas = DOM.get('telemetryChart');
        if (!canvas) {
            console.error("ChartManager: Canvas 'telemetryChart' not found.");
            return;
        }
        const ctx = canvas.getContext('2d');

        // Enable keyboard focus for the canvas
        canvas.tabIndex = 0; 
        ChartManager.initKeyboardControls(canvas);
        ChartManager.initHoverTracking(canvas);

        if (AppState.chartInstance) {
            AppState.chartInstance.destroy();
        }

        // Map AppState signals to Chart.js datasets
        const datasets = AppState.availableSignals.map((key, idx) => {
            const isImportant = ["Boost", "RPM", "Pedal", "Trim", "Advance"].some(k => key.includes(k));
            return {
                label: key,
                data: AppState.signals[key],
                borderColor: CHART_COLORS[idx % CHART_COLORS.length],
                borderWidth: 2,
                pointRadius: 0,
                hidden: !isImportant
            };
        });

        const startT = AppState.globalStartTime;
        const endT = startT + (AppState.logDuration * 1000);

        AppState.chartInstance = new Chart(ctx, {
            type: 'line',
            data: { datasets },
            plugins: [ChartManager.highlighterPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'second', displayFormats: { second: 'mm:ss' } },
                        min: startT,
                        max: endT,
                        ticks: { maxRotation: 0 }
                    },
                    y: { position: 'left' }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { 
                        enabled: true,
                        callbacks: { label: c => ` ${c.dataset.label}: ${Number(c.parsed.y).toFixed(2)}` } 
                    },
                    zoom: {
                        limits: { x: { min: startT, max: endT, minRange: 1000 } },
                        pan: { enabled: true, mode: 'x', onPan: Sliders.syncFromChart },
                        zoom: { 
                            wheel: { enabled: true }, 
                            mode: 'x', 
                            onZoom: Sliders.syncFromChart 
                        }
                    }
                }
            }
        });
    },

    /**
     * Mouse tracking for the traveling cursor
     */
    initHoverTracking: (canvas) => {
        canvas.addEventListener('mousemove', (e) => {
            if (!AppState.chartInstance) return;
            const chart = AppState.chartInstance;
            const xValue = chart.scales.x.getValueForPixel(e.offsetX);
            
            ChartManager.hoverValue = xValue;
            chart.draw(); // Use draw() for high-performance cursor updates
        });

        canvas.addEventListener('mouseleave', () => {
            ChartManager.hoverValue = null;
            if (AppState.chartInstance) AppState.chartInstance.draw();
        });
    },

    /**
     * Keyboard navigation: Arrow keys to pan, +/- to zoom, R to reset
     */
    initKeyboardControls: (canvas) => {
        canvas.addEventListener('keydown', (e) => {
            if (!AppState.chartInstance) return;

            const chart = AppState.chartInstance;
            const xScale = chart.scales.x;
            const amount = e.shiftKey ? 0.05 : 0.01; // Pan 5% or 1% of width

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
                    ChartManager.hoverValue = null;
                    return;
                default:
                    return; 
            }

            // Keep highlighter synced to the center of the view during keyboard navigation
            ChartManager.hoverValue = (xScale.min + xScale.max) / 2;
            
            // Sync external sliders and redraw
            Sliders.syncFromChart({ chart });
            chart.draw();
        });
    },

    /**
     * Custom plugin to draw the traveling cursor and scanner selection
     */
    highlighterPlugin: {
        id: 'anomalyHighlighter',
        afterDraw(chart) {
            const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
            ctx.save();

            // 1. Draw Scanner Selection (Static dashed box)
            if (AppState.activeHighlight) {
                const startVal = AppState.globalStartTime + (AppState.activeHighlight.start * 1000);
                const endVal = AppState.globalStartTime + (AppState.activeHighlight.end * 1000);
                const x1 = x.getPixelForValue(startVal);
                const x2 = x.getPixelForValue(endVal);

                ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
                ctx.fillRect(x1, top, x2 - x1, bottom - top);
                ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
                ctx.setLineDash([5, 5]);
                ctx.strokeRect(x1, top, x2 - x1, bottom - top);
            }

            // 2. Draw Traveling Cursor (Solid line with timestamp)
            if (ChartManager.hoverValue) {
                const xPixel = x.getPixelForValue(ChartManager.hoverValue);
                if (xPixel >= chart.chartArea.left && xPixel <= chart.chartArea.right) {
                    ctx.beginPath();
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([]); // Solid line
                    ctx.moveTo(xPixel, top);
                    ctx.lineTo(xPixel, bottom);
                    ctx.stroke();

                    // Display timestamp
                    const timeSec = (ChartManager.hoverValue - AppState.globalStartTime) / 1000;
                    ctx.fillStyle = '#000';
                    ctx.font = 'bold 11px sans-serif';
                    ctx.fillText(`${timeSec.toFixed(2)}s`, xPixel + 5, top + 15);
                }
            }
            ctx.restore();
        }
    }
};

const Sliders = {
    // Dynamic accessors to ensure DOM elements exist when called
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

    zoomTo: (startSec, endSec) => {
        AppState.activeHighlight = { start: startSec, end: endSec };
        const { start, end } = Sliders.els;
        if (start && end) {
            start.value = Math.max(0, startSec - 1.0);
            end.value = Math.min(AppState.logDuration, endSec + 1.0);
            Sliders.updateUI(true);
        }
    },

    reset: () => {
        AppState.activeHighlight = null;
        document.querySelectorAll('.result-item').forEach(el => el.classList.remove('selected'));
        Sliders.init(AppState.logDuration);
        Sliders.updateUI(true);
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
        
        // Handle handle crossing
        if (v1 > v2) { 
            [v1, v2] = [v2, v1]; 
            start.value = v1; 
            end.value = v2; 
        }

        Sliders.updateVis(v1, v2);

        if (shouldUpdateChart && AppState.chartInstance) {
            AppState.chartInstance.options.scales.x.min = AppState.globalStartTime + (v1 * 1000);
            AppState.chartInstance.options.scales.x.max = AppState.globalStartTime + (v2 * 1000);
            AppState.chartInstance.update('none');
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
    }
};