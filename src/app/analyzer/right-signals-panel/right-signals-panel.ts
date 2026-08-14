import { Component, signal } from '@angular/core';
import { SignalListPanel } from '../signal-list-panel/signal-list-panel';

/**
 * A second, right-edge entry point to the same signal picker as the left Sidebar -- mirrors
 * AutoTuner's "Measures" panel, which docks to the chart's right side rather than living in a
 * persistent left sidebar. Stays off-screen until the mouse nears the right edge of the
 * viewport, then slides in; moving away closes it again. Reuses SignalListPanel as-is (with its
 * own `idPrefix` so its checkbox ids don't collide with the left sidebar's instance) -- both
 * read/write the same AppStateService, so toggling a signal here is instantly reflected on the
 * left, and vice versa.
 */
@Component({
  selector: 'app-right-signals-panel',
  imports: [SignalListPanel],
  templateUrl: './right-signals-panel.html',
  styleUrl: './right-signals-panel.css',
})
export class RightSignalsPanel {
  protected readonly open = signal(false);

  protected onTriggerEnter(): void {
    this.open.set(true);
  }

  protected onPanelLeave(): void {
    this.open.set(false);
  }
}
