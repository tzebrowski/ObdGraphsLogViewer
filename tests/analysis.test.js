import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { Analysis } from '../src/analysis.js';
import { AppState, DOM, Config } from '../src/config.js';
import { UI } from '../src/ui.js';

describe('Analysis Module - Coverage Boost', () => {
  beforeEach(() => {
    // 1. Setup minimal DOM
    document.body.innerHTML = `
      <select id="anomalyTemplate"></select>
      <div id="filtersContainer"></div>
      <button id="btnRunScan"></button>
      <div id="scanResults"></div>
      <div id="scanCount"></div>
    `;

    // 2. Mock AppState with "event-triggering" data
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

    // 3. Mock DOM.get
    DOM.get = jest.fn((id) => document.getElementById(id));

    // 4. Mock UI.resetScannerUI to avoid side effects
    UI.resetScannerUI = jest.fn();
  });

  test('initTemplates() populates dropdown and adds initial row', () => {
    // Triggers lines 7-23
    Analysis.initTemplates();

    const sel = document.getElementById('anomalyTemplate');
    const container = document.getElementById('filtersContainer');

    expect(sel.options.length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.filter-row')).toHaveLength(1);
  });

  test('runScan() identifies events based on criteria', () => {
    // 1. Manually add a filter row for RPM > 4000
    Analysis.addFilterRow('RPM', '>', '4000', 0);

    // 2. Execute the scan (triggers lines 152-211)
    Analysis.runScan();

    const countDiv = document.getElementById('scanCount');
    const resultsDiv = document.getElementById('scanResults');

    // Should find 1 event (from t=2000 to t=4000)
    expect(countDiv.innerText).toContain('1 events found');
    expect(resultsDiv.querySelectorAll('.result-item')).toHaveLength(1);
  });

  test('addFilterRow() handles "All Files" option (-1)', () => {
    // Triggers logic for flatMapping signals (lines 40-55)
    Analysis.addFilterRow('', '>', '', -1);

    const sigSelect = document.querySelector('.sig-select');
    expect(sigSelect.innerHTML).toContain('RPM');
    expect(sigSelect.innerHTML).toContain('Temp');
  });
});
