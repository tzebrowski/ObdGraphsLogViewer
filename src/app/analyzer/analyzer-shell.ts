import { Component, inject } from '@angular/core';
import { UiStateService } from '../core/ui-state.service';
import { ChartView } from './chart-view/chart-view';
import { DynoModal } from './dyno-modal/dyno-modal';
import { FileLoader } from './file-loader/file-loader';
import { HistogramModal } from './histogram-modal/histogram-modal';
import { LoadingOverlay } from './loading-overlay/loading-overlay';
import { MathChannelModal } from './math-channel-modal/math-channel-modal';
import { Sidebar } from './sidebar/sidebar';
import { XyModal } from './xy-modal/xy-modal';

/**
 * Layout container for the `#sidebar` + `#mainContent` structure in
 * legacy/index.html. The toolbar (Open Local, view mode, Math Channel,
 * Dyno, XY, Histogram) moved to the shared TopNav — the modal components
 * stay here since they're only reachable while the analyzer page is
 * rendered, but they react to the same singleton services TopNav's buttons
 * write to.
 */
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
  protected readonly uiState = inject(UiStateService);
}
