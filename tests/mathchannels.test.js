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
        <div id="mathInputsContainer"></div>
        <input id="mathChannelName" type="text" />
        <button id="btnCreate">Create</button>
      </div>
    `;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createChannel Core Logic', () => {
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
      const inputMapping = ['ExistingSignal', 'MissingSignal'];
      expect(() => {
        mathChannels.createChannel(0, 'boost', inputMapping, 'Boost');
      }).toThrow("Signal 'MissingSignal' not found");
    });

    test('successfully creates a channel with Multiply by Constant', () => {
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
      const inputMapping = ['RPM', '2.0'];
      const newName = mathChannels.createChannel(
        0,
        'multiply_const',
        inputMapping,
        'RPM_Doubled'
      );

      expect(newName).toBe('Math: RPM_Doubled');

      const newSignal = AppState.files[0].signals['Math: RPM_Doubled'];
      expect(newSignal[0].y).toBe(20);
      expect(newSignal[1].y).toBe(40);
    });
  });

  describe('Interpolation Edge Cases', () => {
    test('handles single point data', () => {
      const mapData = [{ x: 1000, y: 50 }];
      const baroData = [{ x: 1000, y: 10 }];
      AppState.files = [
        {
          signals: { MAP: mapData, Baro: baroData },
          availableSignals: ['MAP', 'Baro'],
        },
      ];
      mathChannels.createChannel(0, 'boost', ['MAP', 'Baro'], 'SinglePoint');
      const res = AppState.files[0].signals['Math: SinglePoint'];
      expect(res[0].y).toBe(40);
    });

    test('clamps to first value if time is before data start', () => {
      const master = [{ x: 500, y: 10 }];
      const slave = [
        { x: 1000, y: 20 },
        { x: 2000, y: 30 },
      ];
      AppState.files = [
        { signals: { M: master, S: slave }, availableSignals: ['M', 'S'] },
      ];

      mathChannels.createChannel(0, 'boost', ['M', 'S'], 'ClampStart');
      const res = AppState.files[0].signals['Math: ClampStart'];

      expect(res[0].y).toBe(10 - 20);
    });

    test('clamps to last value if time is after data end', () => {
      const master = [{ x: 3000, y: 10 }];
      const slave = [
        { x: 1000, y: 20 },
        { x: 2000, y: 30 },
      ];
      AppState.files = [
        { signals: { M: master, S: slave }, availableSignals: ['M', 'S'] },
      ];

      mathChannels.createChannel(0, 'boost', ['M', 'S'], 'ClampEnd');
      const res = AppState.files[0].signals['Math: ClampEnd'];

      expect(res[0].y).toBe(10 - 30);
    });

    test('returns 0 if data is empty/null', () => {
      const master = [{ x: 1000, y: 10 }];
      const emptySlave = [];
      AppState.files = [
        { signals: { M: master, S: emptySlave }, availableSignals: ['M', 'S'] },
      ];

      mathChannels.createChannel(0, 'boost', ['M', 'S'], 'EmptySlave');
      const res = AppState.files[0].signals['Math: EmptySlave'];
      expect(res[0].y).toBe(10 - 0);
    });
  });

  describe('UI Interactions & Searchable Select', () => {
    test('openModal alerts if no files loaded', () => {
      AppState.files = [];
      window.openMathModal();
      expect(alertMock).toHaveBeenCalledWith('Please load a log file first.');
      const modal = document.getElementById('mathModal');
      expect(modal.style.display).toBe('none');
    });

    test('Searchable Select: Filter logic matches text', () => {
      AppState.files = [
        {
          availableSignals: ['Engine Speed', 'Vehicle Speed', 'Torque'],
          signals: {},
        },
      ];
      window.openMathModal();
      const select = document.getElementById('mathFormulaSelect');
      select.value = 'multiply_const';
      window.onMathFormulaChange();

      const input = document.getElementById('math-input-0');
      const resultsList = input.parentNode.querySelector(
        '.search-results-list'
      );

      input.dispatchEvent(new Event('focus'));
      expect(resultsList.style.display).toBe('block');
      expect(resultsList.children.length).toBe(3);

      input.value = 'Veh';
      input.dispatchEvent(new Event('input'));

      expect(resultsList.children.length).toBe(1);
      expect(resultsList.children[0].textContent).toBe('Vehicle Speed');
    });

    test('Searchable Select: Click option sets value (Single Mode)', () => {
      AppState.files = [{ availableSignals: ['RPM'], signals: {} }];
      window.openMathModal();
      const select = document.getElementById('mathFormulaSelect');
      select.value = 'multiply_const';
      window.onMathFormulaChange();

      const input = document.getElementById('math-input-0');
      input.dispatchEvent(new Event('focus'));

      const option = input.parentNode.querySelector('.search-option');
      option.click();

      expect(input.value).toBe('RPM');
      const list = input.parentNode.querySelector('.search-results-list');
      expect(list.style.display).toBe('none');
    });

    test('Searchable Select: Multi Mode Select All / Deselect All', () => {
      AppState.files = [{ availableSignals: ['A', 'B'], signals: {} }];
      window.openMathModal();
      const select = document.getElementById('mathFormulaSelect');
      select.value = 'filtered_batch';
      window.onMathFormulaChange();

      const input = document.getElementById('math-input-0');
      input.dispatchEvent(new Event('focus'));

      const selectAllBtn = input.parentNode.querySelector('.search-select-all');
      expect(selectAllBtn).toBeTruthy();

      selectAllBtn.click();
      expect(input.value).toContain('A, ');
      expect(input.value).toContain('B, ');

      selectAllBtn.click();
      expect(input.value).toBe('');
    });

    test('Searchable Select: Multi Mode Toggle items', () => {
      AppState.files = [{ availableSignals: ['A', 'B'], signals: {} }];
      window.openMathModal();
      const select = document.getElementById('mathFormulaSelect');
      select.value = 'filtered_batch';
      window.onMathFormulaChange();

      const input = document.getElementById('math-input-0');
      input.dispatchEvent(new Event('focus'));

      const options = input.parentNode.querySelectorAll(
        '.search-option:not(.search-select-all)'
      );

      options[0].click();
      expect(input.value).toContain('A, ');

      options[0].click();
      expect(input.value).not.toContain('A');
    });

    test('Searchable Select: No results found', () => {
      AppState.files = [{ availableSignals: ['RPM'], signals: {} }];
      window.openMathModal();
      const select = document.getElementById('mathFormulaSelect');
      select.value = 'multiply_const';
      window.onMathFormulaChange();

      const input = document.getElementById('math-input-0');
      input.value = 'XYZ';
      input.dispatchEvent(new Event('input'));

      const noRes = input.parentNode.querySelector('.search-no-results');
      expect(noRes).toBeTruthy();
      expect(noRes.textContent).toBe('No signals found');
    });

    test('Closes list when clicking outside', () => {
      AppState.files = [{ availableSignals: ['RPM'], signals: {} }];
      window.openMathModal();
      const select = document.getElementById('mathFormulaSelect');
      select.value = 'multiply_const';
      window.onMathFormulaChange();

      const input = document.getElementById('math-input-0');
      input.dispatchEvent(new Event('focus'));
      const list = input.parentNode.querySelector('.search-results-list');
      expect(list.style.display).toBe('block');

      document.dispatchEvent(new Event('click'));
      expect(list.style.display).toBe('none');
    });

    test('Post-Processing UI Toggles', () => {
      AppState.files = [{ availableSignals: ['S'], signals: {} }];
      window.openMathModal();
      const select = document.getElementById('mathFormulaSelect');
      select.value = 'multiply_const';
      window.onMathFormulaChange();

      const check = document.getElementById('math-opt-smooth');
      const winInput = document.getElementById('math-opt-window');

      expect(winInput.disabled).toBe(true);

      check.click();
      check.dispatchEvent(new Event('change'));
      expect(winInput.disabled).toBe(false);
    });
  });

  describe('Execution & Error Handling', () => {
    test('executeCreation handles errors gracefully', () => {
      AppState.files = [{ availableSignals: ['S'], signals: {} }];
      window.openMathModal();

      const select = document.getElementById('mathFormulaSelect');
      select.value = 'multiply_const';
      window.onMathFormulaChange();

      window.createMathChannel();

      expect(alertMock).toHaveBeenCalledWith(
        expect.stringContaining('Error creating channel')
      );
      expect(consoleErrorMock).toHaveBeenCalled();
    });

    test('executeCreation handles batch empty selection error', () => {
      AppState.files = [{ availableSignals: ['S'], signals: {} }];
      window.openMathModal();
      const select = document.getElementById('mathFormulaSelect');
      select.value = 'filtered_batch';
      window.onMathFormulaChange();

      window.createMathChannel();

      expect(alertMock).toHaveBeenCalledWith(
        expect.stringContaining('No signals selected')
      );
    });

    test('filtered_batch successfully creates multiple channels', () => {
      AppState.files = [
        {
          name: 'batch.json',
          signals: {
            SigA: [{ x: 1, y: 10 }],
            SigB: [{ x: 1, y: 20 }],
            RPM: [{ x: 1, y: 3000 }],
          },
          availableSignals: ['SigA', 'SigB', 'RPM'],
        },
      ];

      window.openMathModal();

      const select = document.getElementById('mathFormulaSelect');
      const opt = document.createElement('option');
      opt.value = 'filtered_batch';
      select.appendChild(opt);
      select.value = 'filtered_batch';

      const container = document.getElementById('mathInputsContainer');
      container.innerHTML = '';

      const createInput = (id, val) => {
        const i = document.createElement('input');
        i.id = id;
        i.value = val;
        container.appendChild(i);
      };

      createInput('math-input-0', 'SigA, SigB');
      createInput('math-input-1', 'RPM');
      createInput('math-input-2', '2500');
      createInput('math-input-3', '1');
      createInput('math-input-4', '0');

      const createSpy = jest.spyOn(mathChannels, 'createChannel');

      window.createMathChannel();

      expect(createSpy).toHaveBeenCalledTimes(2);

      const checkbox = document.createElement('input');
      checkbox.setAttribute('data-key', 'Math: Filtered: SigA');
      document.body.appendChild(checkbox);

      jest.runAllTimers();
    });
  });

  describe('Advanced Coverage & Edge Cases', () => {
    test('Overwrites existing channel without duplicating in availableSignals', () => {
      const data = [{ x: 1, y: 1 }];
      AppState.files = [
        {
          signals: { A: data },
          availableSignals: ['A', 'Math: A_Times_2'],
          metadata: {},
        },
      ];

      const name = mathChannels.createChannel(
        0,
        'multiply_const',
        ['A', '2'],
        'A_Times_2'
      );

      const file = AppState.files[0];
      expect(name).toBe('Math: A_Times_2');

      const count = file.availableSignals.filter(
        (s) => s === 'Math: A_Times_2'
      ).length;
      expect(count).toBe(1);
    });

    test('Skips points where formula returns NaN (Gap generation)', () => {
      const src = [
        { x: 100, y: 10 },
        { x: 200, y: 10 },
      ];
      const cond = [
        { x: 100, y: 5 },
        { x: 200, y: 0 },
      ];

      AppState.files = [
        {
          signals: { Src: src, Cond: cond },
          availableSignals: ['Src', 'Cond'],
        },
      ];

      mathChannels.createChannel(
        0,
        'filtered_single',
        ['Src', 'Cond', '2', '1', 'NaN'],
        'GappedSignal'
      );

      const result = AppState.files[0].signals['Math: GappedSignal'];

      expect(result.length).toBe(1);
      expect(result[0].x).toBe(100);
    });

    test('Formula: AFR Error (Commanded - Measured)', () => {
      const cmd = [{ x: 1, y: 14.7 }];
      const meas = [{ x: 1, y: 13.5 }];
      AppState.files = [
        { signals: { C: cmd, M: meas }, availableSignals: ['C', 'M'] },
      ];

      mathChannels.createChannel(0, 'afr_error', ['C', 'M'], 'Err');
      const res = AppState.files[0].signals['Math: Err'];
      expect(res[0].y).toBeCloseTo(1.2, 1);
    });

    test('Formula: Filter Less Than (<)', () => {
      const src = [{ x: 1, y: 100 }];
      const cond = [{ x: 1, y: 50 }];
      AppState.files = [
        { signals: { S: src, C: cond }, availableSignals: ['S', 'C'] },
      ];

      mathChannels.createChannel(
        0,
        'filtered_single',
        ['S', 'C', '60', '0', '0'],
        'Res1'
      );
      expect(AppState.files[0].signals['Math: Res1'][0].y).toBe(100);

      mathChannels.createChannel(
        0,
        'filtered_single',
        ['S', 'C', '40', '0', '0'],
        'Res2'
      );
      expect(AppState.files[0].signals['Math: Res2'][0].y).toBe(0);
    });

    test('Interpolation: Exact timestamp match', () => {
      const data = [
        { x: 100, y: 1 },
        { x: 200, y: 2 },
        { x: 300, y: 3 },
      ];
      const file = { signals: { A: data }, availableSignals: ['A'] };
      AppState.files = [file];

      mathChannels.createChannel(0, 'multiply_const', ['A', '1'], 'Copy');
      const res = file.signals['Math: Copy'];

      expect(res[1].x).toBe(200);
      expect(res[1].y).toBe(2);
    });

    test('Input Validation: Invalid Constant Value', () => {
      AppState.files = [{ signals: { A: [] }, availableSignals: ['A'] }];
      expect(() => {
        mathChannels.createChannel(
          0,
          'multiply_const',
          ['A', 'invalid_number'],
          'Err'
        );
      }).toThrow('Invalid constant value');
    });

    test('Initialization: Handle missing metadata gracefully', () => {
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
    });
  });
});
