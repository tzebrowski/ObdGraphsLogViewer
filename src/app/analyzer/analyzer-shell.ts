import { Component, inject } from '@angular/core';
import { AppStateService } from '../core/app-state.service';
import { DataProcessorService } from '../core/data-processor.service';
import { ViewMode } from '../core/models';
import { ChartView } from './chart-view/chart-view';
import { FileLoader } from './file-loader/file-loader';
import { LoadingOverlay } from './loading-overlay/loading-overlay';
import { Sidebar } from './sidebar/sidebar';

/** Layout container for the `#sidebar` + `#mainContent` structure in legacy/index.html. */
@Component({
  selector: 'app-analyzer-shell',
  imports: [Sidebar, ChartView, FileLoader, LoadingOverlay],
  templateUrl: './analyzer-shell.html',
  styleUrl: './analyzer-shell.css',
})
export class AnalyzerShell {
  protected readonly appState = inject(AppStateService);
  private readonly dataProcessor = inject(DataProcessorService);

  protected setViewMode(mode: ViewMode): void {
    this.appState.viewMode.set(mode);
  }

  protected fileLoaderInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.dataProcessor.handleFiles(Array.from(input.files));
    }
    input.value = '';
  }
}
