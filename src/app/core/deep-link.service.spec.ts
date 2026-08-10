import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStateService } from './app-state.service';
import { DataProcessorService } from './data-processor.service';
import { DeepLinkService } from './deep-link.service';
import { EventBusService } from './event-bus.service';

function setSearch(search: string): void {
  window.history.replaceState({}, '', `${window.location.pathname}${search}`);
}

describe('DeepLinkService', () => {
  let appState: AppStateService;
  let dataProcessor: { processExternal: ReturnType<typeof vi.fn> };
  let service: DeepLinkService;

  beforeEach(() => {
    appState = new AppStateService(new EventBusService());
    dataProcessor = { processExternal: vi.fn().mockResolvedValue(undefined) };
    service = new DeepLinkService(
      appState,
      dataProcessor as unknown as DataProcessorService
    );
  });

  afterEach(() => {
    setSearch('');
    vi.unstubAllGlobals();
  });

  describe('hasFileId', () => {
    it('is false with no fileId query param', () => {
      setSearch('');
      expect(service.hasFileId()).toBe(false);
    });

    it('is true when fileId is present', () => {
      setSearch('?fileId=abc123');
      expect(service.hasFileId()).toBe(true);
    });
  });

  describe('init', () => {
    it('does nothing when no fileId is present', async () => {
      setSearch('');
      await service.init();
      expect(dataProcessor.processExternal).not.toHaveBeenCalled();
      expect(appState.loading()).toBe(false);
    });

    it('fetches, parses, and processes an uncompressed shared file', async () => {
      setSearch('?fileId=abc123');
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          fileName: 'shared.json',
          compressed: false,
          content: JSON.stringify([{ s: 'RPM', t: 0, v: 1000 }]),
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await service.init();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.my-giulia.com/api/file?fileId=abc123'
      );
      expect(dataProcessor.processExternal).toHaveBeenCalledWith(
        [{ s: 'RPM', t: 0, v: 1000 }],
        'shared.json'
      );
      expect(appState.loading()).toBe(false);
      expect(window.location.search).toBe('');
      expect(window.location.hash).toBe('#analyzer');
    });

    it('shows an alert and stops loading when the proxy responds with an error', async () => {
      setSearch('?fileId=bad-id');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ error: 'File not found', fileName: '' }),
        })
      );

      await service.init();

      expect(dataProcessor.processExternal).not.toHaveBeenCalled();
      expect(appState.alertMessage()).toContain('File not found');
      expect(appState.loading()).toBe(false);
    });

    it('shows an alert when the network request fails', async () => {
      setSearch('?fileId=abc123');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 500 })
      );

      await service.init();

      expect(appState.alertMessage()).toContain('Could not load shared file');
      expect(appState.loading()).toBe(false);
    });

    it('decompresses a gzip-compressed shared file', async () => {
      const original = [{ s: 'RPM', t: 0, v: 500 }];
      const cs = new CompressionStream('gzip');
      const writer = cs.writable.getWriter();
      void writer.write(new TextEncoder().encode(JSON.stringify(original)));
      void writer.close();
      const compressedBuffer = await new Response(cs.readable).arrayBuffer();
      const binary = Array.from(new Uint8Array(compressedBuffer))
        .map((b) => String.fromCharCode(b))
        .join('');
      const base64 = btoa(binary);

      setSearch('?fileId=gz1');
      const fetchMock = vi.fn((url: string) => {
        if (url.startsWith('data:')) {
          return Promise.resolve(new Response(compressedBuffer));
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            fileName: 'shared.json.gz',
            compressed: true,
            content: base64,
          }),
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      await service.init();

      expect(dataProcessor.processExternal).toHaveBeenCalledWith(
        original,
        'shared.json.gz'
      );
    });
  });
});
