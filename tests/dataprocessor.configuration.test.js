import { jest, describe, test, expect } from '@jest/globals';
import { Config } from '../src/config.js';

describe('DataProcessor - Configuration Error Handling', () => {
  test('loadConfiguration handles missing templates gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const { DataProcessor } = await import(
      `../src/dataprocesssor.js?t=${Date.now()}`
    );

    await DataProcessor.loadConfiguration(null);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Missing templates')
    );

    Object.defineProperty(Config, 'ANOMALY_TEMPLATES', {
      value: {},
      writable: false,
      configurable: true,
    });

    await DataProcessor.loadConfiguration({ test: true });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Config Loader:',
      expect.any(TypeError)
    );

    // Cleanup
    Object.defineProperty(Config, 'ANOMALY_TEMPLATES', {
      value: {},
      writable: true,
    });
    consoleSpy.mockRestore();
  });
});
