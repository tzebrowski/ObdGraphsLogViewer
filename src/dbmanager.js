import { messenger } from './bus.js';
import { EVENTS } from './config.js';

class DBManager {
  #db = null;
  #DB_NAME = 'GiuliaTelemetryDB';
  #VERSION = 1;

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.#DB_NAME, this.#VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        // Store file metadata (lightweight)
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
        }
        // Store heavy signal data separately
        if (!db.objectStoreNames.contains('signals')) {
          db.createObjectStore('signals', { keyPath: 'fileId' });
        }
      };

      request.onsuccess = () => {
        this.#db = request.result;
        resolve();
      };

      request.onerror = () => {
        console.error('DB Init Error', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Saves a processed file to the database.
   * Returns the new DB ID.
   */
  async saveTelemetry(fileObj) {
    if (!this.#db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.#db.transaction(
        ['files', 'signals'],
        'readwrite'
      );

      const metadata = {
        name: fileObj.name,
        size: fileObj.size,
        startTime: fileObj.startTime,
        duration: fileObj.duration,
        availableSignals: fileObj.availableSignals,
        metadata: fileObj.metadata || {},
        addedAt: Date.now(),
      };

      const fileRequest = transaction.objectStore('files').add(metadata);

      fileRequest.onsuccess = (event) => {
        const fileId = event.target.result;

        // Save the heavy signals array linked by fileId
        const signalRequest = transaction.objectStore('signals').add({
          fileId: fileId,
          data: fileObj.signals, // The heavy payload
        });

        signalRequest.onsuccess = () => resolve(fileId);
      };

      transaction.onerror = () => reject(transaction.error);
    });
  }

  async getAllFiles() {
    if (!this.#db) await this.init();
    return new Promise((resolve) => {
      const transaction = this.#db.transaction('files', 'readonly');
      const store = transaction.objectStore('files');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
    });
  }

  async getFileSignals(fileId) {
    if (!this.#db) await this.init();
    return new Promise((resolve) => {
      const transaction = this.#db.transaction('signals', 'readonly');
      const store = transaction.objectStore('signals');
      const request = store.get(fileId);
      request.onsuccess = () => resolve(request.result?.data || null);
    });
  }

  async deleteFile(fileId) {
    if (!this.#db) await this.init();
    const transaction = this.#db.transaction(['files', 'signals'], 'readwrite');
    transaction.objectStore('files').delete(fileId);
    transaction.objectStore('signals').delete(fileId);
  }

  async clearAll() {
    if (!this.#db) await this.init();
    const transaction = this.#db.transaction(['files', 'signals'], 'readwrite');
    transaction.objectStore('files').clear();
    transaction.objectStore('signals').clear();
  }
}

export const dbManager = new DBManager();
