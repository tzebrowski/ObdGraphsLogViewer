import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { mathChannels } from '../src/mathchannels.js';
import { AppState } from '../src/config.js';
import { UI } from '../src/ui.js';

// Mock UI methods used in mathchannels
UI.renderSignalList = jest.fn();

describe('MathChannels', () => {
  let alertMock;

  beforeEach(() => {
    // Reset AppState
    AppState.files = [];

    // Mock window.alert
    alertMock = jest.spyOn(window, 'alert').mockImplementation(() => {});

    // Setup basic DOM for UI tests
    document.body.innerHTML = `
      <div id="mathModal" style="display: none;">
        <select id="mathFormulaSelect"></select>
        <div id="mathInputsContainer"></div>
        <input id="mathChannelName" type="text" />
      </div>
    `;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createChannel Logic', () => {
    test('throws error if no file is loaded', () => {
      AppState.files = [];
      expect(() => {
        mathChannels.createChannel(0, 'boost', [], 'Test');
      }).toThrow('No file selected or loaded');
    });

    test('throws error for invalid formula definition', () => {
      AppState.files = [{ signals: {} }];
      expect(() => {
        mathChannels.createChannel(0, 'non_existent_formula', [], 'Test');
      }).toThrow('Invalid formula definition');
    });

    test('throws error if signal missing in file', () => {
      AppState.files = [
        {
          signals: { ExistingSignal: [] },
          availableSignals: ['ExistingSignal'],
        },
      ];

      // 'boost' requires map and baro. We only provide mapping for map, baro is missing.
      const inputMapping = ['ExistingSignal', 'MissingSignal'];

      expect(() => {
        mathChannels.createChannel(0, 'boost', inputMapping, 'Boost');
      }).toThrow("Signal 'MissingSignal' not found");
    });

    test('Calculated Power from Torque (Torque * RPM / 7127)', () => {
      // Torque = 400 Nm, RPM = 5000
      // HP = (400 * 5000) / 7127 = 280.62...
      const torqueData = [{ x: 100, y: 400 }];
      const rpmData = [{ x: 100, y: 5000 }];

      AppState.files = [
        {
          signals: { TQ: torqueData, RPM: rpmData },
          availableSignals: ['TQ', 'RPM'],
        },
      ];

      mathChannels.createChannel(0, 'power_from_torque', ['TQ', 'RPM'], 'HP');
      const result = AppState.files[0].signals['HP'];

      const expected = (400 * 5000) / 7127;
      expect(result[0].y).toBeCloseTo(expected, 4);
    });

    test('Estimated Power from kg/h (MAF/3.6 * Factor)', () => {
      // MAF = 360 kg/h -> 100 g/s. Factor = 1.35. Result should be 135.
      const mafData = [{ x: 1, y: 360 }];

      AppState.files = [
        {
          signals: { MAF: mafData },
          availableSignals: ['MAF'],
        },
      ];

      // Input 0: Signal, Input 1: Constant
      mathChannels.createChannel(0, 'est_power_kgh', ['MAF', '1.35'], 'EstHP');
      const result = AppState.files[0].signals['EstHP'];

      expect(result[0].y).toBeCloseTo(135, 1);
    });

    test('Estimated Power from g/s (MAF * Factor)', () => {
      // MAF = 100 g/s. Factor = 1.35. Result should be 135.
      const mafData = [{ x: 1, y: 100 }];

      AppState.files = [
        {
          signals: { MAF: mafData },
          availableSignals: ['MAF'],
        },
      ];

      mathChannels.createChannel(0, 'est_power_gs', ['MAF', '1.35'], 'EstHP');
      const result = AppState.files[0].signals['EstHP'];

      expect(result[0].y).toBeCloseTo(135, 1);
    });

    test('successfully creates a channel with Multiply by Constant (Signal + Constant)', () => {
      const signalData = [
        { x: 0, y: 10 },
        { x: 1000, y: 20 },
        { x: 2000, y: 30 },
      ];

      AppState.files = [
        {
          name: 'test.log',
          signals: { RPM: signalData },
          availableSignals: ['RPM'],
          metadata: {},
        },
      ];

      // Formula: multiply_const (Source * Factor)
      // Inputs: Source (RPM), Factor (2.0)
      const inputMapping = ['RPM', '2.0'];

      const newName = mathChannels.createChannel(
        0,
        'multiply_const',
        inputMapping,
        'RPM_Doubled'
      );

      expect(newName).toBe('RPM_Doubled');

      const newSignal = AppState.files[0].signals['RPM_Doubled'];
      expect(newSignal).toBeDefined();
      expect(newSignal.length).toBe(3);
      expect(newSignal[0].y).toBe(20); // 10 * 2
      expect(newSignal[1].y).toBe(40); // 20 * 2
      expect(newSignal[2].y).toBe(60); // 30 * 2

      // Check metadata update
      expect(AppState.files[0].availableSignals).toContain('RPM_Doubled');
      expect(AppState.files[0].metadata['RPM_Doubled']).toEqual({
        min: 20,
        max: 60,
        unit: 'Math',
      });
    });

    test('successfully calculates Boost (Signal - Signal) with aligned timestamps', () => {
      const mapData = [{ x: 1000, y: 2.5 }];
      const baroData = [{ x: 1000, y: 1.0 }];

      AppState.files = [
        {
          signals: { MAP: mapData, Baro: baroData },
          availableSignals: ['MAP', 'Baro'],
        },
      ];

      // Formula: boost (MAP - Baro)
      const inputMapping = ['MAP', 'Baro'];

      mathChannels.createChannel(0, 'boost', inputMapping, 'MyBoost');

      const result = AppState.files[0].signals['MyBoost'];
      expect(result[0].y).toBe(1.5); // 2.5 - 1.0
    });

    test('interpolates data when timestamps do not match', () => {
      // MAP has points at 0, 2000
      // Baro has points at 1000 (needs to interpolate MAP)
      // Note: The logic iterates over the *first* signal passed (Master Time Base).
      // Let's set MAP as master.
      const mapData = [
        { x: 0, y: 100 },
        { x: 2000, y: 300 },
      ];
      // Baro is constant-ish or different time base
      const baroData = [
        { x: 0, y: 50 },
        { x: 1000, y: 60 }, // This point is at t=1000
        { x: 2000, y: 50 },
      ];

      AppState.files = [
        {
          signals: { MAP: mapData, Baro: baroData },
          availableSignals: ['MAP', 'Baro'],
        },
      ];

      // We want to calculate MAP - Baro.
      // Since 'MAP' is the first input for 'boost', the loop will run for x=0 and x=2000.
      // It will interpolate 'Baro' at x=0 and x=2000.
      const inputMapping = ['MAP', 'Baro'];
      mathChannels.createChannel(0, 'boost', inputMapping, 'InterpBoost');

      const result = AppState.files[0].signals['InterpBoost'];

      // At x=0: MAP=100, Baro=50 -> 50
      expect(result[0].x).toBe(0);
      expect(result[0].y).toBe(50);

      // At x=2000: MAP=300, Baro=50 -> 250
      expect(result[1].x).toBe(2000);
      expect(result[1].y).toBe(250);
    });

    test('interpolates correctly (linear interpolation logic check)', () => {
      // Test specifically the interpolation math embedded in createChannel logic
      // We use 'multiply_const' but cheat by treating the constant input as a second signal via code manipulation
      // or easier: use 'afr_error' (Cmd - Measured).

      const cmdData = [{ x: 100, y: 14.7 }]; // Target time
      const measuredData = [
        { x: 0, y: 10 },
        { x: 200, y: 20 },
      ];
      // At x=100, Measured should be interpolated to 15 ((10+20)/2)

      AppState.files = [
        {
          signals: { CMD: cmdData, MEAS: measuredData },
          availableSignals: ['CMD', 'MEAS'],
        },
      ];

      mathChannels.createChannel(0, 'afr_error', ['CMD', 'MEAS'], 'AFR_Err');
      const res = AppState.files[0].signals['AFR_Err'];

      // 14.7 - 15 = -0.3
      expect(res[0].y).toBeCloseTo(-0.3);
    });

    test('handles boundary conditions for interpolation (timestamps outside range)', () => {
      const master = [{ x: 500, y: 10 }];
      const slave = [
        { x: 1000, y: 20 },
        { x: 2000, y: 30 },
      ];

      AppState.files = [
        {
          signals: { M: master, S: slave },
          availableSignals: ['M', 'S'],
        },
      ];

      // boost: M - S
      // At x=500, S is not defined (starts at 1000). Should take first value (20).
      mathChannels.createChannel(0, 'boost', ['M', 'S'], 'Result');
      const res = AppState.files[0].signals['Result'];

      expect(res[0].y).toBe(10 - 20); // -10
    });

    test('Acceleration (m/s²) - Custom Process', () => {
      // 0 to 100 km/h in 5 seconds linear acceleration.
      // 100 km/h = 27.777 m/s
      // Accel = 27.777 / 5 = 5.55 m/s^2

      const speedData = [
        { x: 0, y: 0 },
        { x: 1000, y: 20 }, // 20 km/h
        { x: 2000, y: 40 }, // 40 km/h
      ];
      // At t=1000 (1s), deltaV = 20 km/h = 5.555... m/s. deltaT = 1s.

      AppState.files = [
        {
          signals: { Speed: speedData },
          availableSignals: ['Speed'],
        },
      ];

      // Input 0: Speed, Input 1: Window Size (1)
      mathChannels.createChannel(0, 'acceleration', ['Speed', '1'], 'Accel');
      const result = AppState.files[0].signals['Accel'];

      // The logic loop starts at i=windowSize (1)
      expect(result.length).toBeGreaterThan(0);

      // Obliczamy oczekiwaną wartość dokładnie tak jak kod: (20 km/h w m/s) / 1s
      const expectedValue = 20 / 3.6 / 1;

      expect(result[0].y).toBeCloseTo(expectedValue, 4);
    });

    test('Smoothing (Moving Average) - Custom Process', () => {
      const noisySignal = [
        { x: 1, y: 10 },
        { x: 2, y: 20 },
        { x: 3, y: 10 },
        { x: 4, y: 20 },
      ];

      AppState.files = [
        {
          signals: { Noisy: noisySignal },
          availableSignals: ['Noisy'],
        },
      ];

      // Input 0: Signal, Input 1: Window Size (2)
      mathChannels.createChannel(0, 'smoothing', ['Noisy', '2'], 'Smooth');
      const result = AppState.files[0].signals['Smooth'];

      // Index 0 (x=1): Avg(10) = 10
      expect(result[0].y).toBe(10);

      // Index 1 (x=2): Avg(10, 20) = 15
      expect(result[1].y).toBe(15);

      // Index 2 (x=3): Avg(20, 10) = 15
      expect(result[2].y).toBe(15);
    });

    test('Pressure Ratio (MAP / Baro) with Zero Division check', () => {
      const mapData = [
        { x: 1, y: 2000 },
        { x: 2, y: 2000 },
      ];
      const baroData = [
        { x: 1, y: 1000 }, // Normal case
        { x: 2, y: 0 }, // Edge case: Division by zero
      ];

      AppState.files = [
        {
          signals: { MAP: mapData, Baro: baroData },
          availableSignals: ['MAP', 'Baro'],
        },
      ];

      mathChannels.createChannel(0, 'pressure_ratio', ['MAP', 'Baro'], 'PR');
      const result = AppState.files[0].signals['PR'];

      // Case 1: 2000 / 1000 = 2
      expect(result[0].y).toBe(2);

      // Case 2: 2000 / 0 -> Should be handled (returns 0 in formula)
      expect(result[1].y).toBe(0);
    });
  });

  describe('UI Interactions', () => {
    test('openModal alerts if no files loaded', () => {
      AppState.files = [];
      window.openMathModal(); // Calls mathChannels.#openModal via binding
      expect(alertMock).toHaveBeenCalledWith('Please load a log file first.');
      expect(document.getElementById('mathModal').style.display).toBe('none');
    });

    test('openModal shows modal and populates select if file exists', () => {
      AppState.files = [{ availableSignals: [] }];
      window.openMathModal();

      const modal = document.getElementById('mathModal');
      const select = document.getElementById('mathFormulaSelect');

      expect(modal.style.display).toBe('flex');
      expect(select.options.length).toBeGreaterThan(1); // Default + definitions
    });

    test('onMathFormulaChange populates inputs correctly', () => {
      AppState.files = [
        {
          availableSignals: ['MAF g/s', 'Intake Press'],
          signals: {},
        },
      ];

      window.openMathModal();
      const select = document.getElementById('mathFormulaSelect');
      let targetVal = '';
      for (let opt of select.options) {
        if (opt.value === 'multiply_const') targetVal = opt.value;
      }
      select.value = targetVal;

      window.onMathFormulaChange();

      const container = document.getElementById('mathInputsContainer');
      // Changed to find both searchable inputs and constant inputs
      const inputs = container.querySelectorAll(
        '.template-select, .searchable-input'
      );

      expect(inputs.length).toBe(2);
      // Input 0 (Source) is now a text input (Searchable Select)
      expect(inputs[0].tagName).toBe('INPUT');
      expect(inputs[0].type).toBe('text');

      // Input 1 (Constant) remains a number input
      expect(inputs[1].tagName).toBe('INPUT');
      expect(inputs[1].type).toBe('number');
    });

    test('createMathChannel (executeCreation) validates form and calls createChannel', () => {
      // Setup valid state
      const signalData = [{ x: 1, y: 1 }];
      AppState.files = [
        {
          name: 'f1',
          signals: { SigA: signalData },
          availableSignals: ['SigA'],
        },
      ];

      // 1. Simulate opening
      window.openMathModal();

      // 2. Select 'multiply_const'
      const select = document.getElementById('mathFormulaSelect');
      select.value = 'multiply_const';
      window.onMathFormulaChange();

      // 3. Fill inputs
      // Input 0 is signal select
      const sigSelect = document.getElementById('math-input-0');
      sigSelect.value = 'SigA';

      // Input 1 is factor
      const factorInput = document.getElementById('math-input-1');
      factorInput.value = '5';

      // 4. Click Create
      window.createMathChannel();

      // 5. Verification
      // Should have created channel 'Math: Multiply by Constant'
      const newSig = AppState.files[0].signals['Math: Multiply by Constant'];
      expect(newSig).toBeDefined();
      expect(newSig[0].y).toBe(5); // 1 * 5

      // Should close modal
      expect(document.getElementById('mathModal').style.display).toBe('none');

      // Should refresh UI
      expect(UI.renderSignalList).toHaveBeenCalled();
    });

    test('createMathChannel handles errors gracefully', () => {
      // Setup state where creation fails (e.g. invalid factor)
      AppState.files = [{ signals: { SigA: [] }, availableSignals: ['SigA'] }];
      window.openMathModal();

      const select = document.getElementById('mathFormulaSelect');
      select.value = 'multiply_const';
      window.onMathFormulaChange();

      // Force invalid input by not selecting signal?
      // Or simpler: Mock createChannel to throw
      const spy = jest
        .spyOn(mathChannels, 'createChannel')
        .mockImplementation(() => {
          throw new Error('Mock Error');
        });

      const consoleSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      window.createMathChannel();

      expect(alertMock).toHaveBeenCalledWith(
        expect.stringContaining('Error creating channel: Mock Error')
      );

      spy.mockRestore();
      consoleSpy.mockRestore();
    });
  });
});
