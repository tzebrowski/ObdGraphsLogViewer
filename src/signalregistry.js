import signalConfig from './signals.json';

class SignalRegistry {
  constructor() {
    this.mappings = {};
    this.metadata = {}; // Stores units, min, max, etc.
    this.pidMap = {}; // Maps PIDs directly to canonical keys
    this.defaultSignals = [];

    // Synchronous setup of local defaults and aliases
    this._initLocal();
  }

  _initLocal() {
    signalConfig.forEach((entry) => {
      this.mappings[entry.name] = entry.aliases || [];
      if (entry.default) {
        this.defaultSignals.push(entry.name);
      }
      // Initialize base metadata for local signals
      this.metadata[entry.name] = {
        units: '',
        min: null,
        max: null,
        pid: null,
      };
    });
  }

  /**
   * Fetches metadata from multiple ObdMetrics definitions and merges them.
   */
  async init(urls = []) {
    try {
      // Ensure we are working with an array
      const urlList = Array.isArray(urls) ? urls : [urls];

      // Fetch all URLs in parallel
      const fetchPromises = urlList.map(async (url) => {
        try {
          const response = await fetch(url);
          if (!response.ok)
            throw new Error(`HTTP error! status: ${response.status}`);

          const data = await response.json();
          this.#mergeMetadata(data);

          // Log just the filename for cleaner console output
          const fileName = url.substring(url.lastIndexOf('/') + 1);
          console.log(`SignalRegistry: Loaded metadata from ${fileName}`);
        } catch (err) {
          console.error(`SignalRegistry: Failed to load from ${url}`, err);
        }
      });

      await Promise.all(fetchPromises);
      console.log(
        `SignalRegistry: All remote metadata loaded successfully. Total PIDs mapped: ${Object.keys(this.pidMap).length}`
      );
    } catch (error) {
      console.error(
        'SignalRegistry: Critical error fetching remote metadata.',
        error
      );
    }
  }

  /**
   * Retrieve metadata for charting (units, min, max limits).
   */
  getSignalMetadata(canonicalKey) {
    return this.metadata[canonicalKey] || null;
  }

  /**
   * Retrieve the canonical name based strictly on the PID/ID.
   */
  getCanonicalByPid(pid) {
    if (!pid) return null;
    return this.pidMap[String(pid).toLowerCase()] || null;
  }

  /**
   * Returns the list of canonical signal names that should be shown by default.
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

    if (availableSignals.includes(canonicalKey)) return canonicalKey;

    const aliases = this.mappings[canonicalKey] || [];

    for (const alias of aliases) {
      const match = availableSignals.find(
        (s) => s.toLowerCase() === alias.toLowerCase()
      );
      if (match) return match;
    }

    for (const alias of aliases) {
      try {
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
   * Checks if a raw signal name maps to a default canonical signal.
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

  #mergeMetadata(data) {
    let loadedPids = 0;
    let metricsArray = [];

    // ObdMetrics JSON files group PIDs into distinct categories (livedata, metadata, capabilities, etc.)
    // We need to iterate over all these groups and flatten them into one big array.
    if (Array.isArray(data)) {
      metricsArray = data;
    } else if (data && typeof data === 'object') {
      Object.values(data).forEach((value) => {
        if (Array.isArray(value)) {
          // Merge every array we find (livedata, metadata, etc.) together
          metricsArray = metricsArray.concat(value);
        }
      });
    }

    if (metricsArray.length === 0) {
      console.error(
        'SignalRegistry: Failed to parse remote metrics. No arrays found in JSON:',
        data
      );
      return;
    }

    metricsArray.forEach((metric) => {
      if (!metric || typeof metric !== 'object') return;

      const rawDesc = metric.description || '';
      if (!rawDesc) return;

      const cleanName = rawDesc.split('\n')[0].trim();
      const canonicalKey = this.getCanonicalKey(cleanName) || cleanName;

      this.metadata[canonicalKey] = {
        ...this.metadata[canonicalKey],
        units: metric.units || '',
        min: metric.min !== undefined ? parseFloat(metric.min) : null,
        max: metric.max !== undefined ? parseFloat(metric.max) : null,
      };

      let mappedSomething = false;

      // ObdMetrics definitions use both an internal "id" (e.g., "7040") and an OBD "pid" (e.g., "1001").
      // We map BOTH so that the log file can match against either identifier perfectly.
      [metric.id, metric.pid, metric.command].forEach((identifier) => {
        if (identifier) {
          const cleanId = String(identifier)
            .replace(/^(pid_|0x)/i, '')
            .toLowerCase();
          this.pidMap[cleanId] = canonicalKey;
          mappedSomething = true;
        }
      });

      if (mappedSomething) loadedPids++;

      if (!this.mappings[canonicalKey]) {
        this.mappings[canonicalKey] = [cleanName];
      }

      const rawAlias = rawDesc.replace(/\n/g, ' ').trim();
      if (!this.mappings[canonicalKey].includes(rawAlias)) {
        this.mappings[canonicalKey].push(rawAlias);
      }
    });

    console.log(
      `SignalRegistry: Successfully mapped ${loadedPids} remote metrics to canonical names.`
    );
  }
}

export const signalRegistry = new SignalRegistry();
