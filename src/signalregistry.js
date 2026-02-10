import mappings from './signals.json';

class SignalRegistry {
  mappings = mappings;

  /**
   * Finds the actual signal name from a list of available signals
   * that matches the given canonical key (e.g., 'Engine Speed').
   * @param {string} canonicalKey - The standard key (e.g., 'Engine Speed')
   * @param {string[]} availableSignals - Array of signals in the current file
   * @returns {string|null} - The actual matching signal name or null
   */
  findSignal(canonicalKey, availableSignals) {
    if (!availableSignals || availableSignals.length === 0) return null;

    if (availableSignals.includes(canonicalKey)) return canonicalKey;

    const aliases = this.mappings[canonicalKey] || [];

    for (const alias of aliases) {
      const match = availableSignals.find(
        (s) => s.toLowerCase() === alias.toLowerCase()
      );
      if (match) return match;
    }

    for (const alias of aliases) {
      const match = availableSignals.find((s) =>
        s.toLowerCase().includes(alias.toLowerCase())
      );
      if (match) return match;
    }

    return null;
  }

  /**
   * Reverse lookup: Finds the canonical key for a given raw signal name
   * (Useful for grouping signals across different log files)
   */
  getCanonicalKey(rawSignalName) {
    for (const [key, aliases] of Object.entries(this.mappings)) {
      if (key === rawSignalName) return key;
      if (
        aliases.some((alias) =>
          rawSignalName.toLowerCase().includes(alias.toLowerCase())
        )
      ) {
        return key;
      }
    }
    return rawSignalName; // Fallback to itself if no mapping found
  }
}

// Export a singleton instance
export const signalRegistry = new SignalRegistry();
