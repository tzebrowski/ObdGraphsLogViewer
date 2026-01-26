import { describe, test, expect } from '@jest/globals';
import { MATH_DEFINITIONS } from '../src/mathdefinitions.js';

describe('Math Definitions Logic', () => {
  const getDef = (id) => MATH_DEFINITIONS.find((d) => d.id === id);

  describe('Batch Placeholders', () => {
    test('Batch formulas return 0 (placeholders)', () => {
      const batchIds = [
        'filtered_batch',
        'filter_range_batch',
        'smoothing_batch',
      ];
      batchIds.forEach((id) => {
        const def = getDef(id);
        expect(def).toBeDefined();
        expect(def.formula()).toBe(0); // Covers lines 43, 428, etc.
      });
    });
  });

  describe('Power Calculations', () => {
    test('est_power_kgh: (MAF / 3.6) * Factor', () => {
      const def = getDef('est_power_kgh');
      // MAF = 360 kg/h (100 g/s), Factor = 1.35
      // (360 / 3.6) * 1.35 = 100 * 1.35 = 135
      const result = def.formula([360, 1.35]);
      expect(result).toBeCloseTo(135);
    });

    test('est_power_gs: MAF * Factor', () => {
      const def = getDef('est_power_gs');
      // MAF = 100 g/s, Factor = 1.35
      const result = def.formula([100, 1.35]);
      expect(result).toBeCloseTo(135);
    });

    test('power_from_torque: (T * RPM) / 7127', () => {
      const def = getDef('power_from_torque');
      // 500 Nm @ 3000 RPM, Factor 1
      const result = def.formula([500, 3000, 1.0]);
      expect(result).toBeCloseTo(210.46, 1);
    });
  });

  describe('Filter Range Logic', () => {
    const def = getDef('filter_range');

    test('Passes if Inside Range (Mode 1)', () => {
      // Inputs: [Source, Cond, Min, Max, Mode, Fallback]
      // Cond (50) is between 40 and 60
      const res = def.formula([100, 50, 40, 60, 1, 0]);
      expect(res).toBe(100);
    });

    test('Fails if Outside Range (Mode 1)', () => {
      // Cond (30) is NOT between 40 and 60
      const res = def.formula([100, 30, 40, 60, 1, 0]);
      expect(res).toBe(0);
    });

    test('Passes if Outside Range (Mode 0)', () => {
      // Cond (30) IS outside 40-60
      const res = def.formula([100, 30, 40, 60, 0, 0]);
      expect(res).toBe(100);
    });

    test('Fails if Inside Range (Mode 0)', () => {
      // Cond (50) is NOT outside 40-60
      const res = def.formula([100, 50, 40, 60, 0, 0]);
      expect(res).toBe(0);
    });
  });

  describe('Acceleration (Custom Process)', () => {
    const def = getDef('acceleration');

    test('Calculates derivative correctly', () => {
      // 0 to 100 km/h (27.77 m/s) in 5 seconds
      const signals = [
        [
          { x: 0, y: 0 },
          { x: 1000, y: 20 }, // 20 km/h
          { x: 2000, y: 40 }, // 40 km/h
          { x: 5000, y: 100 }, // 100 km/h
        ],
      ];

      const result = def.customProcess(signals, []);

      // Point 1: (20 - 0) / 3.6 / 1s = 5.55 m/s^2
      expect(result[0].y).toBeCloseTo(5.55, 1);

      // Point 3 (Gap jump): (100 - 40) / 3.6 / 3s = 16.66 / 3 = 5.55 m/s^2
      expect(result[2].y).toBeCloseTo(5.55, 1);
    });

    test('Skips dt <= 0', () => {
      const signals = [
        [
          { x: 1000, y: 10 },
          { x: 1000, y: 20 }, // Duplicate time
        ],
      ];
      const result = def.customProcess(signals, []);
      expect(result.length).toBe(0);
    });
  });

  describe('Smoothing (Custom Process)', () => {
    const def = getDef('smoothing');

    test('Calculates Moving Average', () => {
      const signals = [
        [
          { x: 1, y: 10 },
          { x: 2, y: 20 },
          { x: 3, y: 30 },
          { x: 4, y: 40 },
        ],
      ];

      // Window = 2
      const result = def.customProcess(signals, [2]);

      expect(result[0].y).toBe(10); // Avg(10)
      expect(result[1].y).toBe(15); // Avg(10, 20)
      expect(result[2].y).toBe(25); // Avg(20, 30)
      expect(result[3].y).toBe(35); // Avg(30, 40)
    });

    test('Handles Window Size 1', () => {
      const signals = [[{ x: 1, y: 10 }]];
      const result = def.customProcess(signals, [1]);
      expect(result[0].y).toBe(10);
    });
  });

  describe('Filtered Single Logic', () => {
    const def = getDef('filtered_single');

    test('Mode 1: Greater Than', () => {
      // [Source, Cond, Thresh, Mode, Fallback]
      expect(def.formula([100, 50, 40, 1, 0])).toBe(100); // 50 > 40 Pass
      expect(def.formula([100, 30, 40, 1, 0])).toBe(0); // 30 > 40 Fail
    });

    test('Mode 0: Less Than', () => {
      expect(def.formula([100, 30, 40, 0, 0])).toBe(100); // 30 < 40 Pass
      expect(def.formula([100, 50, 40, 0, 0])).toBe(0); // 50 < 40 Fail
    });
  });
});
