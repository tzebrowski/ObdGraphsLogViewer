import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { signalRegistry } from '../src/signalregistry.js';

describe('SignalRegistry', () => {
  beforeEach(() => {
    // Reset any local mappings that might carry over between tests
    signalRegistry.pidMap = {};
    signalRegistry.metadata = {};
    signalRegistry.mappings = {};
  });

  describe('findSignal()', () => {
    test('returns null if availableSignals is empty or null', () => {
      expect(signalRegistry.findSignal('Engine Speed', [])).toBeNull();
      expect(signalRegistry.findSignal('Engine Speed', null)).toBeNull();
    });

    test('returns the canonical key if it exists directly in availableSignals', () => {
      const signals = ['Voltage', 'Engine Speed', 'Temp'];
      expect(signalRegistry.findSignal('Engine Speed', signals)).toBe(
        'Engine Speed'
      );
    });

    test('finds signal via partial match with word boundaries', () => {
      signalRegistry.mappings['Latitude'] = ['Lat'];
      const signals = ['Time', 'GPS Lat', 'Altitude'];
      expect(signalRegistry.findSignal('Latitude', signals)).toBe('GPS Lat');
    });

    test('ignores partial matches inside other words (Word Boundary Check)', () => {
      signalRegistry.mappings['Latitude'] = ['lat'];
      const signals = ['Calculated Load', 'Plate Position'];
      expect(signalRegistry.findSignal('Latitude', signals)).toBeNull();
    });
  });

  describe('getCanonicalKey() [Strict Anti-Squashing]', () => {
    test('returns the key itself if the input matches a canonical key', () => {
      signalRegistry.mappings['Engine Speed'] = [];
      expect(signalRegistry.getCanonicalKey('Engine Speed')).toBe(
        'Engine Speed'
      );
    });

    test('returns canonical key via EXACT alias match (Case Insensitive)', () => {
      signalRegistry.mappings['Engine Speed'] = ['RPM'];
      expect(signalRegistry.getCanonicalKey('rpm')).toBe('Engine Speed');
    });

    test('STRICT MATCHING: does NOT squash distinct target names into generic ones', () => {
      // If the registry knows "Boost", it should NOT capture "Boost Target" via partial match
      signalRegistry.mappings['Boost'] = ['Boost Pressure'];

      expect(signalRegistry.getCanonicalKey('Boost Target')).toBe(
        'Boost Target'
      );
      expect(signalRegistry.getCanonicalKey('Boost Measured')).toBe(
        'Boost Measured'
      );
    });

    test('returns the raw signal name if no exact mapping is found (Fallback)', () => {
      expect(signalRegistry.getCanonicalKey('Unknown Signal 123')).toBe(
        'Unknown Signal 123'
      );
    });
  });

  describe('init() - Fetching, Parsing, and Caching', () => {
    let mockStorage = {};
    let originalFetch;

    beforeEach(() => {
      originalFetch = global.fetch;
      global.fetch = jest.fn();

      mockStorage = {};

      // Properly mock localStorage for Jest/JSDOM using defineProperty
      const localStorageMock = {
        getItem: jest.fn((key) => mockStorage[key] || null),
        setItem: jest.fn((key, val) => {
          mockStorage[key] = val;
        }),
        removeItem: jest.fn((key) => {
          delete mockStorage[key];
        }),
        clear: jest.fn(() => {
          mockStorage = {};
        }),
      };

      Object.defineProperty(window, 'localStorage', {
        value: localStorageMock,
        writable: true,
      });
    });

    afterEach(() => {
      global.fetch = originalFetch;
      jest.clearAllMocks();
    });

    test('fetches from network, parses multiline descriptions correctly, and saves to cache', async () => {
      const mockNetworkData = [
        { id: '1001', description: 'Boost\nTarget', units: 'bar' },
        { id: '1002', description: 'Boost\nMeasured', units: 'bar' },
      ];

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => mockNetworkData,
      });

      await signalRegistry.init(['mock_url.json']);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        'obd_dict_mock_url.json',
        expect.stringContaining('Boost\\nTarget') // JSON.stringify escapes the \n
      );

      // Verify that the newline was replaced by a space, keeping them distinct
      expect(signalRegistry.getCanonicalByPid('1001')).toBe('Boost Target');
      expect(signalRegistry.getCanonicalByPid('1002')).toBe('Boost Measured');
      expect(signalRegistry.getSignalMetadata('Boost Target').units).toBe(
        'bar'
      );
    });

    test('loads from localStorage cache if valid and within TTL', async () => {
      const validCache = {
        timestamp: Date.now(),
        data: [{ id: '2050', description: 'Cached Engine Speed' }],
      };
      mockStorage['obd_dict_cached_url.json'] = JSON.stringify(validCache);

      await signalRegistry.init(['cached_url.json']);

      // Network should NOT be hit
      expect(global.fetch).not.toHaveBeenCalled();

      // Data should be populated from cache
      expect(signalRegistry.getCanonicalByPid('2050')).toBe(
        'Cached Engine Speed'
      );
    });

    test('ignores cache and fetches network if cache is older than 7 days', async () => {
      const expiredCache = {
        timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 days old
        data: [{ id: '3000', description: 'Old Data' }],
      };
      mockStorage['obd_dict_expired_url.json'] = JSON.stringify(expiredCache);

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => [{ id: '3000', description: 'Fresh Network Data' }],
      });

      await signalRegistry.init(['expired_url.json']);

      // Network MUST be hit because cache expired
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(signalRegistry.getCanonicalByPid('3000')).toBe(
        'Fresh Network Data'
      );
    });
  });
});
