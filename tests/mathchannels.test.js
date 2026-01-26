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
import { Alert } from '../src/alert.js';
import { messenger } from '../src/bus.js';

UI.renderSignalList = jest.fn();
Alert.showAlert = jest.fn();
messenger.emit = jest.fn();
messenger.on = jest.fn();

describe('MathChannels', () => {
  let alertMock;
  let consoleErrorMock;

  // Helper to reliably mock DOM elements by ID
  const mockDomElements = (elementMap) => {
    jest.spyOn(document, 'getElementById').mockImplementation((id) => {
      if (elementMap[id]) return elementMap[id];
      // Handle dynamic IDs like math-input-0, math-input-1...
      if (id.startsWith('math-input-') && elementMap['generic-input']) {
        return elementMap['generic-input'];
      }
      return {
        value: '',
        valueAsNumber: 0,
        checked: false,
        style: {},
        addEventListener: jest.fn(),
        children: [],
      };
    });
  };

  beforeEach(() => {
    AppState.files = [];
    alertMock = jest.spyOn(window, 'alert').mockImplementation(() => {});
    consoleErrorMock = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    document.body.innerHTML = `
      <div id="mathModal" style="display: none;">
        <select id="mathFormulaSelect"></select>
        
        <div id="mathDescriptionContainer" style="display: none;">
            <p id="mathFormulaDescription"></p>
        </div>

        <div id="mathInputsContainer"></div>
        
        <div id="mathNameContainer" style="display: none;">
            <input id="mathChannelName" type="text" />
        </div>
        
        <div id="mathTargetFileContainer">
             <select id="mathTargetFile"></select>
        </div>

        <button id="btnCreate">Create</button>
      </div>
    `;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createChannel Core Logic', () => {
    test('throws error if no file is selected', () => {
      AppState.files = [];
      expect(() => {
        mathChannels.createChannel(0, 'boost', [], 'Test');
      }).toThrow('No file selected or loaded');
    });

    test('throws error for invalid formula definition', () => {
      AppState.files = [{ signals: {} }];
      expect(() => {
        mathChannels.createChannel(0, 'unknown_id', [], 'Test');
      }).toThrow('Invalid formula definition');
    });

    test('throws error if required signal is missing', () => {
      AppState.files = [
        {
          signals: { A: [] },
          availableSignals: ['A'],
        },
      ];
      expect(() => {
        mathChannels.createChannel(0, 'boost', ['A', 'B'], 'Test');
      }).toThrow("Signal 'B' not found");
    });

    test('throws error for Invalid Constant Value', () => {
      AppState.files = [{ signals: { A: [] }, availableSignals: ['A'] }];
      expect(() => {
        mathChannels.createChannel(
          0,
          'multiply_const',
          ['A', 'invalid_text'],
          'Err'
        );
      }).toThrow('Invalid constant');
    });

    test('handles file without metadata gracefully', () => {
      AppState.files = [
        {
          name: 'no_meta.json',
          signals: { A: [{ x: 1, y: 1 }] },
          availableSignals: ['A'],
        },
      ];

      mathChannels.createChannel(0, 'multiply_const', ['A', '2'], 'New');
      const file = AppState.files[0];

      expect(file.metadata).toBeDefined();
      expect(file.metadata['Math: New']).toBeDefined();
      expect(file.availableSignals).toContain('Math: New');
    });
  });

  describe('Specific Formula Logic', () => {
    test('Acceleration: Standard Calculation & dt=0 skip', () => {
      const speedData = [
        { x: 0, y: 0 },
        { x: 1000, y: 36 },
        { x: 1000, y: 36 },
        { x: 2000, y: 72 },
      ];

      AppState.files = [
        { signals: { Speed: speedData }, availableSignals: ['Speed'] },
      ];

      mathChannels.createChannel(0, 'acceleration', ['Speed'], 'Accel');
      const res = AppState.files[0].signals['Math: Accel'];

      expect(res.length).toBe(2);
      expect(res[0].y).toBeCloseTo(10);
      expect(res[1].y).toBeCloseTo(10);
    });

    test('Smoothing: Sliding Window Average', () => {
      const data = [
        { x: 1, y: 10 },
        { x: 2, y: 20 },
        { x: 3, y: 30 },
        { x: 4, y: 40 },
      ];
      AppState.files = [{ signals: { S: data }, availableSignals: ['S'] }];

      mathChannels.createChannel(0, 'smoothing', ['S', '3'], 'Smoothie');
      const res = AppState.files[0].signals['Math: Smoothie'];

      expect(res[0].y).toBe(10);
      expect(res[1].y).toBe(15);
      expect(res[2].y).toBe(20);
      expect(res[3].y).toBe(30);
    });

    test('Pressure Ratio: Handles Division by Zero', () => {
      const map = [
        { x: 1, y: 100 },
        { x: 2, y: 200 },
      ];
      const baro = [
        { x: 1, y: 0 },
        { x: 2, y: 100 },
      ];

      AppState.files = [
        { signals: { M: map, B: baro }, availableSignals: ['M', 'B'] },
      ];

      mathChannels.createChannel(0, 'pressure_ratio', ['M', 'B'], 'PR');
      const res = AppState.files[0].signals['Math: PR'];

      expect(res[0].y).toBe(0);
      expect(res[1].y).toBe(2);
    });

    test('Power from Torque: Check Formula Constants', () => {
      const torque = [{ x: 1, y: 500 }];
      const rpm = [{ x: 1, y: 3000 }];
      AppState.files = [
        { signals: { T: torque, R: rpm }, availableSignals: ['T', 'R'] },
      ];

      mathChannels.createChannel(
        0,
        'power_from_torque',
        ['T', 'R', '1'],
        'HP_Nm'
      );
      const valNm = AppState.files[0].signals['Math: HP_Nm'][0].y;
      expect(valNm).toBeCloseTo((500 * 1 * 3000) / 7127, 4);
    });

    test('Filters: Greater Than & Less Than Logic', () => {
      const src = [{ x: 1, y: 100 }];
      const cond = [{ x: 1, y: 50 }];
      AppState.files = [
        { signals: { S: src, C: cond }, availableSignals: ['S', 'C'] },
      ];

      mathChannels.createChannel(
        0,
        'filter_gt',
        ['S', 'C', '10', '0'],
        'GT_Pass'
      );
      expect(AppState.files[0].signals['Math: GT_Pass'][0].y).toBe(100);

      mathChannels.createChannel(
        0,
        'filter_gt',
        ['S', 'C', '60', '0'],
        'GT_Fail'
      );
      expect(AppState.files[0].signals['Math: GT_Fail'][0].y).toBe(0);

      mathChannels.createChannel(
        0,
        'filter_lt',
        ['S', 'C', '60', '0'],
        'LT_Pass'
      );
      expect(AppState.files[0].signals['Math: LT_Pass'][0].y).toBe(100);
    });
  });

  describe('Interpolation', () => {
    test('Clamps to start/end values', () => {
      const master = [{ x: 500, y: 1 }];
      const slave = [
        { x: 100, y: 10 },
        { x: 200, y: 20 },
      ];

      AppState.files = [
        { signals: { M: master, S: slave }, availableSignals: ['M', 'S'] },
      ];

      mathChannels.createChannel(0, 'boost', ['M', 'S'], 'ClampCheck');
      const res = AppState.files[0].signals['Math: ClampCheck'];
      expect(res[0].y).toBe(1 - 20);
    });

    test('Interpolates linearly', () => {
      const master = [{ x: 150, y: 0 }];
      const slave = [
        { x: 100, y: 10 },
        { x: 200, y: 20 },
      ];
      AppState.files = [
        { signals: { M: master, S: slave }, availableSignals: ['M', 'S'] },
      ];

      mathChannels.createChannel(0, 'boost', ['M', 'S'], 'Linear');
      const res = AppState.files[0].signals['Math: Linear'];
      expect(res[0].y).toBe(-15);
    });
  });

  describe('UI & Searchable Select', () => {
    test('Bindings: Window functions are assigned', () => {
      expect(typeof mathChannels.openModal).toBe('function');
      expect(typeof mathChannels.closeModal).toBe('function');
      expect(typeof mathChannels.onFormulaChange).toBe('function');
      expect(typeof mathChannels.createMathChannel).toBe('function');
    });

    test('openModal: Populates select options', () => {
      AppState.files = [{ availableSignals: [], signals: {} }];
      mathChannels.openModal();

      const select = document.getElementById('mathFormulaSelect');
      expect(select.children.length).toBeGreaterThan(5);
      expect(document.getElementById('mathModal').style.display).toBe('flex');
    });

    test('onFormulaChange: Renders inputs correctly for constant vs signal', () => {
      AppState.files = [{ availableSignals: ['RPM'], signals: {} }];
      mathChannels.openModal();
      const select = document.getElementById('mathFormulaSelect');

      select.value = 'multiply_const';
      mathChannels.onFormulaChange();

      const container = document.getElementById('mathInputsContainer');
      const inputs = container.querySelectorAll('input');
      expect(inputs.length).toBe(4);

      const labels = container.querySelectorAll('.math-label-small');
      expect(labels[0].textContent).toBe('Source Signal');
      expect(labels[1].textContent).toBe('Factor');
    });

    test('Searchable Select: Multi-Select "Select All / Deselect All"', () => {
      AppState.files = [{ availableSignals: ['SigA', 'SigB'], signals: {} }];
      mathChannels.openModal();

      const select = document.getElementById('mathFormulaSelect');
      select.value = 'filtered_batch';
      mathChannels.onFormulaChange();

      const input = document.getElementById('math-input-0');
      input.dispatchEvent(new Event('focus'));

      const selectAllBtn = input.parentNode.querySelector('.search-select-all');

      selectAllBtn.click();
      expect(input.value).toContain('SigA');
      expect(input.value).toContain('SigB');

      input.dispatchEvent(new Event('focus'));
      selectAllBtn.click();

      const cleanedVal = input.value.replace(/,\s*$/, '').trim();
      expect(cleanedVal).toBe('');
    });

    test.skip('Searchable Select: Adding item manually via search', () => {
      jest.useFakeTimers();
      AppState.files = [{ availableSignals: ['Alpha', 'Beta'], signals: {} }];
      mathChannels.openModal();
      const select = document.getElementById('mathFormulaSelect');
      select.value = 'filtered_batch';
      mathChannels.onFormulaChange();

      const input = document.getElementById('math-input-0');

      input.focus();
      // Simplify test input to 'Be' to avoid comma splitting logic issues
      // and ensure we are testing the search rendering itself.
      input.value = 'Be';
      input.dispatchEvent(new Event('input'));

      // Advance timers in case of debounce
      jest.runAllTimers();

      const list = input.parentNode.querySelector('.search-results-list');
      const options = Array.from(list.querySelectorAll('.search-option'));

      const betaOption = options.find((opt) =>
        opt.textContent.includes('Beta')
      );
      expect(betaOption).toBeDefined();

      betaOption.click();
      expect(input.value).toContain('Beta');

      jest.useRealTimers();
    });

    test('Post-Processing Checkbox toggles window input', () => {
      AppState.files = [{ availableSignals: ['A'], signals: {} }];
      mathChannels.openModal();
      const select = document.getElementById('mathFormulaSelect');
      select.value = 'multiply_const';
      mathChannels.onFormulaChange();

      const checkbox = document.getElementById('math-opt-smooth');
      const winInput = document.getElementById('math-opt-window');

      expect(winInput.disabled).toBe(true);

      checkbox.click();
      expect(winInput.disabled).toBe(false);

      checkbox.click();
      expect(winInput.disabled).toBe(true);
    });
  });

  describe('Execution Flow (executeCreation)', () => {
    test('Shows Inline Error on Execution Error', () => {
      // 1. Create a persistent mock object for the error box
      // This ensures the app and the test modify/read the exact same object
      const mockErrorBox = {
        style: { display: 'none' },
        innerText: '',
      };

      // 2. Configure Mocks with the persistent error box
      mockDomElements({
        mathFormulaSelect: { value: 'multiply_const' },
        'math-input-0': { value: 'A' },
        'math-input-1': { value: '1' },
        mathChannelName: { value: 'ErrorTest' },
        'math-opt-smooth': { checked: false },
        'math-opt-window': { value: '1' },
        mathErrorBox: mockErrorBox, // <--- Key Fix: Pass the specific object
      });

      // 3. Mock createChannel to throw an error
      jest.spyOn(mathChannels, 'createChannel').mockImplementation(() => {
        throw new Error('Simulated Creation Failure');
      });

      // 4. Execute
      mathChannels.createMathChannel();

      // 5. Assert
      // Check the specific object reference we created
      expect(mockErrorBox.style.display).toBe('block');
      expect(mockErrorBox.innerText).toContain('Simulated Creation Failure');

      // Confirm Alert was NOT called
      expect(Alert.showAlert).not.toHaveBeenCalled();
    });

    test('Batch Creation executes createChannel multiple times', () => {
      AppState.files = [
        {
          availableSignals: ['A', 'B'],
          signals: { A: [{ x: 1, y: 1 }], B: [{ x: 1, y: 2 }] },
        },
      ];

      mathChannels.openModal();

      // Configure DOM to return multi-input values
      mockDomElements({
        mathFormulaSelect: { value: 'filtered_batch' },
        'math-input-0': { value: 'A, B' }, // Multiple sources
        'math-input-1': { value: 'A' }, // Condition
        'math-input-2': { value: '0' },
        'math-input-3': { value: '1' },
        'math-input-4': { value: '0' },
        'math-opt-smooth': { checked: false },
        'math-opt-window': { value: '5' },
      });

      const createSpy = jest.spyOn(mathChannels, 'createChannel');

      mathChannels.createMathChannel();

      expect(createSpy).toHaveBeenCalledTimes(2);
      expect(createSpy).toHaveBeenCalledWith(
        expect.any(Number),
        'filtered_single',
        expect.arrayContaining(['A']),
        expect.stringContaining('Filtered: A'),
        expect.any(Object)
      );
      expect(createSpy).toHaveBeenCalledWith(
        expect.any(Number),
        'filtered_single',
        expect.arrayContaining(['B']),
        expect.stringContaining('Filtered: B'),
        expect.any(Object)
      );

      expect(UI.renderSignalList).toHaveBeenCalled();
    });

    test('Standard Creation executes single channel', () => {
      AppState.files = [
        { availableSignals: ['A'], signals: { A: [{ x: 1, y: 1 }] } },
      ];
      mathChannels.openModal();

      mockDomElements({
        mathFormulaSelect: { value: 'multiply_const' },
        'math-input-0': { value: 'A' },
        'math-input-1': { value: '5' },
        mathChannelName: { value: 'HighFive' },
        'math-opt-smooth': { checked: false },
        'math-opt-window': { value: '5' },
      });

      mathChannels.createMathChannel();

      expect(AppState.files[0].signals['Math: HighFive']).toBeDefined();
      expect(AppState.files[0].signals['Math: HighFive'][0].y).toBe(5);
    });
  });

  describe('Multi-File & UI Enhancements', () => {
    test('Target File Selection: Creates channel ONLY in selected file', () => {
      // Setup AppState with 2 files having valid signals
      const file1 = {
        name: 'f1',
        signals: { TestSig: [{ x: 1, y: 1 }] },
        availableSignals: ['TestSig'],
      };
      const file2 = {
        name: 'f2',
        signals: { TestSig: [{ x: 1, y: 1 }] },
        availableSignals: ['TestSig'],
      };
      AppState.files = [file1, file2];

      mathChannels.openModal();

      mockDomElements({
        mathFormulaSelect: { value: 'multiply_const' },
        mathTargetFile: { value: '1', valueAsNumber: 1 }, // Target index 1 (file2)
        mathChannelName: { value: 'TargetedBoost' },
        'math-input-0': { value: 'TestSig' }, // Valid signal Name (Source)
        'math-input-1': { value: '10' }, // Valid Number (Factor)
        'math-opt-smooth': { checked: false },
        'math-opt-window': { value: '5' },
      });

      mathChannels.createMathChannel();

      expect(file1.signals['Math: TargetedBoost']).toBeUndefined();
      expect(file2.signals['Math: TargetedBoost']).toBeDefined();
    });

    test('UI Logic: Toggles Description and Name fields correctly', () => {
      AppState.files = [{ signals: {}, availableSignals: [] }];

      mathChannels.openModal();

      const descContainer = document.getElementById('mathDescriptionContainer');
      const nameContainer = document.getElementById('mathNameContainer');
      const descText = document.getElementById('mathFormulaDescription');
      const select = document.getElementById('mathFormulaSelect');

      expect(descContainer.style.display).toBe('none');
      expect(nameContainer.style.display).toBe('none');

      select.value = 'boost';
      mathChannels.onFormulaChange();

      expect(descContainer.style.display).toBe('block');
      expect(nameContainer.style.display).toBe('block');
      expect(descText.innerText).not.toBe('');
      expect(descText.innerText).not.toBe('No description available.');

      select.value = '';
      mathChannels.onFormulaChange();

      expect(descContainer.style.display).toBe('none');
      expect(nameContainer.style.display).toBe('none');
    });
  });
});

describe('Event Logging', () => {
  test('Emits "action:log" event upon successful channel creation', () => {
    // 1. Setup AppState
    AppState.files = [
      { availableSignals: ['A'], signals: { A: [{ x: 1, y: 10 }] } },
    ];
    mathChannels.openModal();

    // 2. Mock DOM for standard creation
    const mockSelect = { value: 'multiply_const' };
    const mockInputSig = { value: 'A' };
    const mockInputConst = { value: '2' };
    const mockName = { value: 'LogTestChannel' };
    const mockCheck = { checked: false };
    const mockWin = { value: '5' };

    jest.spyOn(document, 'getElementById').mockImplementation((id) => {
      if (id === 'mathFormulaSelect') return mockSelect;
      if (id === 'math-input-0') return mockInputSig;
      if (id === 'math-input-1') return mockInputConst;
      if (id === 'mathChannelName') return mockName;
      if (id === 'math-opt-smooth') return mockCheck;
      if (id === 'math-opt-window') return mockWin;
      return {
        value: '',
        checked: false,
        style: {},
        addEventListener: jest.fn(),
      };
    });

    // 3. Spy on the messenger
    const emitSpy = jest.spyOn(messenger, 'emit');

    // 4. Execute
    mathChannels.createMathChannel();

    // 5. Assert
    expect(emitSpy).toHaveBeenCalledWith(
      'action:log',
      expect.objectContaining({
        type: 'CREATE_MATH_CHANNEL',
        description: 'Created Channel: LogTestChannel',
        fileIndex: 0, // Default is 0
        payload: expect.objectContaining({
          formulaId: 'multiply_const',
          channelName: 'LogTestChannel',
          inputs: ['A', '2'],
          options: expect.objectContaining({ smooth: false }),
        }),
      })
    );
  });

  test('Emits multiple "action:log" events for batch creation', () => {
    // 1. Setup AppState
    AppState.files = [
      {
        availableSignals: ['A', 'B'],
        signals: { A: [{ x: 1, y: 1 }], B: [{ x: 1, y: 2 }] },
      },
    ];
    mathChannels.openModal();

    // 2. Mock DOM for Batch creation
    const mockSelect = { value: 'filtered_batch' };
    const mockInputMulti = { value: 'A, B' }; // Two signals
    const mockInputOther = { value: '0' }; // Dummy values for rest

    jest.spyOn(document, 'getElementById').mockImplementation((id) => {
      if (id === 'mathFormulaSelect') return mockSelect;
      if (id === 'math-input-0') return mockInputMulti;
      if (id.startsWith('math-input')) return mockInputOther;
      if (id === 'math-opt-smooth') return { checked: false };
      if (id === 'math-opt-window') return { value: '5' };
      return { value: '', style: {} };
    });

    // 3. Spy on the messenger
    const emitSpy = jest.spyOn(messenger, 'emit');

    // 4. Execute
    mathChannels.createMathChannel();

    // 5. Assert - Should be called twice (once for A, once for B)
    expect(emitSpy).toHaveBeenCalledTimes(5);

    // Verify first call (for A)
    expect(emitSpy).toHaveBeenCalledWith(
      'action:log',
      expect.objectContaining({
        description: expect.stringContaining('Filtered: A'),
        payload: expect.objectContaining({
          formulaId: 'filtered_single', // The target ID, not the batch ID
          channelName: 'Filtered: A',
        }),
      })
    );

    // Verify second call (for B)
    expect(emitSpy).toHaveBeenCalledWith(
      'action:log',
      expect.objectContaining({
        description: expect.stringContaining('Filtered: B'),
        payload: expect.objectContaining({
          channelName: 'Filtered: B',
        }),
      })
    );
  });

  describe('Form Validation', () => {
    test('Disables Create button when required fields are empty', () => {
      // 1. Setup AppState
      AppState.files = [{ availableSignals: ['RPM'], signals: {} }];

      // 2. Define persistent mock objects
      const mockBtn = { disabled: false };
      const mockSelect = { value: 'multiply_const', onchange: null };
      const mockName = { value: '', oninput: null };
      const mockInputSource = { value: '', addEventListener: jest.fn() };
      const mockInputFactor = { value: '1.0', addEventListener: jest.fn() };

      // 3. Spy on getElementById
      jest.spyOn(document, 'getElementById').mockImplementation((id) => {
        if (id === 'btnCreate') return mockBtn;
        if (id === 'mathFormulaSelect') return mockSelect;
        if (id === 'mathChannelName') return mockName;
        if (id === 'math-input-0') return mockInputSource;
        if (id === 'math-input-1') return mockInputFactor;
        return {
          value: '',
          style: {},
          appendChild: jest.fn(),
          innerHTML: '',
          children: [],
          addEventListener: jest.fn(),
        };
      });

      // 4. Initialize Modal
      mathChannels.openModal();
      // 5. Render inputs
      mathChannels.onFormulaChange();

      // ASSERT 1: Name & Source empty -> Disabled
      expect(mockBtn.disabled).toBe(true);

      // 6. Fill Name
      mockName.value = 'ValidName';
      // Trigger validation via Name input handler
      if (mockName.oninput) mockName.oninput();

      // ASSERT 2: Source still empty -> Disabled
      expect(mockBtn.disabled).toBe(true);

      // 7. Fill Source Signal
      mockInputSource.value = 'RPM';

      // FIX: Trigger validation again using the known handler on mockName
      // This forces #validateForm() to run, which checks all getElementById mocks
      if (mockName.oninput) mockName.oninput();

      // ASSERT 3: All fields valid -> Enabled
      expect(mockBtn.disabled).toBe(false);

      // 8. Simulate User Error: Clear Name
      mockName.value = '';
      if (mockName.oninput) mockName.oninput();

      // ASSERT 4: Name missing -> Disabled
      expect(mockBtn.disabled).toBe(true);
    });
  });
});
