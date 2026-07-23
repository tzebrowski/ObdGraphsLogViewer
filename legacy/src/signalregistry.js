import signalConfig from './signals.json';

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

class SignalRegistry {
  constructor() {
    this.mappings = {};
    this.metadata = {};
    this.pidMap = {};
    this.defaultSignals = [];
    this.#initLocal();
  }

  /**
   * Orchestrates the fetching and merging of all remote dictionaries.
   */
  async init(
    urls = [
      'https://raw.githubusercontent.com/tzebrowski/ObdMetrics/v11.x/src/main/resources/mode01.json',
      'https://raw.githubusercontent.com/tzebrowski/ObdMetrics/v11.x/src/main/resources/giulia_2.0_gme.json',
      'https://raw.githubusercontent.com/tzebrowski/ObdMetrics/v11.x/src/main/resources/alfa.json',
      'https://raw.githubusercontent.com/tzebrowski/ObdMetrics/v11.x/src/main/resources/rfhub_module.json',
    ]
  ) {
    try {
      const urlList = Array.isArray(urls) ? urls : [urls];

      await Promise.all(urlList.map((url) => this.#loadDictionary(url)));

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

  #initLocal() {
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

  /**
   * Coordinates loading a single dictionary (Cache vs Network).
   */
  async #loadDictionary(url) {
    const fileName = url.substring(url.lastIndexOf('/') + 1);
    let data = this.#getFromCache(url);

    if (data) {
      console.log(`SignalRegistry: Loaded metadata from cache (${fileName})`);
    } else {
      data = await this.#fetchAndCache(url);
      if (data) {
        console.log(
          `SignalRegistry: Loaded metadata from network (${fileName})`
        );
      }
    }

    if (data) {
      this.#mergeMetadata(data);
    }
  }

  /**
   * Handles local storage retrieval and TTL validation.
   */
  #getFromCache(url) {
    const cacheKey = `obd_dict_${url}`;
    const cachedData = localStorage.getItem(cacheKey);

    if (!cachedData) return null;

    try {
      const parsedCache = JSON.parse(cachedData);
      if (Date.now() - parsedCache.timestamp < CACHE_TTL) {
        return parsedCache.data;
      }
      // Cache expired
      localStorage.removeItem(cacheKey);
    } catch (e) {
      // Cache corrupted
      localStorage.removeItem(cacheKey);
    }

    return null;
  }

  /**
   * Handles network fetching and local storage writing.
   */
  async #fetchAndCache(url) {
    try {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();
      const cacheKey = `obd_dict_${url}`;

      try {
        localStorage.setItem(
          cacheKey,
          JSON.stringify({ timestamp: Date.now(), data })
        );
      } catch (cacheErr) {
        console.warn('SignalRegistry: LocalStorage cache full or unavailable.');
      }

      return data;
    } catch (err) {
      console.error(`SignalRegistry: Failed to load from ${url}`, err);
      return null;
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
