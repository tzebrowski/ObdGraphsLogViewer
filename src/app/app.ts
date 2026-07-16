import { Component, effect, inject, signal } from '@angular/core';
import { AnalyzerShell } from './analyzer/analyzer-shell';
import { AuthService } from './core/auth.service';
import { DeepLinkService } from './core/deep-link.service';
import { ProjectManagerService } from './core/project-manager.service';
import { SignalRegistryService } from './core/signal-registry.service';
import { Landing } from './landing/landing';

type Route = 'landing' | 'analyzer';

/**
 * Root component. Ports the hash-based show/hide toggle from
 * legacy/src/navigation.js (`#home` / `#analyzer`) — full URL routing
 * (Angular Router) is out of scope; deep links (`?fileId=`) are handled by
 * DeepLinkService since Drive-native share links already include
 * `#analyzer`, but the legacy GAS-proxy share format doesn't.
 */
@Component({
  selector: 'app-root',
  imports: [Landing, AnalyzerShell],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly deepLink = inject(DeepLinkService);
  protected readonly route = signal<Route>(this.routeFromHash());

  constructor() {
    document.body.classList.add('spa-mode');
    window.addEventListener('hashchange', () =>
      this.route.set(this.routeFromHash())
    );

    inject(ProjectManagerService).init();
    inject(AuthService).init();
    inject(SignalRegistryService).init();
    this.deepLink.init();

    effect(() => {
      const isAnalyzer = this.route() === 'analyzer';
      document.body.classList.toggle('analyzer-active', isAnalyzer);
      document.body.classList.toggle('landing-active', !isAnalyzer);
      document.body.classList.toggle('docs-body', !isAnalyzer);
    });
  }

  private routeFromHash(): Route {
    if (window.location.hash === '#analyzer' || this.deepLink.hasFileId()) {
      return 'analyzer';
    }
    return 'landing';
  }
}
