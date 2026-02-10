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

    test('finds signal via partial match (substring)', () => {
      // Mapping: 'Latitude' includes 'Lat' or 'GPS-Lat'
      const signals = ['Time', 'GPS Latitude (deg)', 'Altitude'];
      expect(signalRegistry.findSignal('Latitude', signals)).toBe(
        'GPS Latitude (deg)'
      );
    });

    test('prioritizes exact alias matches over partial matches', () => {
      // If we have "RPM" (exact match for alias) and "Engine RPM" (partial match)
      // The code checks for exact string matches in the alias list first.
      const signals = ['Engine RPM', 'RPM'];

      // Assuming 'RPM' is defined earlier in the alias list or matched by the logic preference
      // The logic tries exact matches of aliases against the available signals first.
      expect(signalRegistry.findSignal('Engine Speed', signals)).toBe('RPM');
    });

    test('returns first matching alias if multiple exist', () => {
      // 'Vehicle Speed' aliases: ['Vehicle Speed', 'Speed', 'Velocity']
      const signals = ['Velocity', 'Speed'];
      // It should find one of them. Based on implementation, it iterates aliases.
      // If 'Speed' is checked before 'Velocity' in the mapping, it returns 'Speed'.
      // In the provided file: 'Speed' comes before 'Velocity'.
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

    test('returns canonical key via alias match (Contains)', () => {
      // 'Gas Pedal Position' has alias 'TPS'
      expect(signalRegistry.getCanonicalKey('TPS Sensor')).toBe(
        'Gas Pedal Position'
      );
    });

    test('returns canonical key via case-insensitive alias match', () => {
      // 'Torque' has alias 'nm'
      expect(signalRegistry.getCanonicalKey('Engine Torque Nm')).toBe('Torque');
    });

    test('returns the raw signal name if no mapping is found (Fallback)', () => {
      expect(signalRegistry.getCanonicalKey('Unknown Signal 123')).toBe(
        'Unknown Signal 123'
      );
    });
  });
});
