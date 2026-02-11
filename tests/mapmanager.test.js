import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals';

// ------------------------------------------------------------------
// 1. LEAFLET MOCK SETUP
// ------------------------------------------------------------------

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
  on: jest.fn().mockReturnThis(),
};

// Create a real DOM element for markers to support classList checks (Anti-Jitter)
const mockMarkerElement = document.createElement('div');
mockMarkerElement.innerHTML = '<svg></svg>';

const mockMarker = {
  addTo: jest.fn().mockReturnThis(),
  setLatLng: jest.fn().mockReturnThis(),
  remove: jest.fn(),
  getElement: jest.fn().mockReturnValue(mockMarkerElement),
  on: jest.fn().mockReturnThis(),
  dragging: { enabled: jest.fn().mockReturnValue(true) },
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

// ------------------------------------------------------------------
// 2. APP MODULE MOCKS
// ------------------------------------------------------------------

await jest.unstable_mockModule('../src/config.js', () => ({
  AppState: { files: [] },
  DOM: { get: jest.fn() },
  Config: { ANOMALY_TEMPLATES: [] },
  EVENTS: {
    MAP_SELECTED: 'map:position-selected',
    FILE_REMOVED: 'file:removed',
    BATCH_LOADED: 'dataprocessor:batch-load-completed',
  },
}));

const mockMessenger = { on: jest.fn(), emit: jest.fn() };
await jest.unstable_mockModule('../src/bus.js', () => ({
  messenger: mockMessenger,
}));

await jest.unstable_mockModule('../src/preferences.js', () => ({
  Preferences: {
    prefs: {
      darkTheme: false,
      loadMap: true,
    },
  },
}));

// ------------------------------------------------------------------
// 3. IMPORTS
// ------------------------------------------------------------------

const { mapManager, LinearInterpolator } = await import('../src/mapmanager.js');
const { AppState, DOM, EVENTS } = await import('../src/config.js');

// ------------------------------------------------------------------
// 4. TEST SUITE
// ------------------------------------------------------------------

describe('MapManager System', () => {
  const createEmbeddedMapContainer = (index) => {
    const div = document.createElement('div');
    div.id = `embedded-map-${index}`;
    document.body.appendChild(div);
    return div;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    AppState.files = [];

    document.body.innerHTML = '';
    DOM.get.mockImplementation((id) => document.getElementById(id));

    global.requestAnimationFrame = (cb) => cb();

    if (mapManager.reset) {
      mapManager.reset();
    }
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.useRealTimers();
  });

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

  describe('MapManager Initialization & Loading', () => {
    test('should initialize and listen for FILE_REMOVED', () => {
      mapManager.init();
      expect(mockMessenger.on).toHaveBeenCalledWith(
        EVENTS.FILE_REMOVED,
        expect.any(Function)
      );
    });

    test('should NOT initialize if container is missing', () => {
      const mockFile = {
        name: 'Trip.json',
        availableSignals: ['GPS Latitude', 'GPS Longitude'],
        signals: { 'GPS Latitude': [], 'GPS Longitude': [] },
      };
      AppState.files = [mockFile];

      mockLeafletObj.map.mockClear();
      mapManager.init();
      mapManager.loadRoute(0);

      expect(mockLeafletObj.map).not.toHaveBeenCalled();
    });

    test('should load route and create map instance', () => {
      const mockFile = {
        name: 'Trip.json',
        startTime: 0,
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
      createEmbeddedMapContainer(0);

      mapManager.init();
      mapManager.loadRoute(0);

      expect(mockLeafletObj.map).toHaveBeenCalledWith(
        'embedded-map-0',
        expect.objectContaining({ zoomControl: false })
      );
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

      createEmbeddedMapContainer(0);

      mapManager.init();
      mapManager.loadRoute(0);

      jest.runAllTimers();

      expect(mockMap.invalidateSize).toHaveBeenCalled();
    });

    test('should sync position marker', () => {
      const mockFile = {
        name: 'SyncTest.json',
        startTime: 0,
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
      createEmbeddedMapContainer(0);

      mapManager.init();
      mapManager.loadRoute(0);

      mockMarker.setLatLng.mockClear();
      mapManager.syncPosition(1000);
      expect(mockMarker.setLatLng).toHaveBeenCalledWith([10, 10]);
    });

    test('should destroy map on file removal', () => {
      const mockFile = {
        name: 'Trip.json',
        availableSignals: ['GPS Latitude', 'GPS Longitude'],
        signals: {
          'GPS Latitude': [{ x: 0, y: 0 }],
          'GPS Longitude': [{ x: 0, y: 0 }],
        },
      };
      AppState.files = [mockFile];
      createEmbeddedMapContainer(0);

      mapManager.init();
      mapManager.loadRoute(0);

      const call = mockMessenger.on.mock.calls.find(
        (c) => c[0] === EVENTS.FILE_REMOVED
      );
      expect(call).toBeDefined();

      const eventCallback = call[1];
      eventCallback({ index: 0 });

      expect(mockMap.remove).toHaveBeenCalled();
    });

    test('should ignore syncPosition if not initialized', () => {
      if (mapManager.reset) mapManager.reset();
      mockMarker.setLatLng.mockClear();
      mapManager.syncPosition(1000);
      expect(mockMarker.setLatLng).not.toHaveBeenCalled();
    });
  });

  describe('Interaction Events', () => {
    test('should emit MAP_SELECTED when route is clicked', () => {
      const mockFile = {
        name: 'ClickSync.json',
        availableSignals: ['GPS Latitude', 'GPS Longitude'],
        signals: {
          'GPS Latitude': [
            { x: 1000, y: 52.0 },
            { x: 2000, y: 52.1 },
          ],
          'GPS Longitude': [
            { x: 1000, y: 20.0 },
            { x: 2000, y: 20.1 },
          ],
        },
      };
      AppState.files = [mockFile];
      createEmbeddedMapContainer(0);

      mapManager.init();
      mapManager.loadRoute(0);

      const clickHandler = mockPolyline.on.mock.calls.find(
        (c) => c[0] === 'click'
      )[1];
      clickHandler({ latlng: { lat: 52.0001, lng: 20.0001 } });

      expect(mockMessenger.emit).toHaveBeenCalledWith(EVENTS.MAP_SELECTED, {
        time: 1000,
        fileIndex: 0,
      });
    });

    test('should emit MAP_SELECTED when marker is dragged', () => {
      const mockFile = {
        name: 'DragSync.json',
        availableSignals: ['GPS Latitude', 'GPS Longitude'],
        signals: {
          'GPS Latitude': [{ x: 5000, y: 40.0 }],
          'GPS Longitude': [{ x: 5000, y: -74.0 }],
        },
      };
      AppState.files = [mockFile];
      createEmbeddedMapContainer(0);

      mapManager.init();
      mapManager.loadRoute(0);

      // Extract the drag handler registered on the marker
      const dragHandler = mockMarker.on.mock.calls.find(
        (c) => c[0] === 'drag'
      )[1];

      // Simulate the marker being dragged to a specific location
      dragHandler({ target: { getLatLng: () => ({ lat: 40.0, lng: -74.0 }) } });

      expect(mockMessenger.emit).toHaveBeenCalledWith(EVENTS.MAP_SELECTED, {
        time: 5000,
        fileIndex: 0,
      });
    });

    test('should ensure marker is initialized as draggable', () => {
      const mockFile = {
        name: 'DraggableTest.json',
        availableSignals: ['GPS Latitude', 'GPS Longitude'],
        signals: {
          'GPS Latitude': [{ x: 0, y: 1 }],
          'GPS Longitude': [{ x: 0, y: 1 }],
        },
      };
      AppState.files = [mockFile];
      createEmbeddedMapContainer(0);

      mapManager.init();
      mapManager.loadRoute(0);

      // Verify options passed to L.marker
      expect(mockLeafletObj.marker).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ draggable: true })
      );
    });
  });

  describe('Overlay Mode (Shared Map)', () => {
    let overlayContainer;
    let markersCreated = [];

    // Helper to create the overlay container
    const createOverlayContainer = () => {
      const div = document.createElement('div');
      div.id = 'overlay-map-container';
      document.body.appendChild(div);
      return div;
    };

    beforeEach(() => {
      // RESET mocks for this specific suite to handle multiple markers
      markersCreated = [];

      // Override the global L.marker mock to return UNIQUE instances
      // This is crucial for testing the "Anti-Jitter" logic where we need
      // to distinguish between two different markers on the same map.
      mockLeafletObj.marker.mockImplementation(() => {
        const el = document.createElement('div');
        const instance = {
          addTo: jest.fn().mockReturnThis(),
          setLatLng: jest.fn().mockReturnThis(),
          remove: jest.fn(),
          getElement: jest.fn().mockReturnValue(el),
          on: jest.fn().mockImplementation((event, cb) => {
            // Store handler for triggering later
            instance._handlers = instance._handlers || {};
            instance._handlers[event] = cb;
            return instance;
          }),
          dragging: { enabled: () => true },
        };
        markersCreated.push(instance);
        return instance;
      });

      overlayContainer = createOverlayContainer();
    });

    test('should initialize a single shared map for multiple files', () => {
      // Setup 2 files
      AppState.files = [
        {
          name: 'File1',
          startTime: 1000,
          availableSignals: ['GPS Latitude', 'GPS Longitude'],
          signals: {
            'GPS Latitude': [{ x: 1000, y: 10 }],
            'GPS Longitude': [{ x: 1000, y: 10 }],
          },
        },
        {
          name: 'File2',
          startTime: 2000,
          availableSignals: ['GPS Latitude', 'GPS Longitude'],
          signals: {
            'GPS Latitude': [{ x: 2000, y: 20 }],
            'GPS Longitude': [{ x: 2000, y: 20 }],
          },
        },
      ];

      mapManager.loadOverlayMap();

      // Should create ONE map instance
      expect(mockLeafletObj.map).toHaveBeenCalledTimes(1);
      expect(mockLeafletObj.map).toHaveBeenCalledWith(
        'overlay-map-container',
        expect.any(Object)
      );

      // Should create TWO polylines and TWO markers
      expect(mockLeafletObj.polyline).toHaveBeenCalledTimes(2);
      expect(mockLeafletObj.marker).toHaveBeenCalledTimes(2);
    });

    test('should configure overlay markers as draggable with autoPan disabled', () => {
      AppState.files = [
        {
          name: 'File1',
          startTime: 1000,
          availableSignals: ['GPS Latitude', 'GPS Longitude'],
          signals: {
            'GPS Latitude': [{ x: 1000, y: 10 }],
            'GPS Longitude': [{ x: 1000, y: 10 }],
          },
        },
      ];

      mapManager.loadOverlayMap();

      expect(mockLeafletObj.marker).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          draggable: true,
          autoPan: false, // Verify specific overlay configuration
        })
      );
    });

    test('should sync multiple files relative to base start time', () => {
      // File 1 starts at T=1000. File 2 starts at T=2000.
      // We simulate a relative time of +100s.
      // File 1 should look for T=1100.
      // File 2 should look for T=2100.

      AppState.files = [
        {
          name: 'File1',
          startTime: 1000,
          availableSignals: ['GPS Latitude', 'GPS Longitude'],
          signals: {
            'GPS Latitude': [
              { x: 1000, y: 10 },
              { x: 1100, y: 11 },
            ],
            'GPS Longitude': [
              { x: 1000, y: 10 },
              { x: 1100, y: 11 },
            ],
          },
        },
        {
          name: 'File2',
          startTime: 2000,
          availableSignals: ['GPS Latitude', 'GPS Longitude'],
          signals: {
            'GPS Latitude': [
              { x: 2000, y: 20 },
              { x: 2100, y: 21 },
            ],
            'GPS Longitude': [
              { x: 2000, y: 20 },
              { x: 2100, y: 21 },
            ],
          },
        },
      ];

      mapManager.loadOverlayMap();

      // Clear initial setLatLng calls from initialization
      markersCreated.forEach((m) => m.setLatLng.mockClear());

      // Sync at Relative Time = 1000 + 100 = 1100 (Absolute for File 1)
      // For File 2 (Start 2000), Relative 100 means Absolute 2100.
      mapManager.syncOverlayPosition(1000 + 100);

      // Verify Marker 1 moved to (11, 11)
      expect(markersCreated[0].setLatLng).toHaveBeenCalledWith([11, 11]);

      // Verify Marker 2 moved to (21, 21)
      expect(markersCreated[1].setLatLng).toHaveBeenCalledWith([21, 21]);
    });

    test('ANTI-JITTER: should NOT update a marker if it is currently being dragged', () => {
      AppState.files = [
        {
          name: 'File1',
          startTime: 1000,
          availableSignals: ['GPS Latitude', 'GPS Longitude'],
          signals: {
            'GPS Latitude': [
              { x: 1000, y: 10 },
              { x: 1100, y: 11 },
            ],
            'GPS Longitude': [{ x: 1000, y: 10 }],
          },
        },
        {
          name: 'File2',
          startTime: 2000,
          availableSignals: ['GPS Latitude', 'GPS Longitude'],
          signals: {
            'GPS Latitude': [
              { x: 2000, y: 20 },
              { x: 2100, y: 21 },
            ],
            'GPS Longitude': [{ x: 2000, y: 20 }],
          },
        },
      ];

      mapManager.loadOverlayMap();
      markersCreated.forEach((m) => m.setLatLng.mockClear());

      const marker1 = markersCreated[0];
      const marker2 = markersCreated[1];

      // Simulate Marker 1 being dragged by adding the class Leaflet uses
      marker1.getElement().classList.add('leaflet-drag-target');

      // Attempt to sync positions
      mapManager.syncOverlayPosition(1100);

      // Marker 1 (Dragging) should NOT be updated (Anti-Jitter)
      expect(marker1.setLatLng).not.toHaveBeenCalled();

      // Marker 2 (Idle) SHOULD be updated normally
      expect(marker2.setLatLng).toHaveBeenCalled();
    });

    test('should emit map:position-selected with correct params when dragged', () => {
      AppState.files = [
        {
          name: 'File1',
          startTime: 1000,
          availableSignals: ['GPS Latitude', 'GPS Longitude'],
          signals: {
            'GPS Latitude': [
              { x: 1000, y: 10 },
              { x: 1100, y: 11 },
            ], // Distance
            'GPS Longitude': [
              { x: 1000, y: 10 },
              { x: 1100, y: 11 },
            ],
          },
        },
      ];

      mapManager.loadOverlayMap();

      const marker = markersCreated[0];
      const dragHandler = marker._handlers['drag'];

      // Simulate dragging to coordinates corresponding to T=1100
      dragHandler({ target: { getLatLng: () => ({ lat: 11, lng: 11 }) } });

      expect(mockMessenger.emit).toHaveBeenCalledWith(EVENTS.MAP_SELECTED, {
        time: 1100, // Should find the time closest to lat/lng (11,11)
        fileIndex: 0,
      });
    });
  });

  describe('Sync Map Bounds', () => {
    test('should sync bounds for single file', () => {
      const mockFile = {
        name: 'Bounds.json',
        startTime: 0,
        duration: 100,
        availableSignals: ['GPS Latitude', 'GPS Longitude'],
        signals: {
          'GPS Latitude': [
            { x: 0, y: 10 },
            { x: 50, y: 20 },
            { x: 100, y: 30 },
          ],
          'GPS Longitude': [
            { x: 0, y: 10 },
            { x: 50, y: 20 },
            { x: 100, y: 30 },
          ],
        },
      };
      AppState.files = [mockFile];
      createEmbeddedMapContainer(0);

      mapManager.init();
      mapManager.loadRoute(0);

      // Sync visible range 0-60 (Should include first two points)
      mapManager.syncMapBounds(0, 60, 0);

      expect(mockMap.fitBounds).toHaveBeenCalled();
    });
  });
});
