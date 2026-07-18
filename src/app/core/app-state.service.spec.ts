import { describe, expect, it } from 'vitest';
import { AppStateService } from './app-state.service';
import { EventBusService } from './event-bus.service';
import { LoadedFile } from './models';

function makeFile(overrides: Partial<LoadedFile> = {}): LoadedFile {
  return {
    name: 'trip.json',
    rawData: [],
    signals: {},
    startTime: 0,
    duration: 10,
    availableSignals: ['RPM', 'Speed'],
    metadata: {},
    size: 0,
    dbId: 1,
    ...overrides,
  };
}

describe('AppStateService', () => {
  it('reports dataLoaded only once a file is present', () => {
    const state = new AppStateService(new EventBusService());
    expect(state.dataLoaded()).toBe(false);
    state.addFile(makeFile());
    expect(state.dataLoaded()).toBe(true);
  });

  it('does not add a file whose dbId is already present', () => {
    const state = new AppStateService(new EventBusService());
    state.addFile(makeFile({ dbId: 1 }));
    state.addFile(makeFile({ dbId: 1 }));
    expect(state.files().length).toBe(1);
  });

  it('removeFileAt removes by index without touching other files', () => {
    const state = new AppStateService(new EventBusService());
    state.addFile(makeFile({ dbId: 1, name: 'a.json' }));
    state.addFile(makeFile({ dbId: 2, name: 'b.json' }));
    state.removeFileAt(0);
    expect(state.files().map((f) => f.name)).toEqual(['b.json']);
  });

  it('removeFileAt emits FILE_REMOVED with the removed file', () => {
    const bus = new EventBusService();
    const state = new AppStateService(bus);
    state.addFile(makeFile({ dbId: 1, name: 'a.json' }));

    const received: unknown[] = [];
    bus.on('file:removed').subscribe((event) => received.push(event));

    state.removeFileAt(0);

    expect(received).toEqual([
      { index: 0, file: expect.objectContaining({ name: 'a.json' }) },
    ]);
  });

  it('addDerivedSignal adds a signal to one file without mutating others', () => {
    const state = new AppStateService(new EventBusService());
    state.addFile(
      makeFile({ dbId: 1, name: 'a.json', availableSignals: ['RPM'] })
    );
    state.addFile(
      makeFile({ dbId: 2, name: 'b.json', availableSignals: ['RPM'] })
    );

    state.addDerivedSignal(0, 'Math: Boost', [{ x: 0, y: 1.2 }], {
      min: 1.2,
      max: 1.2,
    });

    expect(state.files()[0].availableSignals).toEqual(['Math: Boost', 'RPM']);
    expect(state.files()[0].signals['Math: Boost']).toEqual([{ x: 0, y: 1.2 }]);
    expect(state.files()[1].availableSignals).toEqual(['RPM']);
  });

  it('setActiveHighlight sets the active highlight signal', () => {
    const state = new AppStateService(new EventBusService());
    expect(state.activeHighlight()).toBeNull();
    state.setActiveHighlight(1, 5, 0);
    expect(state.activeHighlight()).toEqual({
      start: 1,
      end: 5,
      targetIndex: 0,
    });
  });

  it('clearActiveHighlight resets the active highlight signal to null', () => {
    const state = new AppStateService(new EventBusService());
    state.setActiveHighlight(1, 5, 0);
    state.clearActiveHighlight();
    expect(state.activeHighlight()).toBeNull();
  });

  it('signals are visible by default and can be toggled per file/signal', () => {
    const state = new AppStateService(new EventBusService());
    expect(state.isSignalVisible(0, 'RPM')).toBe(true);

    state.setSignalVisible(0, 'RPM', false);
    expect(state.isSignalVisible(0, 'RPM')).toBe(false);
    expect(state.isSignalVisible(0, 'Speed')).toBe(true);
    expect(state.isSignalVisible(1, 'RPM')).toBe(true);

    state.setSignalVisible(0, 'RPM', true);
    expect(state.isSignalVisible(0, 'RPM')).toBe(true);
  });

  it('setAllSignalsVisibleForFile toggles only the given file', () => {
    const state = new AppStateService(new EventBusService());
    state.setAllSignalsVisibleForFile(0, ['RPM', 'Speed'], false);
    expect(state.isSignalVisible(0, 'RPM')).toBe(false);
    expect(state.isSignalVisible(0, 'Speed')).toBe(false);
    expect(state.isSignalVisible(1, 'RPM')).toBe(true);
  });

  it('setAllSignalsVisible(false) hides every signal across all loaded files', () => {
    const state = new AppStateService(new EventBusService());
    state.addFile(makeFile({ dbId: 1, availableSignals: ['RPM'] }));
    state.addFile(makeFile({ dbId: 2, availableSignals: ['Speed'] }));

    state.setAllSignalsVisible(false);
    expect(state.isSignalVisible(0, 'RPM')).toBe(false);
    expect(state.isSignalVisible(1, 'Speed')).toBe(false);

    state.setAllSignalsVisible(true);
    expect(state.isSignalVisible(0, 'RPM')).toBe(true);
    expect(state.isSignalVisible(1, 'Speed')).toBe(true);
  });

  it('addAnnotation appends to one file without mutating others', () => {
    const state = new AppStateService(new EventBusService());
    state.addFile(makeFile({ dbId: 1, name: 'a.json' }));
    state.addFile(makeFile({ dbId: 2, name: 'b.json' }));

    state.addAnnotation(0, { time: 1.5, text: 'Turbo spool' });

    expect(state.files()[0].annotations).toEqual([
      { time: 1.5, text: 'Turbo spool' },
    ]);
    expect(state.files()[1].annotations).toBeUndefined();
  });

  it('removeAnnotationAt removes by index', () => {
    const state = new AppStateService(new EventBusService());
    state.addFile(makeFile({ dbId: 1 }));
    state.addAnnotation(0, { time: 1, text: 'first' });
    state.addAnnotation(0, { time: 2, text: 'second' });

    state.removeAnnotationAt(0, 0);

    expect(state.files()[0].annotations).toEqual([{ time: 2, text: 'second' }]);
  });

  it('addFileTag appends a tag and emits FILE_TAG_ADDED', () => {
    const bus = new EventBusService();
    const state = new AppStateService(bus);
    state.addFile(makeFile({ dbId: 1, name: 'a.json' }));

    const received: unknown[] = [];
    bus.on('file:tag-added').subscribe((event) => received.push(event));

    const added = state.addFileTag(0, 'track');

    expect(added).toBe(true);
    expect(state.files()[0].tags).toEqual(['track']);
    expect(received).toEqual([{ fileName: 'a.json', tag: 'track' }]);
  });

  it('addFileTag returns false and does not duplicate an existing tag', () => {
    const state = new AppStateService(new EventBusService());
    state.addFile(makeFile({ dbId: 1 }));
    state.addFileTag(0, 'track');

    const added = state.addFileTag(0, 'track');

    expect(added).toBe(false);
    expect(state.files()[0].tags).toEqual(['track']);
  });

  it('showAlert/clearAlert set and clear the alert message', () => {
    const state = new AppStateService(new EventBusService());
    expect(state.alertMessage()).toBeNull();
    state.showAlert('boom');
    expect(state.alertMessage()).toBe('boom');
    state.clearAlert();
    expect(state.alertMessage()).toBeNull();
  });
});
