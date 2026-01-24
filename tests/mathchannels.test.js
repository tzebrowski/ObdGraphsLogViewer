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

UI.renderSignalList = jest.fn();

describe('MathChannels', () => {
  let alertMock;
  let consoleErrorMock;

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

        <button id="btnCreate">Create</button>
      </div>
    `;
  });

  afterEach(() => {
    jest.clearAllMocks();
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
      }).toThrow('Invalid constant value');
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
      expect(typeof window.openMathModal).toBe('function');
      expect(typeof window.closeMathModal).toBe('function');
      expect(typeof window.onMathFormulaChange).toBe('function');
      expect(typeof window.createMathChannel).toBe('function');
    });

    test('openModal: Populates select options', () => {
      AppState.files = [{ availableSignals: [], signals: {} }];
      window.openMathModal();

      const select = document.getElementById('mathFormulaSelect');
      expect(select.children.length).toBeGreaterThan(5);
      expect(document.getElementById('mathModal').style.display).toBe('flex');
    });

    test('onFormulaChange: Renders inputs correctly for constant vs signal', () => {
      AppState.files = [{ availableSignals: ['RPM'], signals: {} }];
      window.openMathModal();
      const select = document.getElementById('mathFormulaSelect');

      select.value = 'multiply_const';
      window.onMathFormulaChange();

      const container = document.getElementById('mathInputsContainer');
      const inputs = container.querySelectorAll('input');
      expect(inputs.length).toBe(4);

      const labels = container.querySelectorAll('.math-label-small');
      expect(labels[0].textContent).toBe('Source Signal');
      expect(labels[1].textContent).toBe('Factor');
    });

    test('Searchable Select: Multi-Select "Select All / Deselect All"', () => {
      AppState.files = [{ availableSignals: ['SigA', 'SigB'], signals: {} }];
      window.openMathModal();

      const select = document.getElementById('mathFormulaSelect');
      select.value = 'filtered_batch';
      window.onMathFormulaChange();

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

    test('Searchable Select: Adding item manually via search', () => {
      AppState.files = [{ availableSignals: ['Alpha', 'Beta'], signals: {} }];
      window.openMathModal();
      const select = document.getElementById('mathFormulaSelect');
      select.value = 'filtered_batch';
      window.onMathFormulaChange();

      const input = document.getElementById('math-input-0');

      input.value = 'Alpha, Be';
      input.dispatchEvent(new Event('input'));

      const list = input.parentNode.querySelector('.search-results-list');
      const options = list.querySelectorAll(
        '.search-option:not(.search-select-all)'
      );

      expect(options.length).toBe(1);
      expect(options[0].textContent).toBe('Beta');

      options[0].click();
      expect(input.value).toContain('Alpha, Beta,');
    });

    test('Post-Processing Checkbox toggles window input', () => {
      AppState.files = [{ availableSignals: ['A'], signals: {} }];
      window.openMathModal();
      const select = document.getElementById('mathFormulaSelect');
      select.value = 'multiply_const';
      window.onMathFormulaChange();

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
    test('Batch Creation executes createChannel multiple times', () => {
      AppState.files = [
        {
          availableSignals: ['A', 'B'],
          signals: { A: [{ x: 1, y: 1 }], B: [{ x: 1, y: 2 }] },
        },
      ];

      window.openMathModal();
      const select = document.getElementById('mathFormulaSelect');
      select.value = 'filtered_batch';
      window.onMathFormulaChange();

      document.getElementById('math-input-0').value = 'A, B';
      document.getElementById('math-input-1').value = 'A';
      document.getElementById('math-input-2').value = '0';
      document.getElementById('math-input-3').value = '1';
      document.getElementById('math-input-4').value = '0';

      const createSpy = jest.spyOn(mathChannels, 'createChannel');

      window.createMathChannel();

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

      const modal = document.getElementById('mathModal');
      expect(modal.style.display).toBe('none');
    });

    test('Standard Creation executes single channel', () => {
      AppState.files = [
        { availableSignals: ['A'], signals: { A: [{ x: 1, y: 1 }] } },
      ];
      window.openMathModal();
      const select = document.getElementById('mathFormulaSelect');
      select.value = 'multiply_const';
      window.onMathFormulaChange();

      document.getElementById('math-input-0').value = 'A';
      document.getElementById('math-input-1').value = '5';
      document.getElementById('mathChannelName').value = 'HighFive';

      window.createMathChannel();

      expect(AppState.files[0].signals['Math: HighFive']).toBeDefined();
      expect(AppState.files[0].signals['Math: HighFive'][0].y).toBe(5);
    });

    test('Handles Post-Processing (Smoothing) via Options', () => {
      AppState.files = [
        {
          availableSignals: ['A'],
          signals: {
            A: [
              { x: 1, y: 10 },
              { x: 2, y: 20 },
            ],
          },
        },
      ];
      window.openMathModal();
      const select = document.getElementById('mathFormulaSelect');
      select.value = 'multiply_const';
      window.onMathFormulaChange();

      document.getElementById('math-input-0').value = 'A';
      document.getElementById('math-input-1').value = '1';
      document.getElementById('mathChannelName').value = 'SmoothedA';

      document.getElementById('math-opt-smooth').checked = true;
      document.getElementById('math-opt-window').value = '2';

      window.createMathChannel();

      const res = AppState.files[0].signals['Math: SmoothedA'];
      expect(res[1].y).toBe(15);
    });

    test('Shows Alert on Execution Error', () => {
      AppState.files = [{ availableSignals: ['A'], signals: {} }];
      window.openMathModal();
      const select = document.getElementById('mathFormulaSelect');
      select.value = 'multiply_const';
      window.onMathFormulaChange();

      document.getElementById('math-input-0').value = 'A';
      document.getElementById('math-input-1').value = '1';

      window.createMathChannel();

      expect(alertMock).toHaveBeenCalledWith(
        expect.stringContaining('Error creating channel')
      );
    });
  });

  describe('Multi-File & UI Enhancements', () => {
    test('Target File Selection: Creates channel ONLY in selected file', () => {
      const data1 = [{ x: 1, y: 100 }];
      const data2 = [{ x: 1, y: 200 }];

      AppState.files = [
        {
          name: 'File_A.json',
          signals: { RPM: data1 },
          availableSignals: ['RPM'],
          metadata: {},
        },
        {
          name: 'File_B.json',
          signals: { RPM: data2 },
          availableSignals: ['RPM'],
          metadata: {},
        },
      ];

      window.openMathModal();

      const select = document.getElementById('mathFormulaSelect');
      select.value = 'multiply_const';
      window.onMathFormulaChange();

      const fileSelect = document.getElementById('mathTargetFile');
      expect(fileSelect).not.toBeNull();
      expect(fileSelect.options.length).toBe(2);

      fileSelect.value = '1';
      fileSelect.dispatchEvent(new Event('change'));

      const input0 = document.getElementById('math-input-0');
      const input1 = document.getElementById('math-input-1');

      input0.value = 'RPM';
      input1.value = '2';

      const nameInput = document.getElementById('mathChannelName');
      nameInput.value = 'TargetedBoost';

      window.createMathChannel();

      const file1 = AppState.files[0];
      const file2 = AppState.files[1];

      expect(file1.signals['Math: TargetedBoost']).toBeUndefined();

      expect(file2.signals['Math: TargetedBoost']).toBeDefined();
      expect(file2.signals['Math: TargetedBoost'][0].y).toBe(400);
    });

    test('UI Logic: Toggles Description and Name fields correctly', () => {
      AppState.files = [{ signals: {}, availableSignals: [] }];

      window.openMathModal();

      const descContainer = document.getElementById('mathDescriptionContainer');
      const nameContainer = document.getElementById('mathNameContainer');
      const descText = document.getElementById('mathFormulaDescription');
      const select = document.getElementById('mathFormulaSelect');

      expect(descContainer.style.display).toBe('none');
      expect(nameContainer.style.display).toBe('none');

      select.value = 'boost';
      window.onMathFormulaChange();

      expect(descContainer.style.display).toBe('block');
      expect(nameContainer.style.display).toBe('block');
      expect(descText.innerText).not.toBe('');
      expect(descText.innerText).not.toBe('No description available.');

      select.value = '';
      window.onMathFormulaChange();

      expect(descContainer.style.display).toBe('none');
      expect(nameContainer.style.display).toBe('none');
    });
  });
});
