import { Injectable } from '@angular/core';
import { AppStateService } from './app-state.service';
import { DataProcessorService } from './data-processor.service';

const GAS_PROXY_URL = 'https://api.my-giulia.com/api/file';

interface ProxyResponse {
  error?: string;
  fileName: string;
  compressed?: boolean;
  content: string;
}

/** Port of legacy/src/deeplink.js — loads a Drive-shared file from `?fileId=` on boot. */
@Injectable({ providedIn: 'root' })
export class DeepLinkService {
  constructor(
    private readonly appState: AppStateService,
    private readonly dataProcessor: DataProcessorService
  ) {}

  hasFileId(): boolean {
    return new URLSearchParams(window.location.search).has('fileId');
  }

  async init(): Promise<void> {
    const fileId = new URLSearchParams(window.location.search).get('fileId');
    if (!fileId) return;

    try {
      this.appState.loading.set(true);
      this.appState.loadingMessage.set('Opening shared log...');

      window.history.replaceState(
        {},
        document.title,
        window.location.pathname + '#analyzer'
      );

      await this.loadSharedFile(fileId);
    } catch (error) {
      console.error('Error loading shared file:', error);
      this.appState.showAlert(
        `Could not load shared file: ${(error as Error).message}`
      );
    } finally {
      this.appState.loading.set(false);
    }
  }

  private async loadSharedFile(fileId: string): Promise<void> {
    const response = await fetch(`${GAS_PROXY_URL}?fileId=${fileId}`);
    if (!response.ok)
      throw new Error(`Network response error: ${response.status}`);

    const proxyData = (await response.json()) as ProxyResponse;
    if (proxyData.error) throw new Error(proxyData.error);

    let dataToProcess: unknown;

    if (proxyData.compressed) {
      const base64Response = await fetch(
        `data:application/octet-stream;base64,${proxyData.content}`
      );
      const blob = await base64Response.blob();
      const ds = new DecompressionStream('gzip');
      const decompressedStream = blob.stream().pipeThrough(ds);
      dataToProcess = JSON.parse(await new Response(decompressedStream).text());
    } else {
      dataToProcess = JSON.parse(proxyData.content);
    }

    await this.dataProcessor.processExternal(dataToProcess, proxyData.fileName);
  }
}
