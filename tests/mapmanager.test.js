import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';

// --- 1. MOCK LEAFLET ---
const mockMap = {
  setView: jest.fn().mockReturnThis(),
  addTo: jest.fn().mockReturnThis(),
  remove: jest.fn(),
  invalidateSize: jest.fn(),
  fitBounds: jest.fn(),
  hasLayer: jest.fn().mockReturnValue(false),
  removeLayer: jest.fn(),
  addLayer: jest.fn(),
  removeControl: jest.fn(),
};

const mockPolyline = {
  addTo: jest.fn().mockReturnThis(),
  setLatLngs: jest.fn().mockReturnThis(),
  remove: jest.fn(),
  getBounds: jest.fn().mockReturnValue({ isValid: () => true }),
};

const mockMarkerElement = document.createElement('div');
mockMarkerElement.innerHTML = '<svg></svg>';

const mockMarker = {
  addTo: jest.fn().mockReturnThis(),
  setLatLng: jest.fn().mockReturnThis(),
  remove: jest.fn(),
  getElement: jest.fn().mockReturnValue(mockMarkerElement),
};

const mockTileLayer = {
  addTo: jest.fn().mockReturnThis(),
  setUrl: jest.fn().mockReturnThis(),
  remove: jest.fn(),
};

const mockControlInstance = {
  addTo: jest.fn().mockReturnThis(),
  remove: jest.fn(),
};

const mockControlClass = {
  extend: jest.fn().mockImplementation((opts) => {
    return jest.fn((args) => {
      if (opts.onAdd) opts.onAdd();
      return mockControlInstance;
    });
  }),
};

const mockDomUtil = {
  create: jest.fn().mockImplementation((tag) => document.createElement(tag)),
};

const mockLeafletObj = {
  map: jest.fn(() => mockMap),
  tileLayer: jest.fn(() => mockTileLayer),
  polyline: jest.fn(() => mockPolyline),
  marker: jest.fn(() => mockMarker),
  icon: jest.fn(() => ({})),
  divIcon: jest.fn(() => ({})),
  latLngBounds: jest.fn(() => ({ extend: jest.fn(), isValid: () => true })),
  control: {
    zoom: jest.fn(() => mockControlInstance),
    scale: jest.fn(() => mockControlInstance),
  },
  Control: mockControlClass,
  DomUtil: mockDomUtil,
  DomEvent: { disableClickPropagation: jest.fn() },
  Icon: { Default: { prototype: { _getIconUrl: jest.fn() } } },
};

await jest.unstable_mockModule('leaflet', () => ({
  default: mockLeafletObj,
  ...mockLeafletObj,
}));

global.L = mockLeafletObj;

// --- 2. MOCK CONFIG & BUS ---
await jest.unstable_mockModule('../src/config.js', () => ({
  AppState: { files: [] },
  DOM: { get: jest.fn() },
  Config: { ANOMALY_TEMPLATES: [] },
  DEFAULT_SIGNALS: [],
  SIGNAL_MAPPINGS: {
    Latitude: ['GPS Latitude', 'GpsLat'],
    Longitude: ['GPS Longitude', 'GpsLon'],
  },
}));

const mockMessenger = { on: jest.fn(), emit: jest.fn() };
await jest.unstable_mockModule('../src/bus.js', () => ({
  messenger: mockMessenger,
}));

// --- 3. MOCK PREFERENCES (CRITICAL FIX) ---
// This ensures mapManager sees 'loadMap: true' without loading the real Preferences module
await jest.unstable_mockModule('../src/preferences.js', () => ({
  Preferences: {
    prefs: {
      darkTheme: false,
      loadMap: true, // <--- Required for loadRoute to proceed
    },
  },
}));

// --- 4. IMPORTS ---
const { mapManager, LinearInterpolator } = await import('../src/mapmanager.js');
const { AppState, DOM } = await import('../src/config.js');

describe('MapManager System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    AppState.files = [];

    // Reset DOM
    document.body.innerHTML = '<div id="mapContainer"></div>';
    DOM.get.mockImplementation((id) => document.getElementById(id));

    // MOCK requestAnimationFrame
    global.requestAnimationFrame = (cb) => cb();

    // Reset Singleton State
    if (mapManager.reset) {
      mapManager.reset();
    }
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.useRealTimers();
  });

  // --- UNIT TESTS: LINEAR INTERPOLATOR ---
  describe('LinearInterpolator', () => {
    test('should interpolate correctly', () => {
      const data = [
        { x: 0, y: 0 },
        { x: 10, y: 100 },
      ];
      const lerp = new LinearInterpolator(data);
      expect(lerp.getValueAt(5)).toBe(50);
    });

    test('should handle out of bounds', () => {
      const data = [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ];
      const lerp = new LinearInterpolator(data);
      expect(lerp.getValueAt(0)).toBe(10);
      expect(lerp.getValueAt(30)).toBe(20);
    });
  });

  // --- INTEGRATION TESTS: MAPMANAGER ---
  describe('MapManager Logic', () => {
    test('should initialize Leaflet correctly when container exists', () => {
      mapManager.init();
      expect(mockLeafletObj.map).toHaveBeenCalledWith('gps-map-view', {
        zoomControl: false,
      });
      // Verify messenger listener was attached
      expect(mockMessenger.on).toHaveBeenCalledWith(
        'file:removed',
        expect.any(Function)
      );
    });

    test('should NOT initialize if container is missing', () => {
      document.body.innerHTML = '';
      mockLeafletObj.map.mockClear();
      mapManager.init();
      expect(mockLeafletObj.map).not.toHaveBeenCalled();
    });

    test('should load route logic correctly', () => {
      const mockFile = {
        name: 'Trip.json',
        availableSignals: ['GPS Latitude', 'GPS Longitude'],
        signals: {
          'GPS Latitude': [
            { x: 0, y: 50 },
            { x: 1000, y: 51 },
          ],
          'GPS Longitude': [
            { x: 0, y: 10 },
            { x: 1000, y: 11 },
          ],
        },
      };

      AppState.files = [mockFile];
      mapManager.init();
      mapManager.loadRoute(0);

      expect(mockLeafletObj.polyline).toHaveBeenCalled();
      expect(mockPolyline.addTo).toHaveBeenCalledWith(mockMap);
    });

    test('should handle fitBounds with delay', () => {
      const mockFile = {
        name: 'Trip.json',
        availableSignals: ['GPS Latitude', 'GPS Longitude'],
        signals: {
          'GPS Latitude': [
            { x: 0, y: 10 },
            { x: 100, y: 10 },
          ],
          'GPS Longitude': [
            { x: 0, y: 10 },
            { x: 100, y: 10 },
          ],
        },
      };
      AppState.files = [mockFile];
      mapManager.init();
      mapManager.loadRoute(0);

      // Trigger delayed fitBounds
      jest.runAllTimers();

      expect(mockMap.invalidateSize).toHaveBeenCalled();
    });

    test('should sync position marker and rotate', () => {
      const mockFile = {
        name: 'SyncTest.json',
        availableSignals: ['GPS Latitude', 'GPS Longitude'],
        signals: {
          'GPS Latitude': [
            { x: 1000, y: 10 },
            { x: 2000, y: 10.001 },
          ],
          'GPS Longitude': [
            { x: 1000, y: 10 },
            { x: 2000, y: 10.001 },
          ],
        },
      };

      AppState.files = [mockFile];
      mapManager.init();
      mapManager.loadRoute(0);

      mockMarker.setLatLng.mockClear();
      mapManager.syncPosition(1000);
      expect(mockMarker.setLatLng).toHaveBeenCalledWith([10, 10]);
    });

    test('should handle file:removed event', () => {
      const mockFile = {
        name: 'Trip.json',
        availableSignals: ['GPS Latitude', 'GPS Longitude'],
        signals: { 'GPS Latitude': [], 'GPS Longitude': [] },
      };
      AppState.files = [mockFile];

      mapManager.init();
      mapManager.loadRoute(0);

      // Simulate event via the mock callback
      // We look for the specific call that registered 'file:removed'
      const call = mockMessenger.on.mock.calls.find(
        (c) => c[0] === 'file:removed'
      );
      if (call) {
        const eventCallback = call[1];
        eventCallback({ index: 0 });
        expect(mockMap.removeLayer).toHaveBeenCalled();
      } else {
        throw new Error('file:removed listener was not registered in init()');
      }
    });

    test('should ignore syncPosition if not initialized', () => {
      if (mapManager.reset) mapManager.reset();
      mockMarker.setLatLng.mockClear();
      mapManager.syncPosition(1000);
      expect(mockMarker.setLatLng).not.toHaveBeenCalled();
    });
  });
});
