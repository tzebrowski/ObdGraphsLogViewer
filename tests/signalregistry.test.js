import { jest, describe, test, expect } from '@jest/globals';
import { signalRegistry } from '../src/signalregistry.js';

describe('SignalRegistry', () => {
  describe('findSignal()', () => {
    test('returns null if availableSignals is empty or null', () => {
      expect(signalRegistry.findSignal('Engine Speed', [])).toBeNull();
      expect(signalRegistry.findSignal('Engine Speed', null)).toBeNull();
    });

    test('returns the canonical key if it exists directly in availableSignals', () => {
      const signals = ['Voltage', 'Engine Speed', 'Temp'];
      // Should find "Engine Speed" directly
      expect(signalRegistry.findSignal('Engine Speed', signals)).toBe(
        'Engine Speed'
      );
    });

    test('finds signal via exact alias match (Case Insensitive)', () => {
      // Mapping: 'Engine Speed' includes 'RPM'
      const signals = ['Voltage', 'rpm', 'Temp'];
      expect(signalRegistry.findSignal('Engine Speed', signals)).toBe('rpm');
    });

    test('finds signal via partial match with word boundaries', () => {
      // Mapping: 'Latitude' includes 'Lat'
      // Should match "GPS Lat" because "Lat" is a distinct word
      const signals = ['Time', 'GPS Lat', 'Altitude'];
      expect(signalRegistry.findSignal('Latitude', signals)).toBe('GPS Lat');
    });

    test('ignores partial matches inside other words (Word Boundary Check)', () => {
      // Mapping: 'Latitude' includes 'lat'
      // Should NOT match "Calculated" even though it contains "lat"
      const signals = ['Calculated Load', 'Plate Position'];
      expect(signalRegistry.findSignal('Latitude', signals)).toBeNull();
    });

    test('finds signal when alias is surrounded by symbols', () => {
      // Mapping: 'Latitude' includes 'lat'
      // Should match "GPS-Lat" or "(Lat)"
      const signals = ['GPS-Lat', 'Other'];
      expect(signalRegistry.findSignal('Latitude', signals)).toBe('GPS-Lat');
    });

    test('prioritizes exact alias matches over partial matches', () => {
      const signals = ['Engine RPM', 'RPM'];
      expect(signalRegistry.findSignal('Engine Speed', signals)).toBe('RPM');
    });

    test('returns first matching alias if multiple exist', () => {
      const signals = ['Velocity', 'Speed'];
      expect(signalRegistry.findSignal('Vehicle Speed', signals)).toBe('Speed');
    });

    test('returns null if no matching signal is found', () => {
      const signals = ['Voltage', 'Temp', 'Pressure'];
      expect(signalRegistry.findSignal('Engine Speed', signals)).toBeNull();
    });

    test('handles unknown canonical keys gracefully (returns null)', () => {
      const signals = ['RPM', 'Speed'];
      expect(signalRegistry.findSignal('NonExistentKey', signals)).toBeNull();
    });
  });

  describe('getCanonicalKey()', () => {
    test('returns the key itself if the input matches a canonical key', () => {
      expect(signalRegistry.getCanonicalKey('Engine Speed')).toBe(
        'Engine Speed'
      );
    });

    test('returns canonical key via alias match (Word Boundary)', () => {
      // 'Gas Pedal Position' has alias 'TPS'
      // Should match "TPS Sensor"
      expect(signalRegistry.getCanonicalKey('TPS Sensor')).toBe('TPS Sensor');
    });

    test('does NOT return canonical key for partial word match', () => {
      // 'Latitude' alias 'lat' should NOT match "Calculated"
      // If logic was loose, "Calculated" would map to "Latitude".
      // Correct behavior: returns "Calculated" (raw)
      expect(signalRegistry.getCanonicalKey('Calculated')).toBe('Calculated');
    });

    test('returns the raw signal name if no mapping is found (Fallback)', () => {
      expect(signalRegistry.getCanonicalKey('Unknown Signal 123')).toBe(
        'Unknown Signal 123'
      );
    });
  });
});
