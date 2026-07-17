import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStateService } from './app-state.service';
import { AuthService } from './auth.service';
import { DataProcessorService } from './data-processor.service';
import { DriveService } from './drive.service';

function makeAuthFake(isLoggedInInitial = true) {
  return {
    isLoggedIn: signal(isLoggedInInitial),
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn(),
    getAccessToken: vi.fn().mockReturnValue('token-abc'),
  } as unknown as AuthService;
}

function makeAppStateFake() {
  return {
    loading: signal(false),
    loadingMessage: signal(''),
    showAlert: vi.fn(),
  } as unknown as AppStateService;
}

function makeDataProcessorFake() {
  return {
    processExternal: vi.fn().mockResolvedValue(undefined),
  } as unknown as DataProcessorService;
}

function driveFilesList(
  responses: Array<{ result: { files: unknown[]; nextPageToken?: string } }>
) {
  const list = vi.fn();
  responses.forEach((r) => list.mockResolvedValueOnce(r));
  return list;
}

describe('DriveService', () => {
  let auth: ReturnType<typeof makeAuthFake>;
  let appState: ReturnType<typeof makeAppStateFake>;
  let dataProcessor: ReturnType<typeof makeDataProcessorFake>;

  function create(): DriveService {
    return TestBed.runInInjectionContext(
      () => new DriveService(auth, appState, dataProcessor)
    );
  }

  beforeEach(() => {
    auth = makeAuthFake(true);
    appState = makeAppStateFake();
    dataProcessor = makeDataProcessorFake();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clears the file list when auth logs out', () => {
    const drive = create();
    drive.files.set([
      {
        file: { id: '1', name: 'a.json' },
        meta: { date: '', length: '' },
        timestamp: 1,
      },
    ]);

    (auth.isLoggedIn as unknown as { set: (v: boolean) => void }).set(false);
    TestBed.tick();

    expect(drive.files()).toEqual([]);
  });

  it('listFiles() walks mygiulia/trips and populates files on success', async () => {
    const list = driveFilesList([
      { result: { files: [{ id: 'root-1', name: 'mygiulia' }] } },
      { result: { files: [{ id: 'sub-1', name: 'trips' }] } },
      {
        result: {
          files: [
            {
              id: 'f1',
              name: 'trip-profile_5-1700000000000-120.json',
              size: '2048',
            },
          ],
        },
      },
    ]);
    vi.stubGlobal('gapi', { client: { drive: { files: { list } } } });

    const drive = create();
    await drive.listFiles();

    expect(list).toHaveBeenCalledTimes(3);
    expect(drive.files()).toHaveLength(1);
    expect(drive.files()[0].file.name).toBe(
      'trip-profile_5-1700000000000-120.json'
    );
    expect(drive.error()).toBeNull();
  });

  it('listFiles() reports an error when the required folders are missing', async () => {
    const list = driveFilesList([
      { result: { files: [{ id: 'root-1', name: 'mygiulia' }] } },
      { result: { files: [] } },
    ]);
    vi.stubGlobal('gapi', { client: { drive: { files: { list } } } });

    const drive = create();
    await drive.listFiles();

    expect(drive.files()).toEqual([]);
    expect(drive.error()).toContain('Required Drive folders not found');
  });

  it('listFiles() signs out and reports a session-expired error on 401', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        result: { files: [{ id: 'root-1', name: 'mygiulia' }] },
      })
      .mockResolvedValueOnce({
        result: { files: [{ id: 'sub-1', name: 'trips' }] },
      })
      .mockRejectedValueOnce({ status: 401, message: 'nope' });
    const setToken = vi.fn();
    vi.stubGlobal('gapi', { client: { drive: { files: { list } }, setToken } });

    const drive = create();
    await drive.listFiles();

    expect(setToken).toHaveBeenCalledWith(null);
    expect(auth.signOut).toHaveBeenCalled();
    expect(drive.error()).toContain('Session expired');
  });

  it('filteredSortedFiles() filters by name and sorts by timestamp', () => {
    const drive = create();
    drive.files.set([
      {
        file: { id: '1', name: 'Morning Drive' },
        meta: { date: '', length: '' },
        timestamp: 100,
      },
      {
        file: { id: '2', name: 'Track Day' },
        meta: { date: '', length: '' },
        timestamp: 300,
      },
      {
        file: { id: '3', name: 'Evening Drive' },
        meta: { date: '', length: '' },
        timestamp: 200,
      },
    ]);

    expect(drive.filteredSortedFiles().map((f) => f.file.name)).toEqual([
      'Track Day',
      'Evening Drive',
      'Morning Drive',
    ]);

    drive.toggleSortOrder();
    expect(drive.filteredSortedFiles().map((f) => f.file.name)).toEqual([
      'Morning Drive',
      'Evening Drive',
      'Track Day',
    ]);

    drive.setSearchTerm('drive');
    expect(drive.filteredSortedFiles().map((f) => f.file.name)).toEqual([
      'Morning Drive',
      'Evening Drive',
    ]);
  });

  it('loadFile() downloads via the authenticated REST endpoint and hands off to the data processor', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ s: 'RPM', t: 0, v: 1000 }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const drive = create();
    await drive.loadFile('trip.json', 'file-id-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.googleapis.com/drive/v3/files/file-id-1?alt=media',
      { headers: { Authorization: 'Bearer token-abc' } }
    );
    expect(dataProcessor.processExternal).toHaveBeenCalledWith(
      [{ s: 'RPM', t: 0, v: 1000 }],
      'trip.json'
    );
  });

  it('loadFile() surfaces an alert when the download fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500 })
    );

    const drive = create();
    await drive.loadFile('trip.json', 'file-id-1');

    expect(appState.showAlert).toHaveBeenCalledWith(
      expect.stringContaining('Download Error')
    );
    expect(dataProcessor.processExternal).not.toHaveBeenCalled();
  });

  describe('pagination', () => {
    function makeEntries(count: number) {
      return Array.from({ length: count }, (_, i) => ({
        file: { id: `f${i}`, name: `log-${i}.json` },
        meta: { date: '', length: '' },
        timestamp: i,
      }));
    }

    it('paginatedFiles slices the sorted list by itemsPerPage', () => {
      const drive = create();
      drive.setItemsPerPage(10);
      drive.files.set(makeEntries(25));

      expect(drive.totalPages()).toBe(3);
      expect(drive.paginatedFiles()).toHaveLength(10);

      drive.nextPage();
      expect(drive.currentPage()).toBe(2);
      expect(drive.paginatedFiles()[0].file.id).toBe('f14'); // desc sort by timestamp

      drive.nextPage();
      drive.nextPage(); // clamps at totalPages
      expect(drive.currentPage()).toBe(3);
      expect(drive.paginatedFiles()).toHaveLength(5);
    });

    it('prevPage clamps at 1 and search resets to page 1', () => {
      const drive = create();
      drive.files.set(makeEntries(15));
      drive.setItemsPerPage(10);

      drive.prevPage();
      expect(drive.currentPage()).toBe(1);

      drive.nextPage();
      expect(drive.currentPage()).toBe(2);
      drive.setSearchTerm('log');
      expect(drive.currentPage()).toBe(1);
    });
  });

  describe('recently viewed', () => {
    it('loadFile records the id, most-recent first, capped at 3, deduped', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
      );
      const drive = create();

      await drive.loadFile('a.json', 'id-a');
      await drive.loadFile('b.json', 'id-b');
      await drive.loadFile('c.json', 'id-c');
      await drive.loadFile('d.json', 'id-d');
      await drive.loadFile('a.json', 'id-a');

      expect(drive.recentIds()).toEqual(['id-a', 'id-d', 'id-c']);
    });

    it('recentEntries resolves ids against currently loaded files', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
      );
      const drive = create();
      drive.files.set([
        {
          file: { id: 'id-a', name: 'a.json' },
          meta: { date: '', length: '' },
          timestamp: 1,
        },
        {
          file: { id: 'id-b', name: 'b.json' },
          meta: { date: '', length: '' },
          timestamp: 2,
        },
      ]);

      await drive.loadFile('b.json', 'id-b');
      await drive.loadFile('missing.json', 'id-missing');

      expect(drive.recentEntries().map((e) => e.file.id)).toEqual(['id-b']);
    });

    it('clearRecentHistory empties the list and localStorage', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
      );
      const drive = create();
      await drive.loadFile('a.json', 'id-a');
      expect(drive.recentIds()).toEqual(['id-a']);

      drive.clearRecentHistory();
      expect(drive.recentIds()).toEqual([]);
      expect(localStorage.getItem('recent_logs')).toBeNull();
    });
  });

  describe('tagging', () => {
    function makeTaggedEntry(tags: string[] = []) {
      return {
        file: { id: 'f1', name: 'log.json' },
        meta: { date: '', length: '' },
        timestamp: 1,
        tags,
      };
    }

    it('addTag persists via files.update and updates the entry optimistically', async () => {
      const update = vi.fn().mockResolvedValue({});
      vi.stubGlobal('gapi', { client: { drive: { files: { update } } } });

      const drive = create();
      const entry = makeTaggedEntry();
      drive.files.set([entry]);

      await drive.addTag(entry, 'Track Day');

      expect(update).toHaveBeenCalledWith({
        fileId: 'f1',
        appProperties: { tags: 'track day' },
      });
      expect(drive.files()[0].tags).toEqual(['track day']);
    });

    it('addTag rejects a duplicate tag without calling the API', async () => {
      const update = vi.fn();
      vi.stubGlobal('gapi', { client: { drive: { files: { update } } } });

      const drive = create();
      const entry = makeTaggedEntry(['track']);
      drive.files.set([entry]);

      await drive.addTag(entry, 'Track');

      expect(update).not.toHaveBeenCalled();
      expect(appState.showAlert).toHaveBeenCalledWith(
        expect.stringContaining('already applied')
      );
    });

    it('addTag reverts the optimistic update and alerts on API failure', async () => {
      const update = vi.fn().mockRejectedValue(new Error('nope'));
      vi.stubGlobal('gapi', { client: { drive: { files: { update } } } });

      const drive = create();
      const entry = makeTaggedEntry();
      drive.files.set([entry]);

      await drive.addTag(entry, 'rain');

      expect(drive.files()[0].tags).toEqual([]);
      expect(appState.showAlert).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save tag')
      );
    });
  });

  describe('makeFilePublicAndCopyLink', () => {
    it('creates a public permission and copies the shareable link', async () => {
      const create_ = vi.fn().mockResolvedValue({});
      vi.stubGlobal('gapi', {
        client: { drive: { permissions: { create: create_ } } },
      });
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });

      const drive = create();
      await drive.makeFilePublicAndCopyLink('file-xyz');

      expect(create_).toHaveBeenCalledWith({
        fileId: 'file-xyz',
        resource: { role: 'reader', type: 'anyone' },
      });
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('fileId=file-xyz')
      );
      expect(appState.showAlert).toHaveBeenCalledWith(
        expect.stringContaining('Success')
      );
    });

    it('alerts on failure', async () => {
      vi.stubGlobal('gapi', {
        client: {
          drive: {
            permissions: {
              create: vi.fn().mockRejectedValue(new Error('denied')),
            },
          },
        },
      });

      const drive = create();
      await drive.makeFilePublicAndCopyLink('file-xyz');

      expect(appState.showAlert).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create public link')
      );
    });
  });
});
