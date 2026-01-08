import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { Analysis } from '../src/analysis.js';
import { AppState, DOM, Config, SIGNAL_MAPPINGS } from '../src/config.js';
import { UI } from '../src/ui.js';
import { Sliders } from '../src/chartmanager.js';

Sliders.zoomTo = jest.fn();

describe('Analysis Module - Public model API test', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <select id="anomalyTemplate"></select>
      <div id="filtersContainer"></div>
      <button id="btnRunScan"></button>
      <div id="scanResults"></div>
      <div id="scanCount"></div>
    `;

    AppState.files = [
      {
        name: 'engine_log.json',
        startTime: 1000,
        availableSignals: ['RPM', 'Temp'],
        rawData: [
          { s: 'RPM', t: 1000, v: 800 },
          { s: 'RPM', t: 2000, v: 5000 }, // Spike Starts
          { s: 'RPM', t: 3000, v: 5200 },
          { s: 'RPM', t: 4000, v: 800 }, // Spike Ends
        ],
      },
    ];

    DOM.get = jest.fn((id) => document.getElementById(id));

    UI.resetScannerUI = jest.fn();
  });

  test('initTemplates() populates dropdown and adds initial row', () => {
    Analysis.initTemplates();

    const sel = document.getElementById('anomalyTemplate');
    const container = document.getElementById('filtersContainer');

    expect(sel.options.length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.filter-row')).toHaveLength(1);
  });

  test('runScan() identifies events based on criteria', () => {
    Analysis.addFilterRow('RPM', '>', '4000', 0);

    Analysis.runScan();

    const countDiv = document.getElementById('scanCount');
    const resultsDiv = document.getElementById('scanResults');

    expect(countDiv.innerText).toContain('1 events found');
    expect(resultsDiv.querySelectorAll('.result-item')).toHaveLength(1);
  });

  test('addFilterRow() handles "All Files" option (-1)', () => {
    Analysis.addFilterRow('', '>', '', -1);

    const sigSelect = document.querySelector('.sig-select');
    expect(sigSelect.innerHTML).toContain('RPM');
    expect(sigSelect.innerHTML).toContain('Temp');
  });
});

describe('Analysis Module - Deep Coverage', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <select id="anomalyTemplate"></select>
      <div id="filtersContainer"></div>
      <button id="btnRunScan"></button>
      <div id="scanResults"></div>
      <div id="scanCount"></div>
    `;

    AppState.files = [
      {
        name: 'log1.json',
        startTime: 1000,
        availableSignals: ['RPM', 'TPS'],
        rawData: [
          { s: 'RPM', t: 1000, v: 800 },
          { s: 'RPM', t: 2000, v: 5000 },
          { s: 'RPM', t: 3000, v: 800 },
        ],
      },
    ];

    DOM.get = jest.fn((id) => document.getElementById(id));
    UI.resetScannerUI = jest.fn();
    jest.clearAllMocks();
  });

  test('applyTemplate() maps signals using aliases if exact match fails', () => {
    // Setup a template that looks for "EngineSpeed" (not in our file)
    Config.ANOMALY_TEMPLATES = {
      test: {
        name: 'Test',
        rules: [{ sig: 'EngineSpeed', op: '>', val: '4000' }],
      },
    };
    // Map "EngineSpeed" to "RPM" via aliases
    SIGNAL_MAPPINGS['EngineSpeed'] = ['rpm'];

    const sel = document.getElementById('anomalyTemplate');
    sel.innerHTML = '<option value="test" selected>Test</option>';
    sel.value = 'test';

    Analysis.applyTemplate();

    const sigSelect = document.querySelector('.sig-select');
    // It should have found "RPM" because it contains the alias "rpm"
    expect(sigSelect.value).toBe('RPM');
  });

  test('refreshFilterOptions() updates dropdowns when files change', () => {
    Analysis.addFilterRow();

    // Add a second file to AppState
    AppState.files.push({ name: 'log2.json', availableSignals: ['Temp'] });

    Analysis.refreshFilterOptions();

    const fileSelect = document.querySelector('.file-select');
    expect(fileSelect.options).toHaveLength(3); // All, log1, log2
    expect(fileSelect.innerHTML).toContain('log2.json');
  });

  test('filter row UI interactions: change file and remove row', () => {
    Analysis.addFilterRow();
    const row = document.querySelector('.filter-row');
    const fileSelect = row.querySelector('.file-select');
    const sigSelect = row.querySelector('.sig-select');
    const removeBtn = row.querySelector('.remove-row');

    // Simulate file change triggers signal refresh
    fileSelect.value = '0';
    fileSelect.dispatchEvent(new Event('change'));
    expect(sigSelect.innerHTML).toContain('TPS');

    // Simulate row removal
    removeBtn.click();
    expect(document.querySelector('.filter-row')).toBeNull();
  });

  test('runScan() handles empty criteria', () => {
    Analysis.runScan(); // No rows added yet
    expect(document.getElementById('scanCount').innerText).toBe(
      'No criteria defined'
    );
  });

  test('clicking result item triggers zoom and highlight', () => {
    const ranges = [
      { start: 2000, end: 3000, fileName: 'log1.json', fileIdx: 0 },
    ];
    Analysis.renderResults(ranges);

    const resultItem = document.querySelector('.result-item');
    resultItem.click();

    expect(resultItem.classList.contains('selected')).toBe(true);
    // Calculation: (2000 - 1000) / 1000 = 1s
    expect(Sliders.zoomTo).toHaveBeenCalledWith(1, 2, 0);
  });
});

test('Analysis guard clauses and alias fallbacks', () => {
  document.body.innerHTML = ''; // Clear DOM
  Analysis.initTemplates();
  Analysis.init();
  expect(DOM.get).toHaveBeenCalled();

  // Create a template rule with a signal that has no match and no alias
  Config.ANOMALY_TEMPLATES = {
    empty: {
      name: 'Empty',
      rules: [{ sig: 'NonExistent', op: '>', val: '0' }],
    },
  };
  SIGNAL_MAPPINGS['NonExistent'] = []; // No aliases

  document.body.innerHTML =
    '<select id="anomalyTemplate"><option value="empty"></option></select><div id="filtersContainer"></div>';
  Analysis.applyTemplate();

  const sigSelect = document.querySelector('.sig-select');
  expect(sigSelect.value).toBe(''); // Should fallback to empty string
});
