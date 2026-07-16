import { Injectable } from '@angular/core';

/**
 * Stub for Milestone 1. Full port of legacy/src/signalregistry.js (fetches and
 * caches remote PID->name dictionaries from the ObdMetrics repo) lands in
 * Milestone 2. Until then, raw signal keys are used as display labels.
 */
@Injectable({ providedIn: 'root' })
export class SignalRegistryService {
  getCanonicalByPid(_id: string): string | null {
    return null;
  }
}
