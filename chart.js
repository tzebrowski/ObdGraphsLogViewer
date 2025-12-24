const ChartManager = {
    render: () => {
        if (AppState.chartInstance) AppState.chartInstance.destroy();

        let cIdx = 0;
        const datasets = AppState.availableSignals.map(key => {
            const isImportant = ["Boost", "RPM", "Pedal", "Trim", "Advance"].some(k => key.includes(k));
            return {
                label: key,
                data: AppState.signals[key],
                borderColor: CHART_COLORS[cIdx++ % CHART_COLORS.length],
                borderWidth: 2,
                pointRadius: 0,
                hidden: !isImportant
            };
        });

        const startT = AppState.globalStartTime;
        const endT = startT + (AppState.logDuration * 1000);

        AppState.chartInstance = new Chart(DOM.chartCtx, {
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
                        min: startT, max: endT,
                        ticks: { maxRotation: 0 }
                    },
                    y: { position: 'left' }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${Number(c.parsed.y).toFixed(2)}` } },
                    zoom: {
                        limits: { x: { min: startT, max: endT, minRange: 1000 } },
                        pan: { enabled: true, mode: 'x', onPan: Sliders.syncFromChart },
                        zoom: { wheel: { enabled: true }, mode: 'x', drag: { enabled: false }, onZoom: Sliders.syncFromChart }
                    }
                }
            }
        });
    },

    highlighterPlugin: {
        id: 'anomalyHighlighter',
        beforeDatasetsDraw(chart) {
            if (!AppState.activeHighlight) return;
            const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
            const startVal = AppState.globalStartTime + (AppState.activeHighlight.start * 1000);
            const endVal = AppState.globalStartTime + (AppState.activeHighlight.end * 1000);
            
            const x1 = x.getPixelForValue(startVal);
            const x2 = x.getPixelForValue(endVal);

            ctx.save();
            ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
            ctx.fillRect(x1, top, x2 - x1, bottom - top);
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.6)';
            ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(x1, top); ctx.lineTo(x1, bottom);
            ctx.moveTo(x2, top); ctx.lineTo(x2, bottom);
            ctx.stroke();
            ctx.restore();
        }
    }
};

const Sliders = {
    startEl: DOM.get('rangeStart'),
    endEl: DOM.get('rangeEnd'),
    txtStart: DOM.get('txtStart'),
    txtEnd: DOM.get('txtEnd'),
    bar: DOM.get('sliderHighlight'),

    init: (maxDuration) => {
        Sliders.startEl.max = maxDuration;
        Sliders.endEl.max = maxDuration;
        Sliders.startEl.value = 0;
        Sliders.endEl.value = maxDuration;
        Sliders.updateUI(false);
    },

    zoomTo: (startSec, endSec) => {
        AppState.activeHighlight = { start: startSec, end: endSec };
        let s = Math.max(0, startSec - 1.0);
        let e = Math.min(AppState.logDuration, endSec + 1.0);
        Sliders.startEl.value = s;
        Sliders.endEl.value = e;
        Sliders.updateUI(true);
    },

    reset: () => {
        AppState.activeHighlight = null;
        document.querySelectorAll('.result-item').forEach(el => el.classList.remove('selected'));
        Sliders.init(AppState.logDuration);
        Sliders.updateUI(true);
    },

    syncFromChart: ({ chart }) => {
        const minVal = chart.scales.x.min;
        const maxVal = chart.scales.x.max;
        const s = Math.max(0, (minVal - AppState.globalStartTime) / 1000);
        const e = Math.min(AppState.logDuration, (maxVal - AppState.globalStartTime) / 1000);
        Sliders.startEl.value = s;
        Sliders.endEl.value = e;
        Sliders.updateVis(s, e);
    },

    updateFromInput: () => Sliders.updateUI(true),

    updateUI: (shouldUpdateChart) => {
        let v1 = parseFloat(Sliders.startEl.value);
        let v2 = parseFloat(Sliders.endEl.value);
        if (v1 > v2) { [v1, v2] = [v2, v1]; Sliders.startEl.value = v1; Sliders.endEl.value = v2; }

        Sliders.updateVis(v1, v2);

        if (shouldUpdateChart && AppState.chartInstance) {
            AppState.chartInstance.options.scales.x.min = AppState.globalStartTime + (v1 * 1000);
            AppState.chartInstance.options.scales.x.max = AppState.globalStartTime + (v2 * 1000);
            AppState.chartInstance.update('none'); 
        }
    },

    updateVis: (start, end) => {
        Sliders.txtStart.innerText = start.toFixed(1) + 's';
        Sliders.txtEnd.innerText = end.toFixed(1) + 's';
        const total = parseFloat(Sliders.startEl.max) || 100;
        Sliders.bar.style.left = ((start / total) * 100) + "%";
        Sliders.bar.style.width = (((end - start) / total) * 100) + "%";
    }
};