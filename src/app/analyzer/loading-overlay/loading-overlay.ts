import { Component, inject } from '@angular/core';
import { AppStateService } from '../../core/app-state.service';

@Component({
  selector: 'app-loading-overlay',
  imports: [],
  templateUrl: './loading-overlay.html',
  styleUrl: './loading-overlay.css',
})
export class LoadingOverlay {
  protected readonly appState = inject(AppStateService);
}
