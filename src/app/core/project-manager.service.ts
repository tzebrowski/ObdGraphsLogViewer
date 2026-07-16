import { Injectable } from '@angular/core';

export interface RegisteredFile {
  name: string;
  dbId: number | null;
  size: number;
  metadata: Record<string, unknown>;
}

/**
 * Stub for Milestone 1. Full port of legacy/src/projectmanager.js (project/tag
 * history) lands in Milestone 3 — kept as a no-op here so DataProcessorService
 * can call it exactly like the original without pulling that feature in early.
 */
@Injectable({ providedIn: 'root' })
export class ProjectManagerService {
  registerFile(_file: RegisteredFile): void {
    // no-op until Milestone 3
  }
}
