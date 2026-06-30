import { UI } from './ui.js';
import { Alert } from './alert.js';
import { dataProcessor } from './dataprocessor.js';

export const DeepLink = {
  // Centralized endpoint configuration for deep-link data bridging
  GAS_PROXY_URL: 'https://script.google.com/macros/s/AKfycbxmTZr2iGeRXd2GvO1x3tJ118fI1YSCvZ01sRbO0elP_6dtYbiuBNhVsZCgjQEJL3O2WQ/exec',

  /**
   * Checks if a deep-linked file ID is present in the URL query parameters
   * @returns {boolean}
   */
  hasFileId: () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.has('fileId');
  },

  /**
   * Initializes deep-link processing, downloading and opening the file if available
   */
  init: async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const sharedFileId = urlParams.get('fileId');

    if (sharedFileId) {
      try {
        UI.setLoading(true, 'Opening shared log...');

        // Clear routing side-effects by forcing view state history
        window.history.replaceState({}, document.title, window.location.pathname + '#analyzer');

        // Fetch and process via the localized proxy flow
        await DeepLink.loadSharedFile(sharedFileId);

      } catch (error) {
        console.error('Error loading shared file:', error);
        Alert.showAlert(`Could not load shared file: ${error.message}`);
      } finally {
        UI.setLoading(false);
      }
    }
  },

  /**
   * Fetches and decompresses the unauthenticated shared file via the GAS Proxy execution path
   * @param {string} fileId 
   */
  loadSharedFile: async (fileId) => {
    const response = await fetch(`${DeepLink.GAS_PROXY_URL}?fileId=${fileId}`);
    if (!response.ok) throw new Error(`Network response error: ${response.status}`);

    const proxyData = await response.json();
    if (proxyData.error) throw new Error(proxyData.error);

    let dataToProcess;
    const fileName = proxyData.fileName;

    if (proxyData.compressed) {
      const base64Response = await fetch(`data:application/octet-stream;base64,${proxyData.content}`);
      const blob = await base64Response.blob();
      
      const ds = new DecompressionStream('gzip');
      const decompressedStream = blob.stream().pipeThrough(ds);
      dataToProcess = JSON.parse(await new Response(decompressedStream).text());
    } else {
      dataToProcess = JSON.parse(proxyData.content);
    }

    dataProcessor.process(dataToProcess, fileName);
  }
};