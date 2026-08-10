import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { debounce } from '../src/debounce.js';

describe('Debounce Utility', () => {
  let func;
  let debouncedFunc;

  beforeEach(() => {
    // Enable fake timers to control setTimeout
    jest.useFakeTimers();
    func = jest.fn();
    debouncedFunc = debounce(func, 1000);
  });

  afterEach(() => {
    // Clean up timers after each test
    jest.clearAllTimers();
  });

  test('should execute the function after the specified delay', () => {
    debouncedFunc();

    // Check that function hasn't fired yet
    expect(func).not.toHaveBeenCalled();

    // Fast-forward 1000ms
    jest.advanceTimersByTime(1000);

    // Now it should have been called
    expect(func).toHaveBeenCalledTimes(1);
  });

  test('should reset the timer if called repeatedly', () => {
    debouncedFunc(); // First call

    jest.advanceTimersByTime(500);
    debouncedFunc(); // Second call resets the 1000ms timer

    jest.advanceTimersByTime(500);
    // Still not called because only 500ms passed since last call
    expect(func).not.toHaveBeenCalled();

    jest.advanceTimersByTime(500);
    // Finally fires 1000ms after the second call
    expect(func).toHaveBeenCalledTimes(1);
  });

  test('should pass all arguments correctly to the original function', () => {
    const args = ['test-string', 123, { key: 'value' }];
    debouncedFunc(...args);

    jest.advanceTimersByTime(1000);

    // Verifies the ...args logic in executedFunction
    expect(func).toHaveBeenCalledWith(...args);
  });
});
