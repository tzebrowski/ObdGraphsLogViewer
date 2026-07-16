import { Component, effect, inject, signal } from '@angular/core';
import { AnalyzerShell } from './analyzer/analyzer-shell';
import { DataProcessorService } from './core/data-processor.service';
import { Landing } from './landing/landing';

type Route = 'landing' | 'analyzer';

/**
 * Root component. Ports the hash-based show/hide toggle from
 * legacy/src/navigation.js (`#home` / `#analyzer`) — full URL routing
 * (Angular Router, deep links) is out of scope for Milestone 1.
 */
@Component({
  selector: 'app-root',
  imports: [Landing, AnalyzerShell],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly route = signal<Route>(this.routeFromHash());

  constructor() {
    document.body.classList.add('spa-mode');
    window.addEventListener('hashchange', () =>
      this.route.set(this.routeFromHash())
    );

    inject(DataProcessorService).restoreFromLibrary();

    effect(() => {
      const isAnalyzer = this.route() === 'analyzer';
      document.body.classList.toggle('analyzer-active', isAnalyzer);
      document.body.classList.toggle('landing-active', !isAnalyzer);
      document.body.classList.toggle('docs-body', !isAnalyzer);
    });
  }

  private routeFromHash(): Route {
    return window.location.hash === '#analyzer' ? 'analyzer' : 'landing';
  }
}
