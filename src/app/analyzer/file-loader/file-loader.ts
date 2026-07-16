import { Component, inject, signal } from '@angular/core';
import { DataProcessorService } from '../../core/data-processor.service';

/** Port of legacy/src/dragndrop.js plus the sidebar file-input wiring from legacy/src/entry.js. */
@Component({
  selector: 'app-file-loader',
  imports: [],
  templateUrl: './file-loader.html',
  styleUrl: './file-loader.css',
})
export class FileLoader {
  private readonly dataProcessor = inject(DataProcessorService);

  protected readonly dragOver = signal(false);

  onDragEnter(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.dataProcessor.handleFiles(Array.from(files));
    }
  }

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.dataProcessor.handleFiles(Array.from(input.files));
    }
    input.value = '';
  }
}
