class SignalRegistry {
  mappings = {
    'Engine Speed': ['RPM', 'Engine Speed', 'Engine RPM', 'Engine Rpm'],
    'Intake Manifold Pressure Measured': [
      'Manifold Abs',
      'MAP',
      'Intake Press',
      'Boost Pressure',
      'Manifold Pressure',
      'Boost',
    ],

    MAF: ['Air Mass', 'MAF', 'Flow'],
    Latitude: ['GPS-Lat', 'lat', 'Lat', 'lateral', 'GPS Latitude', 'Latitude'],
    Longitude: ['GPS-Lon', 'lng', 'Lng', 'lon', 'GPS Longitude', 'Longitude'],

    Torque: ['Torque', 'Engine Torque', 'Nm'],
    'Vehicle Speed': ['Vehicle Speed', 'Speed', 'Velocity'],
    'Gas Pedal Position': [
      'Accelerator Pedal Position',
      'Pedal Pos',
      'Gas Pedal Position',
      'Throttle Pos',
      'TPS',
    ],
    'Spark Advance': ['Ignition Timing', 'Timing Adv', 'Spark Angle'],
    'Lambda Sensor 1': ['O2 Sensor', 'Equivalence Ratio', 'AFR', 'Lambda'],
    'Short Fuel Trim': ['SFT', 'STFT', 'Short Term'],

    'Atmospheric Pressure': [
      'Atmospheric',
      'Baro',
      'Barometric',
      'Ambient Pressure',
    ],
    'AFR Commanded': [
      'Commanded',
      'Target AFR',
      'Lambda Request',
      'AFR Target',
    ],
    'AFR Measured': [
      'Measured',
      'Current',
      'AFR Measured',
      'Lambda Actual',
      'AFR',
    ],
  };

  /**
   * Finds the actual signal name from a list of available signals
   * that matches the given canonical key (e.g., 'Engine Speed').
   * @param {string} canonicalKey - The standard key (e.g., 'Engine Speed')
   * @param {string[]} availableSignals - Array of signals in the current file
   * @returns {string|null} - The actual matching signal name or null
   */
  findSignal(canonicalKey, availableSignals) {
    if (!availableSignals || availableSignals.length === 0) return null;

    // 0. Direct match (if the file already uses the canonical name)
    if (availableSignals.includes(canonicalKey)) return canonicalKey;

    const aliases = this.mappings[canonicalKey] || [];

    // 1. Try Exact Matches first (Case Insensitive)
    for (const alias of aliases) {
      const match = availableSignals.find(
        (s) => s.toLowerCase() === alias.toLowerCase()
      );
      if (match) return match;
    }

    // 2. Try Partial Matches (Contains)
    // Useful for things like "GPS Latitude (deg)" matching "Latitude"
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
