import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { DeepLink } from '../src/deeplink.js';
import { UI } from '../src/ui.js';
import { Alert } from '../src/alert.js';
import { dataProcessor } from '../src/dataprocessor.js';

describe('DeepLink Module Test Suite', () => {
  let consoleSpy;
  let historySpy;
  let urlHasSpy;
  let urlGetSpy;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    UI.setLoading = jest.fn();
    Alert.showAlert = jest.fn();
    dataProcessor.process = jest.fn();

    global.fetch = jest.fn();
    global.DecompressionStream = jest.fn();
    global.Response = jest.fn();

    historySpy = jest
      .spyOn(window.history, 'replaceState')
      .mockImplementation(() => {});
    urlHasSpy = jest
      .spyOn(URLSearchParams.prototype, 'has')
      .mockReturnValue(false);
    urlGetSpy = jest
      .spyOn(URLSearchParams.prototype, 'get')
      .mockReturnValue(null);
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('hasFileId()', () => {
    test('returns true when fileId query parameter is present', () => {
      urlHasSpy.mockImplementation((key) => key === 'fileId');
      expect(DeepLink.hasFileId()).toBe(true);
    });

    test('returns false when fileId query parameter is completely missing', () => {
      urlHasSpy.mockImplementation((key) => key === 'differentParam');
      expect(DeepLink.hasFileId()).toBe(false);
    });

    test('returns false when query string parameters are empty', () => {
      urlHasSpy.mockReturnValue(false);
      expect(DeepLink.hasFileId()).toBe(false);
    });
  });

  describe('init()', () => {
    test('exits early and performs no actions if no fileId is present in URL', async () => {
      urlHasSpy.mockReturnValue(false);
      const loadSharedFileSpy = jest.spyOn(DeepLink, 'loadSharedFile');

      await DeepLink.init();

      expect(UI.setLoading).not.toHaveBeenCalled();
      expect(historySpy).not.toHaveBeenCalled();
      expect(loadSharedFileSpy).not.toHaveBeenCalled();
    });

    test('triggers loading sequence, clears view history, and processes file if fileId is present', async () => {
      urlHasSpy.mockImplementation((key) => key === 'fileId');
      urlGetSpy.mockImplementation((key) =>
        key === 'fileId' ? 'shared-id-999' : null
      );
      document.title = 'Analyzer App';

      const loadSharedFileSpy = jest
        .spyOn(DeepLink, 'loadSharedFile')
        .mockResolvedValue(undefined);

      await DeepLink.init();

      expect(UI.setLoading).toHaveBeenNthCalledWith(
        1,
        true,
        'Opening shared log...'
      );
      expect(historySpy).toHaveBeenCalledWith(
        {},
        'Analyzer App',
        expect.stringContaining('#analyzer')
      );
      expect(loadSharedFileSpy).toHaveBeenCalledWith('shared-id-999');
      expect(UI.setLoading).toHaveBeenLastCalledWith(false);
    });

    test('alerts user on file load error and guarantees loading panel is closed', async () => {
      urlHasSpy.mockImplementation((key) => key === 'fileId');
      urlGetSpy.mockImplementation((key) =>
        key === 'fileId' ? 'bad-id' : null
      );

      jest
        .spyOn(DeepLink, 'loadSharedFile')
        .mockRejectedValue(new Error('Proxy error timeout'));

      await DeepLink.init();

      expect(Alert.showAlert).toHaveBeenCalledWith(
        'Could not load shared file: Proxy error timeout'
      );
      expect(UI.setLoading).toHaveBeenLastCalledWith(false);
    });
  });

  describe('loadSharedFile()', () => {
    test('fetches uncompressed files from GAS proxy and hands payload to dataProcessor', async () => {
      const mockProxyResponse = {
        fileName: 'commute-log.json',
        compressed: false,
        content: '{"speed": 60, "rpm": 3000}',
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProxyResponse),
      });

      await DeepLink.loadSharedFile('target-file-id');

      expect(global.fetch).toHaveBeenCalledWith(
        `${DeepLink.GAS_PROXY_URL}?fileId=target-file-id`
      );
      expect(dataProcessor.process).toHaveBeenCalledWith(
        { speed: 60, rpm: 3000 },
        'commute-log.json'
      );
    });

    test('extracts base64 data, decompresses gzip stream, and hands JSON payload to dataProcessor', async () => {
      const mockProxyResponse = {
        fileName: 'track-day.json.gz',
        compressed: true,
        content: 'H4sICAAAAAAA/zM=',
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProxyResponse),
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        blob: () =>
          Promise.resolve({
            stream: () => ({
              pipeThrough: jest
                .fn()
                .mockReturnValue('decompression-pipeline-output'),
            }),
          }),
      });

      global.Response.mockImplementation(() => ({
        text: () => Promise.resolve('{"lapTime": 84.5}'),
      }));

      await DeepLink.loadSharedFile('compressed-file-id');

      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        `${DeepLink.GAS_PROXY_URL}?fileId=compressed-file-id`
      );
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'data:application/octet-stream;base64,H4sICAAAAAAA/zM='
      );
      expect(dataProcessor.process).toHaveBeenCalledWith(
        { lapTime: 84.5 },
        'track-day.json.gz'
      );
    });

    test('throws error if the proxy response object contains an explicit server engine error', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            error: 'File requested is restricted or not public',
          }),
      });

      await expect(DeepLink.loadSharedFile('restricted-id')).rejects.toThrow(
        'File requested is restricted or not public'
      );
      expect(dataProcessor.process).not.toHaveBeenCalled();
    });

    test('throws error if the gateway server returns a bad HTTP status code', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(DeepLink.loadSharedFile('broken-server-id')).rejects.toThrow(
        'Network response error: 500'
      );
      expect(dataProcessor.process).not.toHaveBeenCalled();
    });
  });
});
