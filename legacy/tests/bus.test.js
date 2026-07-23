import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { messenger } from '../src/bus.js';

describe('EventEmitter (messenger)', () => {
  let callback;

  beforeEach(() => {
    // Clear all events before each test to ensure isolation
    messenger.events.clear();
    callback = jest.fn();
  });

  test('should call the callback when the event is emitted', () => {
    messenger.on('test-event', callback);
    messenger.emit('test-event', { payload: 'hello' });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ payload: 'hello' });
  });

  test('should support multiple listeners for the same event', () => {
    const callback2 = jest.fn();
    messenger.on('multi', callback);
    messenger.on('multi', callback2);

    messenger.emit('multi', 'data');

    expect(callback).toHaveBeenCalledWith('data');
    expect(callback2).toHaveBeenCalledWith('data');
  });

  test('should stop calling the callback after off is called', () => {
    messenger.on('cancel-event', callback);
    messenger.off('cancel-event', callback);
    messenger.emit('cancel-event');

    expect(callback).not.toHaveBeenCalled();
  });

  test('should unsubscribe via the returned function from on()', () => {
    const unsubscribe = messenger.on('quick-off', callback);
    unsubscribe();
    messenger.emit('quick-off');

    expect(callback).not.toHaveBeenCalled();
  });

  test('should only fire once when using once()', () => {
    messenger.once('single-fire', callback);

    messenger.emit('single-fire', 1);
    messenger.emit('single-fire', 2);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(1);
  });

  test('should not crash if a listener throws an error', () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const brokenListener = () => {
      throw new Error('Boom');
    };

    messenger.on('error-test', brokenListener);
    messenger.on('error-test', callback);

    // This should run without throwing
    expect(() => messenger.emit('error-test')).not.toThrow();

    // The second listener should still get called
    expect(callback).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  test('should handle emitting events that have no listeners', () => {
    expect(() => messenger.emit('non-existent')).not.toThrow();
  });

  test('should remove event key from Map when last listener is removed', () => {
    messenger.on('cleanup', callback);
    messenger.off('cleanup', callback);

    expect(messenger.events.has('cleanup')).toBe(false);
  });
});
