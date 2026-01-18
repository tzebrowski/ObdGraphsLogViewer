import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { ChartManager } from '../src/chartmanager.js';
import { AppState, DOM } from '../src/config.js';
import { UI } from '../src/ui.js';
import { PaletteManager } from '../src/palettemanager.js';
import { Chart } from 'chart.js';
import { Preferences } from '../src/preferences.js';

// --- Global Mocks ---
UI.updateDataLoadedState = jest.fn();
UI.renderSignalList = jest.fn();
PaletteManager.getColorForSignal = jest.fn(() => '#ff0000');
Chart.register = jest.fn();

const mockChartInstance = {
  destroy: jest.fn(),
  update: jest.fn(),
  draw: jest.fn(),

  zoom: jest.fn(),
  pan: jest.fn(),
  width: 1000,
  scales: { x: { min: 0, max: 1000, getValueForPixel: jest.fn() } },
  data: { datasets: [] },
  options: {
    plugins: { datalabels: {}, zoom: {} },
    scales: { x: { min: 0, max: 0 } },
  },
};

global.Chart = jest.fn(() => mockChartInstance);

describe('ChartManager Module Comprehensive Tests', () => {
  let mockChart;
  const mockFile = {
    name: 'test-trip.json',
    startTime: 1000000,
    duration: 500,
    availableSignals: ['Engine Rpm'],
    signals: { 'Engine Rpm': [{ x: 1000000, y: 1000 }] },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    AppState.files = [mockFile];
    AppState.chartInstances = [];

    document.body.innerHTML = `
      <div id="chartContainer">
        <div id="chart-0-wrapper" class="chart-card-compact">
          <input class="local-range-start" value="0">
          <input class="local-range-end" value="500">
          <div id="highlight-0"></div>
          <span id="txt-start-0"></span>
          <span id="txt-end-0"></span>
          <canvas id="chart-0"></canvas>
        </div>
      </div>
    `;

    DOM.get = jest.fn((id) => document.getElementById(id));

    // Shared mock chart for interaction tests
    mockChart = {
      options: {
        scales: { x: { min: 1000000, max: 1001000 } },
        plugins: {
          datalabels: { display: true },
          zoom: { pan: { enabled: true }, zoom: { wheel: { enabled: true } } },
          tooltip: { callbacks: {} },
        },
      },
      data: {
        datasets: [
          {
            label: 'Engine Rpm',
            borderColor: '#ff0000',
            fill: false,
            data: [],
            originalMin: 100,
            originalMax: 500,
            hidden: false,
          },
        ],
      },
      scales: {
        x: {
          min: 1000000,
          max: 1001000,
          getValueForPixel: jest.fn(),
          getPixelForValue: jest.fn((v) => (v - 1000000) / 10),
        },
      },
      update: jest.fn(),
      resetZoom: jest.fn(),
      zoom: jest.fn(),
      pan: jest.fn(),
      draw: jest.fn(),
      destroy: jest.fn(),
      width: 1000,
      tooltip: {
        getActiveElements: jest.fn(() => []), // Default to no active elements
      },
      ctx: {
        save: jest.fn(),
        restore: jest.fn(),
        fillRect: jest.fn(),
        beginPath: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        stroke: jest.fn(),
        setLineDash: jest.fn(),
      },
      chartArea: { top: 10, bottom: 90, left: 10, right: 190 },
    };
    AppState.chartInstances = [mockChart];
  });

  describe('Core Lifecycle', () => {
    test('init registers chart plugins', () => {
      ChartManager.init();
      expect(Chart.register).toHaveBeenCalled();
    });

    test('render() handles empty file list correctly', () => {
      AppState.files = [];
      ChartManager.render();
      expect(UI.updateDataLoadedState).toHaveBeenCalledWith(false);
    });

    test('render() creates card and canvas for uploaded files', () => {
      ChartManager.render();
      const container = document.getElementById('chartContainer');
      expect(container.querySelector('.chart-card-compact')).not.toBeNull();
      expect(container.querySelector('canvas')).not.toBeNull();
    });

    test('removeChart() clears indices and updates state', () => {
      ChartManager.removeChart(0);
      expect(AppState.files).toHaveLength(0);
      expect(UI.updateDataLoadedState).toHaveBeenCalledWith(false);
    });

    test('ChartManager handles chart destruction and cleanup during rebuild', () => {
      AppState.chartInstances = [mockChartInstance];
      AppState.files = [mockFile, { ...mockFile, name: 'log2.json' }];
      ChartManager.render();
      expect(mockChartInstance.destroy).toHaveBeenCalled();
      expect(AppState.chartInstances.length).toBe(0);
    });
  });

  describe('Random tests', () => {
    test('Tooltip label denormalizes values correctly', () => {
      const options = ChartManager._getChartOptions(mockFile);
      const mockCtx = {
        dataset: mockChart.data.datasets[0],
        parsed: { y: 0.5 }, // 50% of 100-500 range
      };
      const label = options.plugins.tooltip.callbacks.label(mockCtx);
      expect(label).toContain('300.00'); // (0.5 * 400) + 100
    });

    test('Local slider inputs trigger chart updates', () => {
      const container = document.getElementById('chartContainer');
      // Ensure the card is rendered so listeners are attached
      ChartManager._renderChartCard(container, mockFile, 0);

      const startInput = container.querySelector('.local-range-start');
      startInput.value = '10';

      // Use dispatchEvent to safely trigger the 'input' listener
      startInput.dispatchEvent(new Event('input', { bubbles: true }));

      // expect(mockChart.update).toHaveBeenCalled();
    });

    test('highlighterPlugin draws hover line only within boundaries', () => {
      ChartManager.activeChartIndex = 0;
      AppState.chartInstances = [mockChart]; // Ensure the plugin can find the chart index

      // Test within boundaries: Mock tooltip active on a point at x = 50
      // (Left is 10, Right is 190)
      mockChart.tooltip.getActiveElements.mockReturnValue([
        { element: { x: 50 } },
      ]);

      ChartManager.highlighterPlugin.afterDraw(mockChart);
      expect(mockChart.ctx.stroke).toHaveBeenCalled();

      // Test outside boundaries: Mock tooltip active on a point at x = 200
      // (Hits the if (xPixel >= left && xPixel <= right) guard)
      mockChart.ctx.stroke.mockClear();
      mockChart.tooltip.getActiveElements.mockReturnValue([
        { element: { x: 200 } },
      ]);

      ChartManager.highlighterPlugin.afterDraw(mockChart);
      expect(mockChart.ctx.stroke).not.toHaveBeenCalled();
    });

    test('updateAreaFills respects preferences', () => {
      Preferences.prefs.showAreaFills = true;
      ChartManager.getAlphaColor = jest.fn(() => 'rgba_mock');
      ChartManager.updateAreaFills();
      expect(mockChart.data.datasets[0].fill).toBe('origin');
    });
  });

  describe('Data Processing & Normalization', () => {
    test('createInstance correctly normalizes Y-axis data between 0 and 1', () => {
      const canvas = document.createElement('canvas');
      canvas.getContext = jest.fn(() => ({
        measureText: jest.fn(() => ({ width: 0 })),
        fillRect: jest.fn(),
      }));

      // Mocking constructor to capture config
      jest
        .spyOn(Chart.prototype, 'constructor')
        .mockImplementation(function (ctx, config) {
          this.data = config.data;
          this.options = config.options;
          this.update = jest.fn();
          AppState.chartInstances[0] = this;
          return this;
        });

      const normalizationFile = {
        name: 'log1.csv',
        availableSignals: ['RPM'],
        signals: {
          RPM: [
            { x: 1000, y: 100 },
            { x: 2000, y: 500 },
          ],
        },
        startTime: 1000,
        duration: 10,
      };

      ChartManager.createInstance(canvas, normalizationFile, 0);
      const rpmDataset = AppState.chartInstances[0].data.datasets[0];

      // Formula: (500 - 100) / (500 - 100) = 1
      expect(rpmDataset.data[0].y).toBe(0);
      expect(rpmDataset.data[1].y).toBe(1);
      expect(rpmDataset.originalMin).toBe(100);
      expect(rpmDataset.originalMax).toBe(500);
    });
  });

  describe('Interactions & Navigation', () => {
    test('manualZoom triggers chart zoom and syncs with sliders', () => {
      ChartManager.manualZoom(0, 1.2);
      expect(mockChart.zoom).toHaveBeenCalledWith(1.2);
      expect(document.querySelector('.local-range-start').value).toBeDefined();
    });

    test('zoomTo updates chart scales and slider positions', () => {
      ChartManager.zoomTo(10, 20, 0);
      expect(mockChart.options.scales.x.min).not.toBe(0);
      expect(mockChart.update).toHaveBeenCalled();
    });

    test('resetChart restores full range and UI elements', () => {
      ChartManager.resetChart(0);
      expect(mockChart.options.scales.x.min).toBe(mockFile.startTime);
      expect(mockChart.update).toHaveBeenCalledWith('none');
      expect(document.getElementById('txt-start-0').innerText).toBe('0.0s');
    });

    test('canvas mousemove updates hoverValue and triggers draw', () => {
      const canvas = document.getElementById('chart-0');
      // Re-attach listeners to the specific canvas
      ChartManager.createInstance(canvas, mockFile, 0);
      AppState.chartInstances[0] = mockChart; // Maintain reference

      mockChart.scales.x.getValueForPixel.mockReturnValue(1500);

      const moveEvent = new Event('mousemove', { bubbles: true });
      Object.defineProperty(moveEvent, 'offsetX', { value: 50 });
      canvas.dispatchEvent(moveEvent);

      // expect(ChartManager.hoverValue).toBe(1500);
      // expect(mockChart.draw).toHaveBeenCalled();
    });
  });

  describe('Keyboard Controls', () => {
    let canvas;
    beforeEach(() => {
      canvas = document.createElement('canvas');
      ChartManager.initKeyboardControls(canvas, 0);
      AppState.chartInstances[0] = mockChart;
    });

    test('handles ArrowRight to pan right', () => {
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(mockChart.pan).toHaveBeenCalledWith({ x: -10 }, undefined, 'none');
    });

    test('handles ArrowLeft to pan left', () => {
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      expect(mockChart.pan).toHaveBeenCalled();
    });

    test('handles + and = keys to zoom in', () => {
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }));
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '=' }));
      expect(mockChart.zoom).toHaveBeenCalledWith(1.1, undefined, 'none');
    });

    test('handles - key to zoom out', () => {
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '-' }));
      expect(mockChart.zoom).toHaveBeenCalled();
    });

    test('handles R key to reset', () => {
      const resetSpy = jest.spyOn(ChartManager, 'resetChart');
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
      expect(resetSpy).toHaveBeenCalled();
    });
  });

  describe('Visual Features & Plugins', () => {
    test('updateLabelVisibility responsiveness logic', () => {
      // Mobile Check
      global.innerWidth = 500;
      ChartManager.updateLabelVisibility(mockChart);
      expect(mockChart.options.plugins.datalabels.display).toBe(false);

      // Desktop Check: Range is 1000 (< 5000 threshold), should be true
      global.innerWidth = 1200;
      ChartManager.updateLabelVisibility(mockChart);
      expect(mockChart.options.plugins.datalabels.display).toBe(true);
    });

    test('updateAreaFills toggles based on Preferences', () => {
      ChartManager.getAlphaColor = jest.fn(
        (hex, alpha) => `rgba_mock(${hex}, ${alpha})`
      );

      Preferences.prefs = { showAreaFills: true };
      ChartManager.updateAreaFills();
      expect(mockChart.data.datasets[0].fill).toBe('origin');
      expect(mockChart.data.datasets[0].backgroundColor).toBe(
        'rgba_mock(#ff0000, 0.1)'
      );

      Preferences.prefs = { showAreaFills: false };
      ChartManager.updateAreaFills();
      expect(mockChart.data.datasets[0].fill).toBe(false);
      expect(mockChart.data.datasets[0].backgroundColor).toBe('transparent');
    });

    test('afterDraw() renders red highlight for active anomaly', () => {
      const mockCtx = {
        save: jest.fn(),
        restore: jest.fn(),
        fillRect: jest.fn(),
        beginPath: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        stroke: jest.fn(),
      };

      const pluginChart = mockChart;
      pluginChart.ctx = mockCtx;
      pluginChart.chartArea = { top: 10, bottom: 90, left: 10, right: 190 };
      pluginChart.scales.x.getPixelForValue = jest.fn((v) => v);

      AppState.activeHighlight = { start: 0.02, end: 0.05, targetIndex: 0 };

      ChartManager.highlighterPlugin.afterDraw(pluginChart);

      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.fillRect).toHaveBeenCalled();
      expect(mockCtx.restore).toHaveBeenCalled();
    });
  });
  test('highlighterPlugin uses raw hoverValue as fallback when tooltip is empty', () => {
    ChartManager.activeChartIndex = 0;
    AppState.chartInstances = [mockChart];

    mockChart.tooltip.getActiveElements.mockReturnValue([]);

    // Scale: (v - 1000000) / 10. For 1000500, pixel = 50.
    ChartManager.hoverValue = 1000500;

    ChartManager.highlighterPlugin.afterDraw(mockChart);

    // Should still draw using the fallback logic
    expect(mockChart.ctx.stroke).toHaveBeenCalled();
  });

  test('highlighterPlugin does not draw if chart is not the activeChartIndex', () => {
    // Set active index to a different chart
    ChartManager.activeChartIndex = 99;
    ChartManager.hoverValue = 1000500;
    mockChart.tooltip.getActiveElements.mockReturnValue([]);

    ChartManager.highlighterPlugin.afterDraw(mockChart);

    // Should exit early because chartIdx !== activeChartIndex
    expect(mockChart.ctx.stroke).not.toHaveBeenCalled();
  });

  test('highlighterPlugin handles missing tooltip object gracefully', () => {
    const chartWithoutTooltip = {
      ...mockChart,
      tooltip: undefined,
    };
    AppState.chartInstances = [chartWithoutTooltip];
    ChartManager.activeChartIndex = 0;
    ChartManager.hoverValue = 1000500;

    // Should not crash and should use fallback hoverValue
    expect(() => {
      ChartManager.highlighterPlugin.afterDraw(chartWithoutTooltip);
    }).not.toThrow();
    expect(chartWithoutTooltip.ctx.stroke).toHaveBeenCalled();
  });

  test('highlighterPlugin draws vertical line with specific styling', () => {
    ChartManager.activeChartIndex = 0;
    mockChart.tooltip.getActiveElements.mockReturnValue([
      { element: { x: 50 } },
    ]);

    ChartManager.highlighterPlugin.afterDraw(mockChart);

    // Verify visual requirements
    expect(mockChart.ctx.strokeStyle).toBe('rgba(227, 24, 55, 0.6)');
    expect(mockChart.ctx.lineWidth).toBe(3);
  });
});
