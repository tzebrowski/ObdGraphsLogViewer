import signalConfig from './signals.json';

class SignalRegistry {
  constructor() {
    this.mappings = {};
    this.defaultSignals = [];
    this.init();
  }

  init() {
    signalConfig.forEach((entry) => {
      this.mappings[entry.name] = entry.aliases || [];

      if (entry.default) {
        this.defaultSignals.push(entry.name);
      }
    });
  }

  /**
   * Returns the list of canonical signal names that should be shown by default.
   * @returns {string[]} Array of canonical keys (e.g., ['Engine Speed', 'Gas Pedal Position'])
   */
  getDefaultSignals() {
    return this.defaultSignals;
  }

  /**
   * Finds the actual signal name from a list of available signals
   * that matches the given canonical key.
   */
  findSignal(canonicalKey, availableSignals) {
    if (!availableSignals || availableSignals.length === 0) return null;

    // Direct exact match
    if (availableSignals.includes(canonicalKey)) return canonicalKey;

    const aliases = this.mappings[canonicalKey] || [];

    // Exact alias match (Case-insensitive)
    for (const alias of aliases) {
      const match = availableSignals.find(
        (s) => s.toLowerCase() === alias.toLowerCase()
      );
      if (match) return match;
    }

    // Smart Word-Boundary Match (Replaces .includes())
    // Uses Regex \b to ensure "lat" matches "GPS Lat" but NOT "Calculated"
    for (const alias of aliases) {
      try {
        // Escape special regex characters to prevent errors if alias has symbols like "+" or "("
        const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedAlias}\\b`, 'i');

        const match = availableSignals.find((s) => regex.test(s));
        if (match) return match;
      } catch (e) {
        console.warn(`SignalRegistry: Invalid regex for alias "${alias}"`, e);
      }
    }

    return null;
  }

  /**
   * Checks if a raw signal name (e.g. "RPM") maps to a default canonical signal.
   * @param {string} rawSignalName - The signal name from the file
   * @returns {boolean} True if this signal should be shown by default
   */
  isDefaultSignal(rawSignalName) {
    const canonical = this.getCanonicalKey(rawSignalName);
    return this.defaultSignals.includes(canonical);
  }

  /**
   * Reverse lookup: Finds the canonical key for a given raw signal name
   */
  getCanonicalKey(rawSignalName) {
    for (const [key, aliases] of Object.entries(this.mappings)) {
      if (key === rawSignalName) return key;

      // Also updated to use word boundaries for reverse lookup safety
      if (
        aliases.some((alias) => {
          if (rawSignalName.toLowerCase() === alias.toLowerCase()) return true;
          try {
            const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`\\b${escaped}\\b`, 'i').test(rawSignalName);
          } catch {
            return false;
          }
        })
      ) {
        return key;
      }
    }
    return rawSignalName;
  }
}

export const signalRegistry = new SignalRegistry();
