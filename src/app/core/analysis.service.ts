import { Injectable, signal } from '@angular/core';
import ANOMALY_TEMPLATES from './analysis-templates.json';
import { AppStateService } from './app-state.service';
import { EventBusService } from './event-bus.service';
import { EVENTS, FileRemovedEvent, LoadedFile } from './models';
import { SignalRegistryService } from './signal-registry.service';

export type FilterOperator = '>' | '<';

export interface FilterCriterion {
  id: string;
  fileIdx: number; // -1 = All Files
  signal: string;
  operator: FilterOperator;
  value: string;
}

export interface ScanResultRange {
  start: number;
  end: number;
  fileName: string;
  fileIdx: number;
}

export interface AnomalyTemplateRule {
  sig: string;
  op: FilterOperator;
  val: number;
}

export interface AnomalyTemplate {
  name: string;
  rules: AnomalyTemplateRule[];
}

interface ScanCriterion {
  fileIdx: number;
  sig: string;
  op: FilterOperator;
  val: number;
}

/**
 * Port of legacy/src/analysis.js's anomaly scanner. DOM-driven filter-row
 * markup is replaced with a `filters` signal the AnomalyScanner component
 * renders directly; option-list refreshing (legacy's
 * `refreshFilterOptions`) is automatic since Angular re-evaluates signal
 * reads on every change, so there's no manual DOM sync step to port.
 */
@Injectable({ providedIn: 'root' })
export class AnalysisService {
  readonly templates: Record<string, AnomalyTemplate> =
    ANOMALY_TEMPLATES as unknown as Record<string, AnomalyTemplate>;

  readonly filters = signal<FilterCriterion[]>([this.emptyRow()]);
  readonly results = signal<ScanResultRange[]>([]);
  readonly scanMessage = signal('');

  constructor(
    private readonly appState: AppStateService,
    private readonly signalRegistry: SignalRegistryService,
    bus: EventBusService
  ) {
    bus.on<FileRemovedEvent>(EVENTS.FILE_REMOVED).subscribe(() => {
      this.results.set([]);
      this.scanMessage.set('');
    });
  }

  addFilterRow(): void {
    this.filters.update((rows) => [...rows, this.emptyRow()]);
  }

  removeFilterRow(id: string): void {
    this.filters.update((rows) => rows.filter((r) => r.id !== id));
  }

  updateFilterRow(id: string, patch: Partial<FilterCriterion>): void {
    this.filters.update((rows) =>
      rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  }

  applyTemplate(templateKey: string): void {
    const template = this.templates[templateKey];
    if (!template) return;

    const allSignals = [
      ...new Set(this.appState.files().flatMap((f) => f.availableSignals)),
    ];

    const rows = template.rules.map((rule) => {
      const bestSig =
        this.signalRegistry.findSignal(rule.sig, allSignals) || '';
      return this.emptyRow({
        signal: bestSig,
        operator: rule.op,
        value: String(rule.val),
      });
    });

    this.filters.set(rows);
    this.runScan();
  }

  runScan(): void {
    const criteria: ScanCriterion[] = this.filters()
      .map((r) => ({
        fileIdx: r.fileIdx,
        sig: r.signal,
        op: r.operator,
        val: parseFloat(r.value),
      }))
      .filter((c) => c.sig && !isNaN(c.val));

    if (criteria.length === 0) {
      this.results.set([]);
      this.scanMessage.set('No criteria defined');
      return;
    }

    const aggregated: ScanResultRange[] = [];
    this.appState.files().forEach((file, fileIdx) => {
      const relevant = criteria.filter(
        (c) => c.fileIdx === -1 || c.fileIdx === fileIdx
      );
      if (relevant.length > 0) {
        aggregated.push(...this.scanFileData(file, fileIdx, relevant));
      }
    });

    this.results.set(aggregated);
    this.scanMessage.set(`${aggregated.length} events found`);
  }

  private scanFileData(
    file: LoadedFile,
    fileIdx: number,
    criteria: ScanCriterion[]
  ): ScanResultRange[] {
    const results: ScanResultRange[] = [];
    const state: Record<string, number> = {};
    let inEvent = false;
    let startT = 0;

    file.rawData.forEach((row) => {
      state[row.signal] = row.value;
      const match = criteria.every(
        (c) =>
          state[c.sig] !== undefined &&
          (c.op === '>' ? state[c.sig] > c.val : state[c.sig] < c.val)
      );

      if (match && !inEvent) {
        inEvent = true;
        startT = row.timestamp;
      } else if (!match && inEvent) {
        inEvent = false;
        results.push({
          start: startT,
          end: row.timestamp,
          fileName: file.name,
          fileIdx,
        });
      }
    });
    return results;
  }

  private emptyRow(overrides: Partial<FilterCriterion> = {}): FilterCriterion {
    return {
      id: crypto.randomUUID(),
      fileIdx: -1,
      signal: '',
      operator: '>',
      value: '',
      ...overrides,
    };
  }
}
