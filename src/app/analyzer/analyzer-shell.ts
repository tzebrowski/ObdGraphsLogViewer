import { Component, inject } from '@angular/core';
import { AppStateService } from '../core/app-state.service';
import { DataProcessorService } from '../core/data-processor.service';
import { DynoService } from '../core/dyno.service';
import { HistogramService } from '../core/histogram.service';
import { MathChannelsService } from '../core/math-channels.service';
import { ViewMode } from '../core/models';
import { PreferencesService } from '../core/preferences.service';
import { XyAnalysisService } from '../core/xy-analysis.service';
import { ChartView } from './chart-view/chart-view';
import { DynoModal } from './dyno-modal/dyno-modal';
import { FileLoader } from './file-loader/file-loader';
import { HistogramModal } from './histogram-modal/histogram-modal';
import { LoadingOverlay } from './loading-overlay/loading-overlay';
import { MathChannelModal } from './math-channel-modal/math-channel-modal';
import { Sidebar } from './sidebar/sidebar';
import { XyModal } from './xy-modal/xy-modal';

/** Layout container for the `#sidebar` + `#mainContent` structure in legacy/index.html. */
@Component({
  selector: 'app-analyzer-shell',
  imports: [
    Sidebar,
    ChartView,
    FileLoader,
    LoadingOverlay,
    MathChannelModal,
    DynoModal,
    XyModal,
    HistogramModal,
  ],
  templateUrl: './analyzer-shell.html',
  styleUrl: './analyzer-shell.css',
})
export class AnalyzerShell {
  protected readonly appState = inject(AppStateService);
  protected readonly mathChannels = inject(MathChannelsService);
  protected readonly dyno = inject(DynoService);
  protected readonly xy = inject(XyAnalysisService);
  protected readonly histogram = inject(HistogramService);
  protected readonly preferences = inject(PreferencesService);
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
