import signalConfig from './signals.json';

class SignalRegistry {
  constructor() {
    this.mappings = {};
    this.metadata = {};
    this.pidMap = {};
    this.defaultSignals = [];
    this._initLocal();
  }

  _initLocal() {
    signalConfig.forEach((entry) => {
      this.mappings[entry.name] = entry.aliases || [];
      if (entry.default) {
        this.defaultSignals.push(entry.name);
      }
      this.metadata[entry.name] = {
        units: '',
        min: null,
        max: null,
        pid: null,
      };
    });
  }

  async init(
    urls = [
      'https://raw.githubusercontent.com/tzebrowski/ObdMetrics/v11.x/src/main/resources/giulia_2.0_gme.json',
      'https://raw.githubusercontent.com/tzebrowski/ObdMetrics/v11.x/src/main/resources/alfa.json',
    ]
  ) {
    try {
      const urlList = Array.isArray(urls) ? urls : [urls];
      const fetchPromises = urlList.map(async (url) => {
        try {
          const response = await fetch(url);
          if (!response.ok)
            throw new Error(`HTTP error! status: ${response.status}`);
          const data = await response.json();
          this.#mergeMetadata(data);
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

  getSignalMetadata(canonicalKey) {
    return this.metadata[canonicalKey] || null;
  }

  getCanonicalByPid(pid) {
    if (!pid) return null;
    return this.pidMap[String(pid).toLowerCase()] || null;
  }

  getDefaultSignals() {
    return this.defaultSignals;
  }

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

  isDefaultSignal(rawSignalName) {
    const canonical = this.getCanonicalKey(rawSignalName);
    return this.defaultSignals.includes(canonical);
  }

  getCanonicalKey(rawSignalName) {
    if (!rawSignalName) return rawSignalName;
    const lowerRaw = String(rawSignalName).toLowerCase();

    for (const [key, aliases] of Object.entries(this.mappings)) {
      if (key.toLowerCase() === lowerRaw) return key;
      if (aliases.some((alias) => String(alias).toLowerCase() === lowerRaw))
        return key;
    }
    return rawSignalName;
  }

  #mergeMetadata(data) {
    let loadedPids = 0;
    let metricsArray = [];

    if (Array.isArray(data)) {
      metricsArray = data;
    } else if (data && typeof data === 'object') {
      Object.values(data).forEach((value) => {
        if (Array.isArray(value)) metricsArray = metricsArray.concat(value);
      });
    }

    if (metricsArray.length === 0) return;

    metricsArray.forEach((metric) => {
      if (!metric || typeof metric !== 'object') return;
      const rawDesc = metric.description || '';
      if (!rawDesc) return;

      const groupName = rawDesc.split('\n')[0].trim();
      const fullName = rawDesc.replace(/\n/g, ' ').trim();
      const canonicalKey = this.getCanonicalKey(groupName) || groupName;

      const metricMetadata = {
        units: metric.units || '',
        min: metric.min !== undefined ? parseFloat(metric.min) : null,
        max: metric.max !== undefined ? parseFloat(metric.max) : null,
      };

      this.metadata[canonicalKey] = {
        ...this.metadata[canonicalKey],
        ...metricMetadata,
      };
      this.metadata[fullName] = {
        ...this.metadata[fullName],
        ...metricMetadata,
      };

      let mappedSomething = false;
      [metric.id, metric.pid, metric.command].forEach((identifier) => {
        if (identifier) {
          const cleanId = String(identifier)
            .replace(/^(pid_|0x)/i, '')
            .toLowerCase();
          this.pidMap[cleanId] = fullName;
          mappedSomething = true;
        }
      });

      if (mappedSomething) loadedPids++;

      if (!this.mappings[canonicalKey])
        this.mappings[canonicalKey] = [groupName];
      if (!this.mappings[canonicalKey].includes(fullName))
        this.mappings[canonicalKey].push(fullName);
      if (!this.mappings[fullName]) this.mappings[fullName] = [fullName];
    });

    console.log(
      `SignalRegistry: Successfully mapped ${loadedPids} remote metrics to canonical names.`
    );
  }
}

export const signalRegistry = new SignalRegistry();
