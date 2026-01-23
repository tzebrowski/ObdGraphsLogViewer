import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { mathChannels } from '../src/mathchannels.js';
import { AppState } from '../src/config.js';
import { UI } from '../src/ui.js';

UI.renderSignalList = jest.fn();

describe('MathChannels', () => {
  let alertMock;

  beforeEach(() => {
    AppState.files = [];
    alertMock = jest.spyOn(window, 'alert').mockImplementation(() => {});
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
      }).toThrow("No file selected or loaded");
    });

    test('throws error for invalid formula definition', () => {
      AppState.files = [{ signals: {} }];
      expect(() => {
        mathChannels.createChannel(0, 'non_existent_formula', [], 'Test');
      }).toThrow("Invalid formula definition");
    });

    test('throws error if signal missing in file', () => {
      AppState.files = [{ 
        signals: { 'ExistingSignal': [] },
        availableSignals: ['ExistingSignal']
      }];
      const inputMapping = ['ExistingSignal', 'MissingSignal'];
      expect(() => {
        mathChannels.createChannel(0, 'boost', inputMapping, 'Boost');
      }).toThrow("Signal 'MissingSignal' not found");
    });

    test('successfully creates a channel with Multiply by Constant', () => {
      const signalData = [{ x: 0, y: 10 }, { x: 1000, y: 20 }, { x: 2000, y: 30 }];
      AppState.files = [{
        name: 'test.log',
        signals: { 'RPM': signalData },
        availableSignals: ['RPM'],
        metadata: {}
      }];
      const inputMapping = ['RPM', '2.0']; 
      const newName = mathChannels.createChannel(0, 'multiply_const', inputMapping, 'RPM_Doubled');
      
      // Auto-prefix check
      expect(newName).toBe('Math: RPM_Doubled');
      
      const newSignal = AppState.files[0].signals['Math: RPM_Doubled'];
      expect(newSignal[0].y).toBe(20);
      expect(newSignal[1].y).toBe(40);
    });

    test('successfully calculates Boost', () => {
      const mapData = [{ x: 1000, y: 2.5 }];
      const baroData = [{ x: 1000, y: 1.0 }];
      AppState.files = [{
        signals: { 'MAP': mapData, 'Baro': baroData },
        availableSignals: ['MAP', 'Baro']
      }];
      mathChannels.createChannel(0, 'boost', ['MAP', 'Baro'], 'MyBoost');
      const result = AppState.files[0].signals['Math: MyBoost'];
      expect(result[0].y).toBe(1.5);
    });

    test('interpolates data when timestamps do not match', () => {
      const mapData = [{ x: 0, y: 100 }, { x: 2000, y: 300 }];
      const baroData = [{ x: 0, y: 50 }, { x: 1000, y: 60 }, { x: 2000, y: 50 }];
      AppState.files = [{
        signals: { 'MAP': mapData, 'Baro': baroData },
        availableSignals: ['MAP', 'Baro']
      }];
      mathChannels.createChannel(0, 'boost', ['MAP', 'Baro'], 'InterpBoost');
      const result = AppState.files[0].signals['Math: InterpBoost'];
      expect(result[0].x).toBe(0);
      expect(result[0].y).toBe(50);
      expect(result[1].x).toBe(2000);
      expect(result[1].y).toBe(250);
    });

    test('handles boundary conditions for interpolation', () => {
        const master = [{ x: 500, y: 10 }];
        const slave = [{ x: 1000, y: 20 }, { x: 2000, y: 30 }];
        AppState.files = [{
            signals: { 'M': master, 'S': slave },
            availableSignals: ['M', 'S']
        }];
        mathChannels.createChannel(0, 'boost', ['M', 'S'], 'Result');
        const res = AppState.files[0].signals['Math: Result'];
        expect(res[0].y).toBe(10 - 20);
    });
  });

  describe('Formula Specific Coverage', () => {
    test('Calculated Power from Torque', () => {
        const torqueData = [{ x: 100, y: 400 }];
        const rpmData = [{ x: 100, y: 5000 }];
        AppState.files = [{
            signals: { 'TQ': torqueData, 'RPM': rpmData },
            availableSignals: ['TQ', 'RPM']
        }];
        mathChannels.createChannel(0, 'power_from_torque', ['TQ', 'RPM'], 'HP');
        const result = AppState.files[0].signals['Math: HP'];
        const expected = (400 * 5000) / 7127;
        expect(result[0].y).toBeCloseTo(expected, 4);
    });

    test('Estimated Power from kg/h', () => {
        const mafData = [{ x: 1, y: 360 }];
        AppState.files = [{ signals: { 'MAF': mafData }, availableSignals: ['MAF'] }];
        mathChannels.createChannel(0, 'est_power_kgh', ['MAF', '1.35'], 'EstHP');
        const result = AppState.files[0].signals['Math: EstHP'];
        expect(result[0].y).toBeCloseTo(135, 1);
    });

    test('Estimated Power from g/s', () => {
        const mafData = [{ x: 1, y: 100 }];
        AppState.files = [{ signals: { 'MAF': mafData }, availableSignals: ['MAF'] }];
        mathChannels.createChannel(0, 'est_power_gs', ['MAF', '1.35'], 'EstHP');
        const result = AppState.files[0].signals['Math: EstHP'];
        expect(result[0].y).toBeCloseTo(135, 1);
    });

    test('Pressure Ratio with Zero Division check', () => {
        const mapData = [{ x: 1, y: 2000 }, { x: 2, y: 2000 }];
        const baroData = [{ x: 1, y: 1000 }, { x: 2, y: 0 }];
        AppState.files = [{
            signals: { 'MAP': mapData, 'Baro': baroData },
            availableSignals: ['MAP', 'Baro']
        }];
        mathChannels.createChannel(0, 'pressure_ratio', ['MAP', 'Baro'], 'PR');
        const result = AppState.files[0].signals['Math: PR'];
        expect(result[0].y).toBe(2);
        expect(result[1].y).toBe(0);
    });

    test('Acceleration (m/s²) - Custom Process', () => {
        const speedData = [{ x: 0, y: 0 }, { x: 1000, y: 20 }, { x: 2000, y: 40 }];
        AppState.files = [{ signals: { 'Speed': speedData }, availableSignals: ['Speed'] }];
        mathChannels.createChannel(0, 'acceleration', ['Speed', '1'], 'Accel');
        const result = AppState.files[0].signals['Math: Accel'];
        expect(result.length).toBeGreaterThan(0);
        const expectedValue = (20 / 3.6) / 1; 
        expect(result[0].y).toBeCloseTo(expectedValue, 4);
    });

    test('Smoothing (Moving Average) - Custom Process', () => {
        const noisySignal = [{ x: 1, y: 10 }, { x: 2, y: 20 }, { x: 3, y: 10 }, { x: 4, y: 20 }];
        AppState.files = [{ signals: { 'Noisy': noisySignal }, availableSignals: ['Noisy'] }];
        mathChannels.createChannel(0, 'smoothing', ['Noisy', '2'], 'Smooth');
        const result = AppState.files[0].signals['Math: Smooth'];
        expect(result[0].y).toBe(10);
        expect(result[1].y).toBe(15);
        expect(result[2].y).toBe(15);
    });

    test('Filter (Keep if > Threshold)', () => {
        const afrData = [{x:0, y:14.7}, {x:1, y:14.7}, {x:2, y:14.7}];
        const tpsData = [{x:0, y:0},    {x:1, y:50},   {x:2, y:100}];
        
        AppState.files = [{
            signals: { 'AFR': afrData, 'TPS': tpsData },
            availableSignals: ['AFR', 'TPS']
        }];
        
        mathChannels.createChannel(0, 'filter_gt', ['AFR', 'TPS', '90', '0'], 'WOT_AFR');
        const result = AppState.files[0].signals['Math: WOT_AFR'];
        
        expect(result[0].y).toBe(0);    // 0 < 90
        expect(result[1].y).toBe(0);    // 50 < 90
        expect(result[2].y).toBe(14.7); // 100 > 90
    });

    test('Generic Option: Apply Smoothing after calculation', () => {
        const raw = [{x:0, y:10}, {x:1, y:20}, {x:2, y:10}, {x:3, y:20}];
        AppState.files = [{
            signals: { 'S': raw },
            availableSignals: ['S']
        }];
        
        const opts = { smooth: true, smoothWindow: 2 };
        mathChannels.createChannel(0, 'multiply_const', ['S', '1'], 'Smoothed', opts);
        
        const result = AppState.files[0].signals['Math: Smoothed'];
        
        expect(result[1].y).toBe(15);
        expect(result[2].y).toBe(15);
    });
  });

  describe('UI Interactions', () => {
    test('openModal alerts if no files loaded', () => {
      AppState.files = [];
      window.openMathModal();
      expect(alertMock).toHaveBeenCalledWith("Please load a log file first.");
      const modal = document.getElementById('mathModal');
      expect(modal.style.display).toBe('none');
    });

    test('openModal shows modal and populates select if file exists', () => {
      AppState.files = [{ availableSignals: [] }];
      window.openMathModal();
      const modal = document.getElementById('mathModal');
      const select = document.getElementById('mathFormulaSelect');
      expect(modal.style.display).toBe('flex');
      expect(select.options.length).toBeGreaterThan(1);
    });

    test('onMathFormulaChange populates inputs correctly', () => {
      AppState.files = [{ 
        availableSignals: ['MAF g/s', 'Intake Press'],
        signals: {} 
      }];
      
      window.openMathModal();
      const select = document.getElementById('mathFormulaSelect');
      let targetVal = '';
      for(let opt of select.options) {
          if(opt.value === 'multiply_const') targetVal = opt.value;
      }
      select.value = targetVal;
      
      window.onMathFormulaChange();
      
      const container = document.getElementById('mathInputsContainer');
      const inputs = container.querySelectorAll('.template-select, .searchable-input');
      
      expect(inputs.length).toBeGreaterThan(2); 
      
      const smoothCheck = document.getElementById('math-opt-smooth');
      expect(smoothCheck).not.toBeNull();
    });

    test('createMathChannel (executeCreation) reads options and calls createChannel', () => {
      const signalData = [{x:1, y:1}];
      AppState.files = [{
        name: 'f1',
        signals: {'SigA': signalData},
        availableSignals: ['SigA']
      }];

      window.openMathModal();
      const select = document.getElementById('mathFormulaSelect');
      select.value = 'multiply_const';
      window.onMathFormulaChange();
      
      document.getElementById('math-input-0').value = 'SigA';
      document.getElementById('math-input-1').value = '5';
      
      document.getElementById('math-opt-smooth').checked = true;
      document.getElementById('math-opt-window').value = '3';
      
      const spy = jest.spyOn(mathChannels, 'createChannel');
      
      window.createMathChannel();
      
      expect(spy).toHaveBeenCalledWith(
          0, 
          'multiply_const', 
          ['SigA', '5'], 
          expect.anything(), 
          expect.objectContaining({ smooth: true, smoothWindow: 3 })
      );
      
      expect(document.getElementById('mathModal').style.display).toBe('none');
    });
  });
});