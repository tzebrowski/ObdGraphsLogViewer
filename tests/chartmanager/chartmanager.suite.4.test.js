import { jest, describe, test, expect, beforeEach } from '@jest/globals';

await jest.unstable_mockModule('chart.js', () => {
  return {
    __esModule: true,
    Chart: { register: jest.fn() },
    LineController: jest.fn(),
    LineElement: jest.fn(),
    PointElement: jest.fn(),
    LinearScale: jest.fn(),
    LogarithmicScale: jest.fn(),
    TimeScale: jest.fn(),
    Title: jest.fn(),
    Tooltip: jest.fn(),
    Legend: jest.fn(),
    Filler: jest.fn(),
  };
});

await jest.unstable_mockModule('hammerjs', () => ({ default: jest.fn() }));
await jest.unstable_mockModule('chartjs-plugin-datalabels', () => ({
  default: {},
}));
await jest.unstable_mockModule('chartjs-adapter-date-fns', () => ({}));
await jest.unstable_mockModule('chartjs-plugin-zoom', () => ({ default: {} }));

await jest.unstable_mockModule('../../src/bus.js', () => ({
  messenger: { on: jest.fn() },
}));

await jest.unstable_mockModule('../../src/palettemanager.js', () => ({
  PaletteManager: {},
}));

await jest.unstable_mockModule('../../src/ui.js', () => ({
  UI: { updateDataLoadedState: jest.fn() },
}));

await jest.unstable_mockModule('../../src/preferences.js', () => ({
  Preferences: { prefs: {} },
}));

await jest.unstable_mockModule('../../src/config.js', () => ({
  AppState: { files: [], chartInstances: [] },
  DOM: { get: jest.fn() },
  DEFAULT_SIGNALS: [],
}));

const { ChartManager } = await import('../../src/chartmanager.js');
const { AppState } = await import('../../src/config.js');

describe('ChartManager.showChartInfo', () => {
  const mockFile = {
    name: 'test_track_log.json',
    startTime: new Date('2023-10-10T12:00:00Z').getTime(),
    duration: 125.5,
    availableSignals: ['Speed', 'RPM', 'Throttle'],
    metadata: {
      profileName: 'Racing Profile',
      ecuId: 'ECU-123',
      appVersion: '1.0.0',
    },
    signals: {},
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    AppState.files = [];
    jest.clearAllMocks();
  });

  test('should display modal with correct file metadata', () => {
    AppState.files = [mockFile];

    ChartManager.showChartInfo(0);

    const modal = document.getElementById('metadataModal');
    expect(modal).not.toBeNull();

    expect(modal.innerHTML).toContain('test_track_log.json');
    expect(modal.innerHTML).toContain('Racing Profile');
    expect(modal.innerHTML).toContain('ECU-123');
    expect(modal.innerHTML).toContain('3');
  });

  test('should format duration correctly in the modal', () => {
    AppState.files = [mockFile];

    ChartManager.showChartInfo(0);
    const modal = document.getElementById('metadataModal');

    expect(modal.innerHTML).toContain('2m 5s');
  });

  test('should not display modal if file index does not exist', () => {
    AppState.files = [mockFile];

    ChartManager.showChartInfo(5);

    const modal = document.getElementById('metadataModal');
    expect(modal).toBeNull();
  });

  test('should remove existing modal before opening a new one', () => {
    AppState.files = [mockFile];

    const oldModal = document.createElement('div');
    oldModal.id = 'metadataModal';
    oldModal.innerHTML = 'Old Content';
    document.body.appendChild(oldModal);

    ChartManager.showChartInfo(0);

    const modals = document.querySelectorAll('#metadataModal');
    expect(modals.length).toBe(1);
    expect(modals[0].innerHTML).not.toContain('Old Content');
    expect(modals[0].innerHTML).toContain('test_track_log.json');
  });

  test('should handle missing metadata with fallback values', () => {
    const fileWithoutMeta = {
      ...mockFile,
      metadata: undefined,
    };
    AppState.files = [fileWithoutMeta];

    ChartManager.showChartInfo(0);
    const modal = document.getElementById('metadataModal');

    expect(modal.innerHTML).toContain('N/A');
    expect(modal.innerHTML).toContain('Unknown');
  });

  test('should close modal when close button is clicked', () => {
    AppState.files = [mockFile];
    ChartManager.showChartInfo(0);
    const modal = document.getElementById('metadataModal');

    const closeBtn = modal.querySelector('.btn-close');
    closeBtn.click();

    expect(document.getElementById('metadataModal')).toBeNull();
  });

  test('should close modal when bottom close button is clicked', () => {
    AppState.files = [mockFile];
    ChartManager.showChartInfo(0);
    const modal = document.getElementById('metadataModal');

    const closeBtn = modal.querySelector('.btn.btn-primary');
    closeBtn.click();

    expect(document.getElementById('metadataModal')).toBeNull();
  });
});
