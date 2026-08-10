import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignalRegistryService } from './signal-registry.service';

describe('SignalRegistryService', () => {
  let registry: SignalRegistryService;

  beforeEach(() => {
    registry = new SignalRegistryService();
  });

  describe('findSignal()', () => {
    it('returns null if availableSignals is empty or null', () => {
      expect(registry.findSignal('Engine Speed', [])).toBeNull();
      expect(registry.findSignal('Engine Speed', null)).toBeNull();
    });

    it('returns the canonical key if it exists directly in availableSignals', () => {
      const signals = ['Voltage', 'Engine Speed', 'Temp'];
      expect(registry.findSignal('Engine Speed', signals)).toBe('Engine Speed');
    });

    it('finds a signal via alias match with word boundaries', () => {
      const signals = ['Time', 'GPS Lat', 'Altitude'];
      expect(registry.findSignal('Latitude', signals)).toBe('GPS Lat');
    });

    it('ignores partial matches inside other words (word boundary check)', () => {
      const signals = ['Calculated Load', 'Plate Position'];
      expect(registry.findSignal('Latitude', signals)).toBeNull();
    });
  });

  describe('getCanonicalKey() [strict anti-squashing]', () => {
    it('returns the key itself if the input matches a canonical key', () => {
      expect(registry.getCanonicalKey('Engine Speed')).toBe('Engine Speed');
    });

    it('returns canonical key via exact alias match (case insensitive)', () => {
      expect(registry.getCanonicalKey('rpm')).toBe('Engine Speed');
    });

    it('does NOT squash distinct target names into a generic known key', () => {
      expect(registry.getCanonicalKey('Boost Target')).toBe('Boost Target');
      expect(registry.getCanonicalKey('Boost Measured')).toBe('Boost Measured');
    });

    it('returns the raw signal name if no exact mapping is found (fallback)', () => {
      expect(registry.getCanonicalKey('Unknown Signal 123')).toBe(
        'Unknown Signal 123'
      );
    });
  });

  describe('isDefaultSignal() / getDefaultSignals()', () => {
    it('reports the built-in default signal set from signals.json', () => {
      expect(registry.getDefaultSignals()).toContain('Engine Speed');
      expect(registry.isDefaultSignal('RPM')).toBe(true);
      expect(registry.isDefaultSignal('Fuel Level')).toBe(false);
    });
  });

  describe('init() - fetching, parsing, and caching', () => {
    let mockStorage: Record<string, string> = {};

    beforeEach(() => {
      mockStorage = {};
      vi.stubGlobal('fetch', vi.fn());
      vi.stubGlobal('localStorage', {
        getItem: vi.fn((key: string) => mockStorage[key] ?? null),
        setItem: vi.fn((key: string, val: string) => {
          mockStorage[key] = val;
        }),
        removeItem: vi.fn((key: string) => {
          delete mockStorage[key];
        }),
        clear: vi.fn(() => {
          mockStorage = {};
        }),
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('fetches from network, parses multiline descriptions, and saves to cache', async () => {
      const mockNetworkData = [
        { id: '1001', description: 'Boost\nTarget', units: 'bar' },
        { id: '1002', description: 'Boost\nMeasured', units: 'bar' },
      ];
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => mockNetworkData,
      } as Response);

      await registry.init(['mock_url.json']);

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'obd_dict_mock_url.json',
        expect.stringContaining('Boost\\nTarget')
      );

      expect(registry.getCanonicalByPid('1001')).toBe('Boost Target');
      expect(registry.getCanonicalByPid('1002')).toBe('Boost Measured');
      expect(registry.getSignalMetadata('Boost Target')?.units).toBe('bar');
    });

    it('loads from localStorage cache if valid and within TTL', async () => {
      const validCache = {
        timestamp: Date.now(),
        data: [{ id: '2050', description: 'Cached Engine Speed' }],
      };
      mockStorage['obd_dict_cached_url.json'] = JSON.stringify(validCache);

      await registry.init(['cached_url.json']);

      expect(fetch).not.toHaveBeenCalled();
      expect(registry.getCanonicalByPid('2050')).toBe('Cached Engine Speed');
    });

    it('ignores cache and fetches network if the cache is older than 7 days', async () => {
      const expiredCache = {
        timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000,
        data: [{ id: '3000', description: 'Old Data' }],
      };
      mockStorage['obd_dict_expired_url.json'] = JSON.stringify(expiredCache);

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => [{ id: '3000', description: 'Fresh Network Data' }],
      } as Response);

      await registry.init(['expired_url.json']);

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(registry.getCanonicalByPid('3000')).toBe('Fresh Network Data');
    });
  });
});
