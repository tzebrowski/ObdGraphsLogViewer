import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UiStateService } from './ui-state.service';

function setWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  });
}

describe('UiStateService', () => {
  const originalWidth = window.innerWidth;

  afterEach(() => {
    setWidth(originalWidth);
  });

  let service: UiStateService;
  beforeEach(() => {
    service = new UiStateService();
  });

  it('toggles the mobile-active flag below the breakpoint', () => {
    setWidth(500);
    service.toggleSidebar();
    expect(service.sidebarMobileActive()).toBe(true);
    expect(service.sidebarCollapsed()).toBe(false);

    service.toggleSidebar();
    expect(service.sidebarMobileActive()).toBe(false);
  });

  it('toggles the collapsed flag above the breakpoint', () => {
    setWidth(1200);
    service.toggleSidebar();
    expect(service.sidebarCollapsed()).toBe(true);
    expect(service.sidebarMobileActive()).toBe(false);
  });

  it('closeSidebarMobile clears the mobile-active flag', () => {
    setWidth(500);
    service.toggleSidebar();
    service.closeSidebarMobile();
    expect(service.sidebarMobileActive()).toBe(false);
  });
});
