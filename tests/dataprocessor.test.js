import { jest, describe, test, expect, beforeEach } from '@jest/globals';

import { DataProcessor } from '../src/dataprocesssor.js';
import { AppState, DOM } from '../src/config.js';
import { UI } from '../src/ui.js';
import { Analysis } from '../src/analysis.js';
import { ChartManager } from '../src/chartmanager.js';
import { Config } from '../src/config.js';

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

    const sortedData = DataProcessor._process(unsortedData, 'unsorted.json');
    expect(sortedData.rawData[0].timestamp).toBe(1000);
    expect(sortedData.rawData[1].timestamp).toBe(5000);
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

describe('DataProcessor - handleLocalFile', () => {
  let mockFileReader;

  beforeEach(() => {
    jest.clearAllMocks();
    AppState.files = [];

    // Mock the global FileReader
    mockFileReader = {
      readAsText: jest.fn(function () {
        // Simulate the async file reading process
        setTimeout(() => {
          this.onload({
            target: { result: JSON.stringify([{ s: 'RPM', t: 100, v: 500 }]) },
          });
        }, 10);
      }),
      onload: null,
    };
    global.FileReader = jest.fn(() => mockFileReader);

    // Mock DOM input for clearing the value
    document.body.innerHTML = `
      <input type="file" id="fileInput" />
      <div id="fileInfo"></div>
      <div id="chartContainer"></div>
    `;
    DOM.get = jest.fn((id) => document.getElementById(id));
  });

  test('handleLocalFile parses multiple files and updates UI', (done) => {
    // 1. Create a mock event with a file list
    const mockFile = new File(['{"data": "dummy"}'], 'test_log.json', {
      type: 'application/json',
    });
    const mockEvent = {
      target: {
        files: [mockFile],
      },
    };

    // 2. Spy on the process method to see if it gets called after reading
    const processSpy = jest.spyOn(DataProcessor, 'process');

    // 3. Execute
    DataProcessor.handleLocalFile(mockEvent);

    // 4. Verification using a timeout to wait for the FileReader callback
    setTimeout(() => {
      try {
        expect(UI.setLoading).toHaveBeenCalledWith(
          true,
          expect.stringContaining('Parsing 1 Files')
        );
        expect(processSpy).toHaveBeenCalled();
        expect(AppState.files.length).toBe(1);

        // Ensure the loading screen is turned off
        expect(UI.setLoading).toHaveBeenLastCalledWith(false);

        done(); // Tell Jest the async test is finished
      } catch (error) {
        done(error);
      }
    }, 50);
  });
});

test('loadConfiguration handles missing templates gracefully', async () => {
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

  // We need to bypass the 'import templates' and force the failure
  // Since we cannot easily un-import a file in ESM, we test the catch block

  // Method A: Mocking the internal Config to throw during assignment
  const originalTemplates = Config.ANOMALY_TEMPLATES;
  Object.defineProperty(Config, 'ANOMALY_TEMPLATES', {
    set: () => {
      throw new Error('Simulated Failure');
    },
  });

  await DataProcessor.loadConfiguration();

  expect(consoleSpy).toHaveBeenCalledWith('Config Loader:', expect.any(Error));

  // Cleanup
  Object.defineProperty(Config, 'ANOMALY_TEMPLATES', {
    value: originalTemplates,
    writable: true,
  });
  consoleSpy.mockRestore();
});

describe('DataProcessor: Cleaning Operation', () => {
  test('should map input schema to internal application schema', () => {
    const input = [{ s: 'Battery\nLevel', t: 1600000000, v: 85 }];

    const [output] = DataProcessor._preprocess(input);

    expect(output).toHaveProperty('signal', 'Battery Level');
    expect(output).toHaveProperty('timestamp', 1600000000);
    expect(output).toHaveProperty('value', 85);
  });

  test('should replace all newline characters with spaces in signal names', () => {
    const rawData = [
      { s: 'Engine\nTemp', t: 1000, v: 90 },
      { s: 'Battery\nStatus\nMain', t: 2000, v: 12.5 },
    ];

    const result = DataProcessor._process(rawData, 'test_log.json');

    // Assertions for cleaning
    expect(result.rawData[0].signal).toBe('Engine Temp');
    expect(result.rawData[1].signal).toBe('Battery Status Main');

    // Assert keys in the 'signals' object are also cleaned
    expect(Object.keys(result.signals)).toContain('Engine Temp');
    expect(Object.keys(result.signals)).not.toContain('Engine\nTemp');
  });

  test('should not modify signal names that have no newlines', () => {
    const rawData = [{ s: 'CleanName', t: 1000, v: 50 }];

    const result = DataProcessor._process(rawData, 'test.json');

    expect(result.rawData[0].signal).toBe('CleanName');
  });

  test('should preserve timestamp (t) and value (v) during cleaning', () => {
    const rawData = [{ s: 'Dirty\nName', t: 123456789, v: -42.5 }];

    const result = DataProcessor._process(rawData, 'test.json');

    expect(result.rawData[0].timestamp).toBe(123456789);
    expect(result.rawData[0].value).toBe(-42.5);
  });

  test('should correctly calculate duration after cleaning and sorting', () => {
    const rawData = [
      { s: 'A\nB', t: 5000, v: 1 },
      { s: 'C\nD', t: 1000, v: 2 },
    ];

    const result = DataProcessor._process(rawData, 'test.json');

    // (5000ms - 1000ms) / 1000 = 4 seconds
    expect(result.duration).toBe(4);
  });

  test('Preprocessor should map keys, trim strings, and convert types', () => {
    // Input uses external schema (s, t, v)
    const input = [{ s: ' Speed\n', t: '1000', v: '50.5' }];

    const [output] = DataProcessor._preprocess(input);

    // Assertions must use the new internal schema keys
    expect(output.signal).toBe('Speed'); // Was output.s
    expect(output.timestamp).toBe(1000); // Was output.t
    expect(output.value).toBe(50.5); // Was output.v

    // Optional: Verify the old keys are no longer present on the root object
    expect(output.s).toBeUndefined();
  });

  test('should map signals to internal chart schema (x and y)', () => {
    const input = [{ s: 'Temp', t: 100, v: 25 }];
    const result = DataProcessor._transformRawData(
      DataProcessor._preprocess(input),
      'test.json'
    );

    const signalData = result.signals['Temp'][0];

    // Verify the chart-ready keys exist
    expect(signalData).toHaveProperty('x', 100);
    expect(signalData).toHaveProperty('y', 25);
    // Verify the temporary preprocessing keys are not in the final chart data
    expect(signalData.timestamp).toBeUndefined();
  });
});
