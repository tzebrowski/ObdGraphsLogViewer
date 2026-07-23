import { Injectable, signal } from '@angular/core';

const MOBILE_BREAKPOINT = 768;

/**
 * Port of legacy/src/ui.js's `toggleSidebar`: on mobile it slides the
 * sidebar in/out over a backdrop, on desktop it collapses the sidebar
 * in place. Legacy's footer active/collapsed sync is dropped since the
 * Angular app has no footer component yet.
 */
@Injectable({ providedIn: 'root' })
export class UiStateService {
  readonly sidebarCollapsed = signal(false);
  readonly sidebarMobileActive = signal(false);

  toggleSidebar(): void {
    if (window.innerWidth <= MOBILE_BREAKPOINT) {
      this.sidebarMobileActive.update((active) => !active);
    } else {
      this.sidebarCollapsed.update((collapsed) => !collapsed);
    }
  }

  closeSidebarMobile(): void {
    this.sidebarMobileActive.set(false);
  }
}
