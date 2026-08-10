import { KeyValuePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import {
  AnalysisService,
  FilterOperator,
  ScanResultRange,
} from '../../core/analysis.service';
import { AppStateService } from '../../core/app-state.service';

/**
 * Port of legacy/src/analysis.js's UI: template picker, filter rows, run
 * scan, and clickable results (which pan/zoom the chart via
 * AppStateService.setActiveHighlight — see ChartView's activeHighlight
 * effect).
 */
@Component({
  selector: 'app-anomaly-scanner',
  imports: [KeyValuePipe],
  templateUrl: './anomaly-scanner.html',
  styleUrl: './anomaly-scanner.css',
})
export class AnomalyScanner {
  protected readonly analysis = inject(AnalysisService);
  protected readonly appState = inject(AppStateService);
  protected selectedResultId: number | null = null;

  protected signalOptionsFor(fileIdx: number): string[] {
    const files = this.appState.files();
    const signals =
      fileIdx === -1
        ? [...new Set(files.flatMap((f) => f.availableSignals))]
        : (files[fileIdx]?.availableSignals ?? []);
    return [...signals].sort();
  }

  protected applyTemplate(key: string): void {
    if (!key) return;
    this.analysis.applyTemplate(key);
  }

  protected setRowFile(id: string, value: string): void {
    this.analysis.updateFilterRow(id, { fileIdx: parseInt(value, 10) });
  }

  protected setRowSignal(id: string, value: string): void {
    this.analysis.updateFilterRow(id, { signal: value });
  }

  protected setRowOperator(id: string, value: string): void {
    this.analysis.updateFilterRow(id, { operator: value as FilterOperator });
  }

  protected setRowValue(id: string, value: string): void {
    this.analysis.updateFilterRow(id, { value });
  }

  protected relativeSeconds(
    result: ScanResultRange,
    edge: 'start' | 'end'
  ): string {
    const file = this.appState.files()[result.fileIdx];
    if (!file) return '0.0';
    return (
      ((edge === 'start' ? result.start : result.end) - file.startTime) /
      1000
    ).toFixed(1);
  }

  protected selectResult(result: ScanResultRange, index: number): void {
    this.selectedResultId = index;
    const file = this.appState.files()[result.fileIdx];
    if (!file) return;

    const startSec = (result.start - file.startTime) / 1000;
    const endSec = (result.end - file.startTime) / 1000;
    this.appState.setActiveHighlight(startSec, endSec, result.fileIdx);
  }
}
