import { Injectable } from '@angular/core';
import { LoadedFile } from './models';

export interface FileMetadata {
  id: number;
  name: string;
  size: number;
  startTime: number;
  duration: number;
  availableSignals: string[];
  metadata: Record<string, unknown>;
  addedAt: number;
}

const DB_NAME = 'GiuliaTelemetryDB';
const DB_VERSION = 1;

/** Port of legacy/src/dbmanager.js — same DB name/stores so a user's existing data still loads. */
@Injectable({ providedIn: 'root' })
export class DbManagerService {
  private db: IDBDatabase | null = null;
  private readonly isSupported = typeof indexedDB !== 'undefined';

  async init(): Promise<void> {
    if (!this.isSupported) {
      console.warn(
        'DbManagerService: IndexedDB is not available in this environment.'
      );
      return;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('signals')) {
          db.createObjectStore('signals', { keyPath: 'fileId' });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onerror = () => {
        console.error('DbManagerService: Init Error', request.error);
        reject(request.error);
      };
    });
  }

  async saveTelemetry(file: LoadedFile): Promise<number | null> {
    if (!this.isSupported) return null;
    if (!this.db) await this.init();
    if (!this.db) return null;

    const db = this.db;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['files', 'signals'], 'readwrite');

      const metadata: Omit<FileMetadata, 'id'> = {
        name: file.name,
        size: file.size,
        startTime: file.startTime,
        duration: file.duration,
        availableSignals: file.availableSignals,
        metadata: file.metadata || {},
        addedAt: Date.now(),
      };

      const fileRequest = transaction.objectStore('files').add(metadata);

      fileRequest.onsuccess = () => {
        const fileId = fileRequest.result as number;
        const signalRequest = transaction.objectStore('signals').add({
          fileId,
          data: file.signals,
        });
        signalRequest.onsuccess = () => resolve(fileId);
      };

      transaction.onerror = () => reject(transaction.error);
    });
  }

  async getAllFiles(): Promise<FileMetadata[]> {
    if (!this.isSupported) return [];
    if (!this.db) await this.init();
    if (!this.db) return [];

    const db = this.db;
    return new Promise((resolve) => {
      const transaction = db.transaction('files', 'readonly');
      const request = transaction.objectStore('files').getAll();
      request.onsuccess = () => resolve(request.result as FileMetadata[]);
      request.onerror = () => resolve([]);
    });
  }

  async getFileSignals(fileId: number): Promise<LoadedFile['signals'] | null> {
    if (!this.isSupported) return null;
    if (!this.db) await this.init();
    if (!this.db) return null;

    const db = this.db;
    return new Promise((resolve) => {
      const transaction = db.transaction('signals', 'readonly');
      const request = transaction.objectStore('signals').get(fileId);
      request.onsuccess = () => resolve(request.result?.data ?? null);
      request.onerror = () => resolve(null);
    });
  }

  async deleteFile(fileId: number): Promise<void> {
    if (!this.isSupported) return;
    if (!this.db) await this.init();
    if (!this.db) return;

    const transaction = this.db.transaction(['files', 'signals'], 'readwrite');
    transaction.objectStore('files').delete(fileId);
    transaction.objectStore('signals').delete(fileId);
  }

  async clearAll(): Promise<void> {
    if (!this.isSupported) return;
    if (!this.db) await this.init();
    if (!this.db) return;

    const transaction = this.db.transaction(['files', 'signals'], 'readwrite');
    transaction.objectStore('files').clear();
    transaction.objectStore('signals').clear();
  }
}
