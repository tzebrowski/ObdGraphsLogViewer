class EventEmitter {
  constructor() {
    // Store events and their listeners in a Map
    // Key: event name, Value: Set of callback functions
    this.events = new Map();
  }

  // Subscribe to an event
  on(eventName, callback) {
    if (!this.events.has(eventName)) {
      this.events.set(eventName, new Set());
    }
    this.events.get(eventName).add(callback);

    // Return an unsubscribe function for convenience
    return () => this.off(eventName, callback);
  }

  // Trigger an event
  emit(eventName, data) {
    const listeners = this.events.get(eventName);
    if (listeners) {
      listeners.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in listener for ${eventName}:`, error);
        }
      });
    }
  }

  // Unsubscribe from an event
  off(eventName, callback) {
    const listeners = this.events.get(eventName);
    if (listeners) {
      listeners.delete(callback);
      // Clean up the map entry if no listeners are left
      if (listeners.size === 0) {
        this.events.delete(eventName);
      }
    }
  }

  // Subscribe to an event only once
  once(eventName, callback) {
    const onceWrapper = (data) => {
      this.off(eventName, onceWrapper);
      callback(data);
    };
    return this.on(eventName, onceWrapper);
  }
}

export const messenger = new EventEmitter();
