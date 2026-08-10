import { Injectable } from '@angular/core';
import signalConfig from './signals.json';

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

const DEFAULT_DICTIONARY_URLS = [
  'https://raw.githubusercontent.com/tzebrowski/ObdMetrics/v11.x/src/main/resources/mode01.json',
  'https://raw.githubusercontent.com/tzebrowski/ObdMetrics/v11.x/src/main/resources/giulia_2.0_gme.json',
  'https://raw.githubusercontent.com/tzebrowski/ObdMetrics/v11.x/src/main/resources/alfa.json',
  'https://raw.githubusercontent.com/tzebrowski/ObdMetrics/v11.x/src/main/resources/rfhub_module.json',
];

export interface SignalMetadata {
  units: string;
  min: number | null;
  max: number | null;
}

interface RemoteMetric {
  id?: string | number;
  pid?: string | number;
  command?: string | number;
  description?: string;
  units?: string;
  min?: string | number;
  max?: string | number;
}

/**
 * Port of legacy/src/signalregistry.js. Maps raw OBD/telemetry signal keys to
 * canonical display names and metadata (units/min/max) by fetching and
 * caching (7-day TTL, localStorage) JSON dictionaries from the ObdMetrics
 * repo at runtime.
 */
@Injectable({ providedIn: 'root' })
export class SignalRegistryService {
  private mappings: Record<string, string[]> = {};
  private metadata: Record<string, SignalMetadata> = {};
  private pidMap: Record<string, string> = {};
  private defaultSignals: string[] = [];

  constructor() {
    this.initLocal();
  }

  /** Orchestrates fetching and merging of all remote dictionaries. */
  async init(urls: string[] = DEFAULT_DICTIONARY_URLS): Promise<void> {
    try {
      await Promise.all(urls.map((url) => this.loadDictionary(url)));
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

  private initLocal(): void {
    (
      signalConfig as Array<{
        name: string;
        default?: boolean;
        aliases?: string[];
      }>
    ).forEach((entry) => {
      this.mappings[entry.name] = entry.aliases || [];
      if (entry.default) {
        this.defaultSignals.push(entry.name);
      }
      this.metadata[entry.name] = { units: '', min: null, max: null };
    });
  }

  private async loadDictionary(url: string): Promise<void> {
    const fileName = url.substring(url.lastIndexOf('/') + 1);
    let data = this.getFromCache(url);

    if (data) {
      console.log(`SignalRegistry: Loaded metadata from cache (${fileName})`);
    } else {
      data = await this.fetchAndCache(url);
      if (data) {
        console.log(
          `SignalRegistry: Loaded metadata from network (${fileName})`
        );
      }
    }

    if (data) {
      this.mergeMetadata(data);
    }
  }

  private getFromCache(url: string): unknown {
    const cacheKey = `obd_dict_${url}`;
    const cachedData = localStorage.getItem(cacheKey);
    if (!cachedData) return null;

    try {
      const parsedCache = JSON.parse(cachedData) as {
        timestamp: number;
        data: unknown;
      };
      if (Date.now() - parsedCache.timestamp < CACHE_TTL) {
        return parsedCache.data;
      }
      localStorage.removeItem(cacheKey);
    } catch {
      localStorage.removeItem(cacheKey);
    }

    return null;
  }

  private async fetchAndCache(url: string): Promise<unknown> {
    try {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);

      const data: unknown = await response.json();
      const cacheKey = `obd_dict_${url}`;

      try {
        localStorage.setItem(
          cacheKey,
          JSON.stringify({ timestamp: Date.now(), data })
        );
      } catch {
        console.warn('SignalRegistry: LocalStorage cache full or unavailable.');
      }

      return data;
    } catch (err) {
      console.error(`SignalRegistry: Failed to load from ${url}`, err);
      return null;
    }
  }

  getSignalMetadata(canonicalKey: string): SignalMetadata | null {
    return this.metadata[canonicalKey] || null;
  }

  getCanonicalByPid(pid: string | number | null | undefined): string | null {
    if (!pid) return null;
    return this.pidMap[String(pid).toLowerCase()] || null;
  }

  getDefaultSignals(): string[] {
    return this.defaultSignals;
  }

  findSignal(
    canonicalKey: string,
    availableSignals: string[] | null | undefined
  ): string | null {
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

  isDefaultSignal(rawSignalName: string): boolean {
    const canonical = this.getCanonicalKey(rawSignalName);
    return this.defaultSignals.includes(canonical);
  }

  getCanonicalKey(rawSignalName: string): string {
    if (!rawSignalName) return rawSignalName;
    const lowerRaw = String(rawSignalName).toLowerCase();

    for (const [key, aliases] of Object.entries(this.mappings)) {
      if (key.toLowerCase() === lowerRaw) return key;
      if (aliases.some((alias) => String(alias).toLowerCase() === lowerRaw))
        return key;
    }
    return rawSignalName;
  }

  private mergeMetadata(data: unknown): void {
    let loadedPids = 0;
    let metricsArray: RemoteMetric[] = [];

    if (Array.isArray(data)) {
      metricsArray = data as RemoteMetric[];
    } else if (data && typeof data === 'object') {
      Object.values(data as Record<string, unknown>).forEach((value) => {
        if (Array.isArray(value))
          metricsArray = metricsArray.concat(value as RemoteMetric[]);
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

      const metricMetadata: SignalMetadata = {
        units: metric.units || '',
        min: metric.min !== undefined ? parseFloat(String(metric.min)) : null,
        max: metric.max !== undefined ? parseFloat(String(metric.max)) : null,
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
