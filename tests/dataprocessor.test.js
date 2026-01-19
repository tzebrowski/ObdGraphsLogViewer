import { jest, describe, test, expect, beforeEach } from '@jest/globals';

import { dataProcessor } from '../src/dataprocessor.js';
import { AppState, DOM } from '../src/config.js';
import { messenger } from '../src/bus.js';
import { Config } from '../src/config.js';
import { UI } from '../src/ui.js';

UI.setLoading = jest.fn();
messenger.emit = jest.fn();

describe('DataProcessor Module Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    AppState.files = [];

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

    dataProcessor.process(mockData, fileName);

    expect(AppState.files.length).toBe(1);
    const file = AppState.files[0];

    // Check Signal Grouping
    expect(file.availableSignals).toContain('RPM');
    expect(file.availableSignals).toContain('Speed');
    expect(file.signals['RPM']).toHaveLength(2);

    expect(file.duration).toBe(1);
  });

  /**
   * Tests the sorting logic to ensure chronological order
   */
  test('process() sorts data by timestamp (t)', () => {
    const unsortedData = [
      { s: 'RPM', t: 5000, v: 2000 },
      { s: 'RPM', t: 1000, v: 800 },
    ];

    const sortedData = dataProcessor.process(unsortedData, 'unsorted.json');
    expect(sortedData.rawData[0].timestamp).toBe(1000);
    expect(sortedData.rawData[1].timestamp).toBe(5000);
  });

  /**
   * Tests handling of invalid processing
   */
  test('process() handles empty or malformed data gracefully', () => {
    // Attempting to process null data should trigger the catch block
    dataProcessor.process(null, 'bad.json');

    const container = document.getElementById('chartContainer');
    // Verify that the UI state was updated to reflect no data
    expect(container.classList.contains('has-data')).toBe(false);
    expect(AppState.files).toHaveLength(0);
  });

  /**
   * Tests configuration/template loading
   */
  test('loadConfiguration() initializes templates', async () => {
    await dataProcessor.loadConfiguration();
    // Since templates are imported directly, we check if logic runs
    expect(UI.setLoading).not.toHaveBeenCalled(); // This method doesn't trigger loading screen
  });
});

describe('DataProcessor - handleLocalFile', () => {
  let mockFileReader;

  beforeEach(() => {
    jest.clearAllMocks();
    AppState.files = [];

    document.body.innerHTML = `
      <input type="file" id="fileInput" />
      <div id="fileInfo"></div>
      <div id="chartContainer"></div>
    `;
    DOM.get = jest.fn((id) => document.getElementById(id));
  });

  test('handleLocalFile parses json dummy data', (done) => {
    const mockFile = new File(['{"data": "dummy"}'], 'test_log.json', {
      type: 'application/json',
    });
    const mockEvent = {
      target: {
        files: [mockFile],
      },
    };

    dataProcessor.handleLocalFile(mockEvent);

    setTimeout(() => {
      try {
        expect(messenger.emit).toHaveBeenCalledWith(
          expect.stringContaining('ui:set-loading'),
          { message: 'Parsing 1 Files...' }
        );

        expect(messenger.emit).toHaveBeenCalledWith(
          expect.stringContaining('ui:updateDataLoadedState'),
          { status: false }
        );

        expect(messenger.emit).toHaveBeenCalledWith(
          expect.stringContaining('dataprocessor:batch-load-completed'),
          {}
        );

        expect(AppState.files.length).toBe(0);

        done(); // Tell Jest the async test is finished
      } catch (error) {
        done(error);
      }
    }, 50);
  });
});

test('loadConfiguration handles missing templates gracefully', async () => {
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
  const originalTemplates = Config.ANOMALY_TEMPLATES;
  Object.defineProperty(Config, 'ANOMALY_TEMPLATES', {
    set: () => {
      throw new Error('Simulated Failure');
    },
  });

  await dataProcessor.loadConfiguration();

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
    const raw = [{ s: 'Battery\nLevel', t: 1600000000, v: 85 }];

    const result = dataProcessor.process(raw, 'test.json');

    expect(result.rawData[0].signal).toBe('Battery Level');
    expect(result.rawData[0].timestamp).toBe(1600000000);
    expect(result.rawData[0].value).toBe(85);
  });

  test('should replace all newline characters with spaces in signal names', () => {
    const rawData = [
      { s: 'Engine\nTemp', t: 1000, v: 90 },
      { s: 'Battery\nStatus\nMain', t: 2000, v: 12.5 },
    ];

    const result = dataProcessor.process(rawData, 'test_log.json');

    // Assertions for cleaning
    expect(result.rawData[0].signal).toBe('Engine Temp');
    expect(result.rawData[1].signal).toBe('Battery Status Main');

    // Assert keys in the 'signals' object are also cleaned
    expect(Object.keys(result.signals)).toContain('Engine Temp');
    expect(Object.keys(result.signals)).not.toContain('Engine\nTemp');
  });

  test('should not modify signal names that have no newlines', () => {
    const rawData = [{ s: 'CleanName', t: 1000, v: 50 }];

    const result = dataProcessor.process(rawData, 'test.json');

    expect(result.rawData[0].signal).toBe('CleanName');
  });

  test('should preserve timestamp (t) and value (v) during cleaning', () => {
    const rawData = [{ s: 'Dirty\nName', t: 123456789, v: -42.5 }];

    const result = dataProcessor.process(rawData, 'test.json');

    expect(result.rawData[0].timestamp).toBe(123456789);
    expect(result.rawData[0].value).toBe(-42.5);
  });

  test('should correctly calculate duration after cleaning and sorting', () => {
    const rawData = [
      { s: 'A\nB', t: 5000, v: 1 },
      { s: 'C\nD', t: 1000, v: 2 },
    ];

    const result = dataProcessor.process(rawData, 'test.json');

    // (5000ms - 1000ms) / 1000 = 4 seconds
    expect(result.duration).toBe(4);
  });

  test('Preprocessor should map keys, trim strings, and convert types', () => {
    // Input uses external schema (s, t, v)
    const input = [{ s: ' Speed\n', t: '1000', v: '50.5' }];

    const result = dataProcessor.process(input, 'test.json');

    // Assertions must use the new internal schema keys
    expect(result.rawData[0].signal).toBe('Speed'); // Was output.s
    expect(result.rawData[0].timestamp).toBe(1000); // Was output.t
    expect(result.rawData[0].value).toBe(50.5); // Was output.v

    // Optional: Verify the old keys are no longer present on the root object
    expect(result.rawData[0].s).toBeUndefined();
  });

  test('should map signals to internal chart schema (x and y)', () => {
    const input = [{ s: 'Temp', t: 100, v: 25 }];
    const result = dataProcessor.process(input, 'test.json');
    const signalData = result.signals['Temp'][0];

    // Verify the chart-ready keys exist
    expect(signalData).toHaveProperty('x', 100);
    expect(signalData).toHaveProperty('y', 25);
    // Verify the temporary preprocessing keys are not in the final chart data
    expect(signalData.timestamp).toBeUndefined();
  });
});

describe('DataProcessor: CSV Handling', () => {
  beforeEach(() => {
    AppState.files = [];
    jest.clearAllMocks();

    // Setup the minimal DOM required for the processing pipeline
    document.body.innerHTML = `
      <div id="chartContainer"></div>
      <div id="fileInfo"></div>
    `;

    DOM.get = jest.fn((id) => document.getElementById(id));
  });

  test('should handle CSV files with trailing empty lines', (done) => {
    const csv = `SensorName,Time_ms,Reading
Battery,100,12.6
\n   \n`;

    const event = {
      target: {
        files: [
          new File([csv], 'test_log.csv', {
            type: 'text/csv',
          }),
        ],
      },
    };

    dataProcessor.handleLocalFile(event);

    setTimeout(() => {
      try {
        expect(messenger.emit).toHaveBeenCalledWith(
          expect.stringContaining('ui:set-loading'),
          { message: 'Parsing 1 Files...' }
        );

        expect(messenger.emit).toHaveBeenCalledWith(
          expect.stringContaining('dataprocessor:batch-load-completed'),
          {}
        );
        expect(AppState.files.length).toBe(1);

        const result = AppState.files[0];

        expect(result.rawData[0].signal).toBe('Battery');

        done(); // Tell Jest the async test is finished
      } catch (error) {
        done(error);
      }
    }, 50);
  });

  test('should parse a raw CSV string into an array of objects', (done) => {
    const csv = `SensorName,Time_ms,Reading
EngineTemp,1000,90
Battery,100,12.6
\n   \n`;

    const event = {
      target: {
        files: [
          new File([csv], 'test_log.csv', {
            type: 'text/csv',
          }),
        ],
      },
    };

    dataProcessor.handleLocalFile(event);

    setTimeout(() => {
      try {
        expect(messenger.emit).toHaveBeenCalledWith(
          expect.stringContaining('ui:set-loading'),
          { message: 'Parsing 1 Files...' }
        );

        expect(messenger.emit).toHaveBeenCalledWith(
          expect.stringContaining('dataprocessor:batch-load-completed'),
          {}
        );

        expect(AppState.files.length).toBe(1);

        const result = AppState.files[0];

        expect(result.rawData[1]).toEqual({
          signal: 'EngineTemp',
          timestamp: 1000,
          value: 90,
        });

        done(); //
      } catch (error) {
        done(error);
      }
    }, 50);
  });

  test('should correctly preprocess and map CSV data using LEGACY_CSV schema', () => {
    // rawData as it would come out of _parseCSV
    const rawCsvData = [
      { SensorName: ' RPM\n', Time_ms: '5000', Reading: '3000' },
    ];

    const result = dataProcessor.process(rawCsvData, 'test.csv');

    // Assert that it used the LEGACY_CSV mapping (SensorName -> signal)
    expect(result.rawData[0].signal).toBe('RPM'); // Mapped and cleaned
    expect(result.rawData[0].timestamp).toBe(5000); // Mapped and cast to Number
    expect(result.rawData[0].value).toBe(3000); // Mapped and cast to Number
  });
});

describe('DataProcessor - Configuration Error Handling', () => {
  test('loadConfiguration handles missing templates gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    await dataProcessor.loadConfiguration(null);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Missing templates')
    );

    Object.defineProperty(Config, 'ANOMALY_TEMPLATES', {
      value: {},
      writable: false,
      configurable: true,
    });

    await dataProcessor.loadConfiguration({ test: true });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Config Loader:',
      expect.any(TypeError)
    );

    // Cleanup
    Object.defineProperty(Config, 'ANOMALY_TEMPLATES', {
      value: {},
      writable: true,
    });
    consoleSpy.mockRestore();
  });
});

describe('DataProcessor: Wide CSV Import (Exported Format)', () => {
  beforeEach(() => {
    AppState.files = [];
    jest.clearAllMocks();

    document.body.innerHTML = `
      <div id="chartContainer"></div>
      <div id="fileInfo"></div>
    `;
    DOM.get = jest.fn((id) => document.getElementById(id));
  });

  test('should normalize Wide CSV (Time (s), Sig1, Sig2) to internal format', (done) => {
    // This simulates a CSV exported by the app: Time in seconds, signals in columns
    const csv = `Time (s),RPM,Speed
1.000,2000,50
2.500,2500,60`;

    const event = {
      target: {
        files: [new File([csv], 'export.csv', { type: 'text/csv' })],
      },
    };

    dataProcessor.handleLocalFile(event);

    setTimeout(() => {
      try {
        expect(AppState.files.length).toBe(1);
        const file = AppState.files[0];

        // 1. Verify Signals were extracted from headers
        expect(file.availableSignals).toEqual(
          expect.arrayContaining(['RPM', 'Speed'])
        );

        // 2. Verify Time Conversion (Seconds -> Milliseconds)
        // Row 1: 1.000s -> 1000ms
        const rpmPoint = file.signals['RPM'][0];
        expect(rpmPoint.x).toBe(1000);
        expect(rpmPoint.y).toBe(2000);

        // Row 2: 2.500s -> 2500ms
        const speedPoint = file.signals['Speed'][1];
        expect(speedPoint.x).toBe(2500);
        expect(speedPoint.y).toBe(60);

        done();
      } catch (error) {
        done(error);
      }
    }, 50);
  });

  test('should handle sparse data (empty cells) in Wide CSV', (done) => {
    // Scenario: RPM updates at T=1, Speed updates at T=2. Cells are empty otherwise.
    const csv = `Time (s),RPM,Speed
1.0,2000,
2.0,,55`;

    const event = {
      target: {
        files: [new File([csv], 'sparse.csv', { type: 'text/csv' })],
      },
    };

    dataProcessor.handleLocalFile(event);

    setTimeout(() => {
      try {
        const file = AppState.files[0];

        // RPM should only have 1 point at T=1000
        expect(file.signals['RPM'].length).toBe(1);
        expect(file.signals['RPM'][0].y).toBe(2000);

        // Speed should only have 1 point at T=2000
        expect(file.signals['Speed'].length).toBe(1);
        expect(file.signals['Speed'][0].y).toBe(55);

        done();
      } catch (error) {
        done(error);
      }
    }, 50);
  });

  test('should not multiply time if header does not contain "(s)"', (done) => {
    // Scenario: Header is just "time" (implies ms or raw units), not "Time (s)"
    const csv = `time,Boost
1000,1.5`;

    const event = {
      target: {
        files: [new File([csv], 'raw_time.csv', { type: 'text/csv' })],
      },
    };

    dataProcessor.handleLocalFile(event);

    setTimeout(() => {
      try {
        const file = AppState.files[0];
        const point = file.signals['Boost'][0];

        // Should REMAIN 1000, not become 1,000,000
        expect(point.x).toBe(1000);
        expect(point.y).toBe(1.5);

        done();
      } catch (error) {
        done(error);
      }
    }, 50);
  });

  test('should ignore non-numeric time rows', (done) => {
    const csv = `Time (s),RPM
invalid,2000
1.0,2500`;

    const event = {
      target: {
        files: [new File([csv], 'bad_rows.csv', { type: 'text/csv' })],
      },
    };

    dataProcessor.handleLocalFile(event);

    setTimeout(() => {
      try {
        const file = AppState.files[0];
        // Should skip the 'invalid' row and only parse the 1.0 row
        expect(file.signals['RPM'].length).toBe(1);
        expect(file.signals['RPM'][0].x).toBe(1000);
        done();
      } catch (error) {
        done(error);
      }
    }, 50);
  });
});
