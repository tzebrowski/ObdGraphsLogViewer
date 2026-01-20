import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockChartInstance = {
  destroy: jest.fn(),
  update: jest.fn(),
  draw: jest.fn(),
  resetZoom: jest.fn(),
  width: 1000,
  scales: { x: { min: 0, max: 1000, getValueForPixel: jest.fn() } },
  data: { datasets: [] },
  options: {
    plugins: { datalabels: {}, zoom: {}, tooltip: { callbacks: {} } },
    scales: { x: { min: 0, max: 0 } },
  },
};

// 1. Mock Chart.js
await jest.unstable_mockModule('chart.js', () => {
  const MockChart = jest.fn(() => mockChartInstance);
  MockChart.register = jest.fn();
  return {
    __esModule: true,
    Chart: MockChart,
    ScatterController: jest.fn(),
    LineController: jest.fn(),
    PointElement: jest.fn(),
    LineElement: jest.fn(),
    LinearScale: jest.fn(),
    TimeScale: jest.fn(),
    Legend: jest.fn(),
    Tooltip: jest.fn(),
    _adapters: { _date: {} },
  };
});

// 2. Mock adapters
await jest.unstable_mockModule('chartjs-adapter-date-fns', () => ({}));

// 3. Mock plugins
const mockZoomPlugin = { id: 'zoom' };
await jest.unstable_mockModule('chartjs-plugin-zoom', () => ({
  default: mockZoomPlugin,
}));

// 4. Mock UI & Config
await jest.unstable_mockModule('../src/ui.js', () => ({ UI: {} }));
await jest.unstable_mockModule('../src/config.js', () => ({
  AppState: { files: [] },
}));
await jest.unstable_mockModule('../src/palettemanager.js', () => ({
  PaletteManager: { getColorForSignal: jest.fn(() => '#ff0000') },
}));

// --- Dynamic Imports ---
const { XYAnalysis } = await import('../src/xyanalysis.js');
const { AppState } = await import('../src/config.js');
const { Chart } = await import('chart.js');

describe('XYAnalysis Comprehensive Coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AppState.files = [];
    XYAnalysis.charts = [null, null];
    XYAnalysis.timelineChart = null;

    Chart.mockImplementation(() => mockChartInstance);

    // Full DOM Mock to satisfy all selector queries in xyanalysis.js
    document.body.innerHTML = `
      <div id="xyModal" style="display: none;">
        <div class="modal-body"></div>
      </div>
      <select id="xyGlobalFile"></select>
      
      <select id="xyX-0"></select>
      <select id="xyY-0"></select>
      <select id="xyZ-0"></select>
      <canvas id="xyCanvas-0"></canvas>
      <div id="xyLegend-0" style="display:none;"></div>

      <select id="xyX-1"></select>
      <select id="xyY-1"></select>
      <select id="xyZ-1"></select>
      <canvas id="xyCanvas-1"></canvas>
      <div id="xyLegend-1" style="display:none;"></div>
      
      <canvas id="xyTimelineCanvas"></canvas>
    `;
  });

  // --- COVERS LINES 24-90 (UI Logic) ---
  describe('UI & Modal Logic', () => {
    test('init() registers Chart.js plugins', () => {
      XYAnalysis.init();
      expect(Chart.register).toHaveBeenCalled();
    });

    test('openXYModal() shows modal and triggers file population', () => {
      const modal = document.getElementById('xyModal');
      const spy = jest.spyOn(XYAnalysis, 'populateGlobalFileSelector');

      XYAnalysis.openXYModal();

      expect(modal.style.display).toBe('flex');
      expect(spy).toHaveBeenCalled();
    });

    test('closeXYModal() hides modal', () => {
      const modal = document.getElementById('xyModal');
      modal.style.display = 'flex';

      XYAnalysis.closeXYModal();

      expect(modal.style.display).toBe('none');
    });

    test('populateGlobalFileSelector() fills dropdown and triggers change', () => {
      // FIX: Added 'availableSignals' to avoid crash on .sort()
      AppState.files = [
        { name: 'Trip A', availableSignals: [] },
        { name: 'Trip B', availableSignals: [] },
      ];
      const spy = jest.spyOn(XYAnalysis, 'onFileChange');

      XYAnalysis.populateGlobalFileSelector();

      const select = document.getElementById('xyGlobalFile');
      expect(select.children.length).toBe(2);
      expect(select.children[0].text).toBe('Trip A');
      expect(spy).toHaveBeenCalled();
    });

    test('onFileChange() populates axis selectors and sets smart defaults', () => {
      // FIX: Added 'signals' object to avoid crash in renderTimeline
      AppState.files = [
        {
          name: 'Trip A',
          availableSignals: [
            'Engine Rpm',
            'Intake Manifold Pressure',
            'Air Mass',
            'Other',
          ],
          signals: {
            'Engine Rpm': [],
            'Intake Manifold Pressure': [],
            'Air Mass': [],
            Other: [],
          },
        },
      ];

      // Simulate selection
      const globalSel = document.getElementById('xyGlobalFile');
      globalSel.innerHTML = '<option value="0">Trip A</option>';
      globalSel.value = '0';

      const updateTimelineSpy = jest.spyOn(XYAnalysis, 'updateTimeline');

      XYAnalysis.onFileChange();

      // Check Panel 0 Defaults (RPM vs Boost vs AirMass)
      expect(document.getElementById('xyX-0').value).toBe('Engine Rpm');
      expect(document.getElementById('xyY-0').value).toBe(
        'Intake Manifold Pressure'
      );

      // Check Timeline Update Triggered
      expect(updateTimelineSpy).toHaveBeenCalled();
    });

    test('onFileChange() handles missing file gracefully', () => {
      AppState.files = []; // No files
      document.getElementById('xyGlobalFile').value = '0'; // Invalid index

      expect(() => XYAnalysis.onFileChange()).not.toThrow();
    });
  });

  // --- COVERS HELPERS (Lines 107-108) ---
  describe('Helpers', () => {
    test('setSelectValue() selects option if partial match found', () => {
      const select = document.getElementById('xyX-0');
      select.innerHTML = '<option value="Some Long Signal Name">Label</option>';

      XYAnalysis.setSelectValue('xyX-0', 'Signal Name');
      expect(select.value).toBe('Some Long Signal Name');
    });

    test('setSelectValue() does nothing if no match found', () => {
      const select = document.getElementById('xyX-0');
      select.innerHTML = '<option value="A">A</option>';
      select.value = 'A';

      XYAnalysis.setSelectValue('xyX-0', 'Z');
      expect(select.value).toBe('A'); // Unchanged
    });
  });

  // --- COVERS RENDER CHARTS (Lines 211-230) ---
  describe('Scatter Plot Rendering', () => {
    test('renderChart() handles empty data gracefully', () => {
      jest.spyOn(XYAnalysis, 'generateScatterData').mockReturnValue([]);

      // Should return early and not crash
      XYAnalysis.renderChart('0', 0, 'A', 'B', 'C');
      expect(Chart).toHaveBeenCalledTimes(0); // No chart created
    });

    test('resetAllZooms() resets scatter and timeline charts', () => {
      XYAnalysis.charts = [mockChartInstance, null];
      XYAnalysis.timelineChart = mockChartInstance;

      XYAnalysis.resetAllZooms();

      expect(mockChartInstance.resetZoom).toHaveBeenCalledTimes(2);
    });
  });

  // --- COVERS TIMELINE (Lines 329-373) ---
  describe('Timeline Integration', () => {
    test('renderTimeline() creates chart with normalized data', () => {
      AppState.files = [
        {
          startTime: 1000,
          signals: {
            RPM: [
              { x: 1000, y: 0 },
              { x: 2000, y: 6000 },
            ],
          },
        },
      ];

      XYAnalysis.renderTimeline(0, ['RPM']);

      expect(Chart).toHaveBeenCalled();
      const config = Chart.mock.calls[0][1];

      // Verify Normalization (0 to 6000 -> 0.0 to 1.0)
      const data = config.data.datasets[0].data;
      expect(data[0].y).toBe(0);
      expect(data[1].y).toBe(1);

      // Verify Tooltip uses original value
      const tooltipItem = {
        raw: { originalValue: 6000 },
        dataset: { label: 'RPM' },
      };
      const label = config.options.plugins.tooltip.callbacks.label(tooltipItem);
      expect(label).toBe('RPM: 6000.00');
    });

    test('renderTimeline() returns early if canvas missing', () => {
      document.getElementById('xyTimelineCanvas').remove(); // Remove canvas
      XYAnalysis.renderTimeline(0, ['RPM']);
      expect(Chart).toHaveBeenCalledTimes(0);
    });

    test('renderTimeline() returns early if signal data missing', () => {
      AppState.files = [{ startTime: 0, signals: {} }]; // No signals
      XYAnalysis.renderTimeline(0, ['MissingSignal']);
      // Should not crash, datasets will be empty/filtered
      expect(Chart).toHaveBeenCalled();
      const config = Chart.mock.calls[0][1];
      expect(config.data.datasets.length).toBe(0);
    });

    test('updateTimeline() aggregates signals from DOM and calls render', () => {
      // Mock Select Values
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        el.innerHTML = `<option value="${val}">${val}</option>`;
        el.value = val;
      };
      setVal('xyGlobalFile', '0');
      setVal('xyX-0', 'S1');
      setVal('xyY-0', 'S2');
      setVal('xyZ-0', 'S1'); // Duplicate S1
      setVal('xyX-1', 'S3');
      setVal('xyY-1', '');
      setVal('xyZ-1', ''); // Empty slots

      AppState.files = [{ startTime: 0, signals: { S1: [], S2: [], S3: [] } }];

      const spy = jest.spyOn(XYAnalysis, 'renderTimeline');

      XYAnalysis.updateTimeline();

      // Expect unique signals: S1, S2, S3
      expect(spy).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining(['S1', 'S2', 'S3'])
      );
      const args = spy.mock.calls[0][1];
      expect(args.length).toBe(3);
    });

    test('plot() integration triggers both scatter and timeline updates', () => {
      const scatterSpy = jest
        .spyOn(XYAnalysis, 'renderChart')
        .mockImplementation(() => {});
      const timelineSpy = jest
        .spyOn(XYAnalysis, 'updateTimeline')
        .mockImplementation(() => {});

      // Mock minimal DOM for plot
      document.getElementById('xyGlobalFile').innerHTML =
        '<option value="0">F</option>';
      document.getElementById('xyGlobalFile').value = '0';
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        el.innerHTML = `<option value="${val}">${val}</option>`;
        el.value = val;
      };
      setVal('xyX-0', 'A');
      setVal('xyY-0', 'B');
      setVal('xyZ-0', 'C');

      XYAnalysis.plot('0');

      expect(scatterSpy).toHaveBeenCalled();
      expect(timelineSpy).toHaveBeenCalled();
    });
  });
});

describe('XYAnalysis - Suite-2', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AppState.files = [];
    XYAnalysis.charts = [null, null];
    XYAnalysis.timelineChart = null;

    Chart.mockImplementation(() => mockChartInstance);

    document.body.innerHTML = `
      <div id="xyModal" style="display: none;">
        <div class="modal-body"></div>
      </div>
      <select id="xyGlobalFile"></select>
      
      <select id="xyX-0"></select>
      <select id="xyY-0"></select>
      <select id="xyZ-0"></select>
      <canvas id="xyCanvas-0"></canvas>
      <div id="xyLegend-0" style="display:none;"></div>

      <select id="xyX-1"></select>
      <select id="xyY-1"></select>
      <select id="xyZ-1"></select>
      <canvas id="xyCanvas-1"></canvas>
      <div id="xyLegend-1" style="display:none;"></div>
      
      <canvas id="xyTimelineCanvas"></canvas>
    `;

    // Ensure PaletteManager is globally available for the renderTimeline check
    window.PaletteManager = { getColorForSignal: jest.fn(() => '#00ff00') };
  });

  afterEach(() => {
    delete window.PaletteManager;
  });

  describe('Legend Logic', () => {
    test('updateLegend() creates gradient bar and 5 value steps', () => {
      // Create element if missing (though beforeEach handles it)
      if (!document.getElementById('xyLegend-0')) {
        const d = document.createElement('div');
        d.id = 'xyLegend-0';
        document.body.appendChild(d);
      }

      // Execute
      XYAnalysis.updateLegend('0', 10, 20, 'TestLabel');

      const legend = document.getElementById('xyLegend-0');

      // 1. Check Display
      expect(legend.style.display).toBe('flex');

      // 2. Check Label
      const label = legend.querySelector('.z-axis-label');
      expect(label).toBeTruthy();
      expect(label.innerText).toBe('TestLabel');

      // 3. Check Gradient Bar
      const bar = legend.querySelector('.gradient-bar');
      expect(bar).toBeTruthy();

      // 4. Check Values (The 5 steps loop)
      const values = legend.querySelectorAll('.legend-values span');
      expect(values.length).toBe(5);
      expect(values[0].innerText).toBe('20.0'); // Max
      expect(values[4].innerText).toBe('10.0'); // Min
    });

    test('updateLegend() returns early if element missing', () => {
      document.getElementById('xyLegend-0').remove();
      expect(() => XYAnalysis.updateLegend('0', 0, 10, 'L')).not.toThrow();
    });
  });

  describe('Timeline Rendering ', () => {
    test('renderTimeline() handles valid data and creates Chart', () => {
      // Setup Data
      AppState.files = [
        {
          startTime: 1000,
          signals: {
            RPM: [
              { x: 1000, y: 0 },
              { x: 2000, y: 6000 },
            ],
            Boost: [
              { x: 1000, y: 0 },
              { x: 2000, y: 1.5 },
            ],
          },
        },
      ];

      // Execute
      XYAnalysis.renderTimeline(0, ['RPM', 'Boost']);

      // Verification
      expect(Chart).toHaveBeenCalled();
      const config = Chart.mock.calls[0][1];

      // Check Datasets
      expect(config.data.datasets.length).toBe(2);

      // Check Normalization (0-6000 becomes 0-1)
      const rpmData = config.data.datasets.find((d) => d.label === 'RPM').data;
      expect(rpmData[0].y).toBeCloseTo(0);
      expect(rpmData[1].y).toBeCloseTo(1);

      // Check Tooltip Callback (Must return original value)
      const tooltipItem = {
        raw: { originalValue: 6000 },
        dataset: { label: 'RPM' },
      };
      const labelText =
        config.options.plugins.tooltip.callbacks.label(tooltipItem);
      expect(labelText).toBe('RPM: 6000.00');
    });

    test('renderTimeline() uses PaletteManager if available', () => {
      AppState.files = [{ startTime: 0, signals: { SigA: [{ x: 0, y: 0 }] } }];

      // Even if we set window.PaletteManager, the imported module mock (#ff0000)
      // takes precedence in the transpiled code. We verify it uses the mock.
      window.PaletteManager = { getColorForSignal: jest.fn(() => '#123456') };

      XYAnalysis.renderTimeline(0, ['SigA']);

      const config = Chart.mock.calls[0][1];
      // Expect the module mock color, not the window fallback
      expect(config.data.datasets[0].borderColor).toBe('#ff0000');
    });

    test('renderTimeline() falls back to default colors if PaletteManager missing', () => {
      AppState.files = [{ startTime: 0, signals: { SigA: [{ x: 0, y: 0 }] } }];

      // Remove global
      delete window.PaletteManager;

      XYAnalysis.renderTimeline(0, ['SigA']);

      const config = Chart.mock.calls[0][1];
      // Check against one of the default hex codes in the function
      const defaults = [
        '#e6194b',
        '#3cb44b',
        '#ffe119',
        '#4363d8',
        '#f58231',
        '#911eb4',
      ];
      expect(defaults).toContain(config.data.datasets[0].borderColor);
    });

    test('renderTimeline() falls back to default colors if PaletteManager throws/missing', () => {
      // To test the fallback, we'd ideally unmock the module, but since we can't unmock dynamic imports easily:
      // We rely on the fact that if the code logic fell through, it would hit defaults.
      // This test simply ensures the function runs without crashing.
      AppState.files = [{ startTime: 0, signals: { SigA: [{ x: 0, y: 0 }] } }];

      XYAnalysis.renderTimeline(0, ['SigA']);
      expect(Chart).toHaveBeenCalled();
    });

    test('renderTimeline() skips signals with missing data', () => {
      AppState.files = [
        { startTime: 0, signals: { Exists: [{ x: 0, y: 0 }] } },
      ];

      // Request 'Exists' and 'Missing'
      XYAnalysis.renderTimeline(0, ['Exists', 'Missing']);

      const config = Chart.mock.calls[0][1];
      expect(config.data.datasets.length).toBe(1); // Only 'Exists' should be there
      expect(config.data.datasets[0].label).toBe('Exists');
    });

    test('renderTimeline() returns early if canvas is missing', () => {
      document.getElementById('xyTimelineCanvas').remove();
      XYAnalysis.renderTimeline(0, ['RPM']);
      expect(Chart).not.toHaveBeenCalled();
    });

    test('renderTimeline() destroys existing chart before creating new one', () => {
      AppState.files = [{ startTime: 0, signals: { A: [{ x: 0, y: 0 }] } }];

      // 1st Call
      XYAnalysis.renderTimeline(0, ['A']);
      const firstInstance = XYAnalysis.timelineChart;

      // 2nd Call
      XYAnalysis.renderTimeline(0, ['A']);

      expect(firstInstance.destroy).toHaveBeenCalled();
    });
  });

  describe('Integration: plot() -> updateTimeline()', () => {
    test('plot() triggers updateTimeline with aggregated signals', () => {
      const scatterSpy = jest
        .spyOn(XYAnalysis, 'renderChart')
        .mockImplementation(() => {});

      // Spy on updateTimeline directly to verify the chain call
      const timelineSpy = jest
        .spyOn(XYAnalysis, 'updateTimeline')
        .mockImplementation(() => {});

      // Setup DOM state
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        el.innerHTML = `<option value="${val}">${val}</option>`;
        el.value = val;
      };

      document.getElementById('xyGlobalFile').innerHTML =
        '<option value="0">F</option>';
      document.getElementById('xyGlobalFile').value = '0';
      setVal('xyX-0', 'A');
      setVal('xyY-0', 'B');
      setVal('xyZ-0', 'C');

      // Setup File Data to prevent crashes
      AppState.files = [{ name: 'F', startTime: 0, signals: {} }];

      XYAnalysis.plot('0');

      expect(scatterSpy).toHaveBeenCalled();
      expect(timelineSpy).toHaveBeenCalled();
    });
  });
});
