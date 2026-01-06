import { jest, describe, test, expect, beforeEach } from '@jest/globals';

import { DataProcessor } from '../src/dataprocesssor.js';
import { AppState, DOM } from '../src/config.js';
import { UI } from '../src/ui.js';
import { Analysis } from '../src/analysis.js';
import { ChartManager } from '../src/chartmanager.js';

UI.setLoading = jest.fn();
UI.renderSignalList = jest.fn();
UI.updateDataLoadedState = jest.fn();
Analysis.init = jest.fn();
Analysis.refreshFilterOptions = jest.fn();
ChartManager.render = jest.fn();

describe('DataProcessor Module Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    AppState.files = [];
    AppState.globalStartTime = 0;
    AppState.logDuration = 0;

    // Setup the minimal DOM required for the processing pipeline
    document.body.innerHTML = `
      <div id="chartContainer"></div>
      <div id="fileInfo"></div>
    `;

    DOM.get = jest.fn((id) => document.getElementById(id));
  });

  /**
   * Tests parsing of raw telemetry data points
   */
  test('process() correctly groups signals and calculates duration', () => {
    const mockData = [
      { s: 'RPM', t: 1000, v: 800 },
      { s: 'Speed', t: 1000, v: 0 },
      { s: 'RPM', t: 2000, v: 1200 },
      { s: 'Speed', t: 2000, v: 10 },
    ];
    const fileName = 'test_trip.json';

    DataProcessor.process(mockData, fileName);

    expect(AppState.files.length).toBe(1);
    const file = AppState.files[0];

    // Check Signal Grouping
    expect(file.availableSignals).toContain('RPM');
    expect(file.availableSignals).toContain('Speed');
    expect(file.signals['RPM']).toHaveLength(2);

    // Check Duration (2000 - 1000) / 1000 = 1s
    expect(file.duration).toBe(1);
    expect(AppState.globalStartTime).toBe(1000);
  });

  /**
   * Tests the sorting logic to ensure chronological order
   */
  test('process() sorts data by timestamp (t)', () => {
    const unsortedData = [
      { s: 'RPM', t: 5000, v: 2000 },
      { s: 'RPM', t: 1000, v: 800 },
    ];

    DataProcessor.process(unsortedData, 'unsorted.json');

    const sortedData = AppState.files[0].rawData;
    expect(sortedData[0].t).toBe(1000);
    expect(sortedData[1].t).toBe(5000);
  });

  /**
   * Tests handling of invalid processing
   */
  test('process() handles empty or malformed data gracefully', () => {
    // Attempting to process null data should trigger the catch block
    DataProcessor.process(null, 'bad.json');

    const container = document.getElementById('chartContainer');
    // Verify that the UI state was updated to reflect no data
    expect(container.classList.contains('has-data')).toBe(false);
    expect(AppState.files).toHaveLength(0);
  });

  /**
   * Tests configuration/template loading
   */
  test('loadConfiguration() initializes templates', async () => {
    await DataProcessor.loadConfiguration();
    // Since templates are imported directly, we check if logic runs
    expect(UI.setLoading).not.toHaveBeenCalled(); // This method doesn't trigger loading screen
  });
});
