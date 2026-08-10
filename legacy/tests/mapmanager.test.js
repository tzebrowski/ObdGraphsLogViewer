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
  getPane: jest.fn().mockReturnValue(null),
  createPane: jest.fn(),
};

const mockPolyline = {
  addTo: jest.fn().mockReturnThis(),
  setLatLngs: jest.fn().mockReturnThis(),
  remove: jest.fn(),
  getBounds: jest.fn().mockReturnValue({ isValid: () => true }),
  on: jest.fn().mockReturnThis(),
};

const mockMarkerElement = document.createElement('div');
mockMarkerElement.innerHTML = '<svg></svg>';

const mockMarker = {
  addTo: jest.fn().mockReturnThis(),
  setLatLng: jest.fn().mockReturnThis(),
  remove: jest.fn(),
  getElement: jest.fn().mockReturnValue(mockMarkerElement),
  on: jest.fn().mockReturnThis(),
  dragging: { enabled: jest.fn().mockReturnValue(true) },
  setZIndexOffset: jest.fn().mockReturnThis(),
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
    return function () {
      this.onAdd = opts.onAdd;
      this.addTo = jest.fn().mockReturnThis();
      this.remove = jest.fn();
      return this;
    };
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
  latLngBounds: jest.fn(() => ({
    extend: jest.fn(),
    isValid: () => true,
    getSouthWest: () => ({ lat: 0, lng: 0 }),
    getNorthEast: () => ({ lat: 1, lng: 1 }),
  })),
  layerGroup: jest.fn(() => ({
    addTo: jest.fn().mockReturnThis(),
    clearLayers: jest.fn(),
    remove: jest.fn(),
    on: jest.fn().mockReturnThis(),
  })),
  control: {
    zoom: jest.fn(() => mockControlInstance),
  },
  Control: mockControlClass,
  DomUtil: mockDomUtil,
  DomEvent: { disableClickPropagation: jest.fn() },
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
  EVENTS: {
    MAP_SELECTED: 'map:position-selected',
    FILE_REMOVED: 'file:removed',
  },
}));

const mockMessenger = { on: jest.fn(), emit: jest.fn() };
await jest.unstable_mockModule('../src/bus.js', () => ({
  messenger: mockMessenger,
}));

await jest.unstable_mockModule('../src/preferences.js', () => ({
  Preferences: { prefs: { darkTheme: false, loadMap: true } },
}));

const mockSignalRegistry = { findSignal: jest.fn() };
await jest.unstable_mockModule('../src/signalregistry.js', () => ({
  signalRegistry: mockSignalRegistry,
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

    // FIX: Default Signal Registry Mock to return key if it exists in signals
    mockSignalRegistry.findSignal.mockImplementation((alias, signals) => {
      if (alias === 'Latitude')
        return signals.find((s) => s.toLowerCase().includes('lat'));
      if (alias === 'Longitude')
        return signals.find((s) => s.toLowerCase().includes('lon'));
      if (alias === 'GPS Speed')
        return signals.find((s) => s.toLowerCase().includes('speed'));
      return null;
    });

    global.requestAnimationFrame = (cb) => cb();
  });

  afterEach(() => {
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
      AppState.files = [{ availableSignals: ['Lat'], signals: { Lat: [] } }];
      mapManager.loadRoute(0);
      expect(mockLeafletObj.map).not.toHaveBeenCalled();
    });

    test('should load route and create layer group', () => {
      AppState.files = [
        {
          availableSignals: ['Lat', 'Lon'],
          signals: { Lat: [{ x: 0, y: 50 }], Lon: [{ x: 0, y: 10 }] },
        },
      ];
      createEmbeddedMapContainer(0);
      mapManager.loadRoute(0);
      expect(mockLeafletObj.map).toHaveBeenCalled();
      expect(mockLeafletObj.layerGroup).toHaveBeenCalled();
    });

    test('should handle fitBounds with delay', () => {
      AppState.files = [
        {
          availableSignals: ['Lat', 'Lon'],
          signals: { Lat: [{ x: 0, y: 10 }], Lon: [{ x: 0, y: 10 }] },
        },
      ];
      createEmbeddedMapContainer(0);
      mapManager.loadRoute(0);
      jest.runAllTimers();
      expect(mockMap.invalidateSize).toHaveBeenCalled();
    });

    test('should sync position marker', () => {
      AppState.files = [
        {
          startTime: 0,
          availableSignals: ['Lat', 'Lon'],
          signals: { Lat: [{ x: 1000, y: 10 }], Lon: [{ x: 1000, y: 10 }] },
        },
      ];
      createEmbeddedMapContainer(0);
      mapManager.loadRoute(0);
      mockMarker.setLatLng.mockClear();
      mapManager.syncPosition(1000);
      expect(mockMarker.setLatLng).toHaveBeenCalledWith([10, 10]);
    });

    test.skip('should destroy map on file removal', () => {
      AppState.files = [
        { availableSignals: ['Latitude'], signals: { Latitude: [] } },
      ];
      createEmbeddedMapContainer(0);
      mockSignalRegistry.findSignal.mockImplementation((n) => n);
      mapManager.init();
      mapManager.loadRoute(0);

      const removalCallback = mockMessenger.on.mock.calls.find(
        (c) => c[0] === EVENTS.FILE_REMOVED
      )[1];
      removalCallback({ index: 0 });

      expect(mockMap.remove).toHaveBeenCalled();
    });

    test('should ignore syncPosition if not initialized', () => {
      if (mapManager.reset) mapManager.reset();
      mockMarker.setLatLng.mockClear();
      mapManager.syncPosition(1000);
      expect(mockMarker.setLatLng).not.toHaveBeenCalled();
    });
  });

  describe('Heatmap & Legend Logic', () => {
    test('should detect speed signal and create legend', () => {
      const mockFile = {
        availableSignals: ['Lat', 'Lon', 'Speed'],
        signals: {
          Lat: [
            { x: 0, y: 50 },
            { x: 1000, y: 51 },
          ],
          Lon: [
            { x: 0, y: 10 },
            { x: 1000, y: 11 },
          ],
          Speed: [
            { x: 0, y: 60 },
            { x: 1000, y: 80 },
          ],
        },
      };
      AppState.files = [mockFile];
      createEmbeddedMapContainer(0);
      mapManager.loadRoute(0);
      expect(mockLeafletObj.Control.extend).toHaveBeenCalled();
    });

    test('should update dynamic value in legend', () => {
      const mockFile = {
        availableSignals: ['Lat', 'Lon', 'Speed'],
        signals: {
          Lat: [{ x: 1000, y: 10 }],
          Lon: [{ x: 1000, y: 10 }],
          Speed: [{ x: 1000, y: 125.4 }],
        },
      };
      AppState.files = [mockFile];
      createEmbeddedMapContainer(0);
      mapManager.loadRoute(0);

      const controlConstructor =
        mockLeafletObj.Control.extend.mock.results[0].value;
      const controlInstance = new controlConstructor();
      const legendDiv = controlInstance.onAdd();
      document.body.appendChild(legendDiv);

      mapManager.syncPosition(1000);
      const valSpan = document.getElementById('map-legend-val-0');
      expect(valSpan.innerText).toBe('125.4');
    });
  });

  describe('Interaction Events', () => {
    test('should emit MAP_SELECTED when route is clicked', () => {
      AppState.files = [
        {
          availableSignals: ['Lat', 'Lon'],
          signals: { Lat: [{ x: 1000, y: 50.0 }], Lon: [{ x: 1000, y: 10.0 }] },
        },
      ];
      createEmbeddedMapContainer(0);
      mapManager.loadRoute(0);

      const clickHandler = mockPolyline.on.mock.calls.find(
        (c) => c[0] === 'click'
      )[1];
      clickHandler({ latlng: { lat: 50.0, lng: 10.0 } });

      expect(mockMessenger.emit).toHaveBeenCalledWith(EVENTS.MAP_SELECTED, {
        time: 1000,
        fileIndex: 0,
      });
    });

    test('should emit MAP_SELECTED when marker is dragged', () => {
      AppState.files = [
        {
          availableSignals: ['Lat', 'Lon'],
          signals: { Lat: [{ x: 5000, y: 40.0 }], Lon: [{ x: 5000, y: 10.0 }] },
        },
      ];
      createEmbeddedMapContainer(0);
      mapManager.loadRoute(0);

      const dragHandler = mockMarker.on.mock.calls.find(
        (c) => c[0] === 'drag'
      )[1];
      dragHandler({ target: { getLatLng: () => ({ lat: 40.0, lng: 10.0 }) } });

      expect(mockMessenger.emit).toHaveBeenCalledWith(EVENTS.MAP_SELECTED, {
        time: 5000,
        fileIndex: 0,
      });
    });

    test('should ensure marker is initialized as draggable', () => {
      AppState.files = [
        {
          availableSignals: ['Lat', 'Lon'],
          signals: { Lat: [{ x: 0, y: 1 }], Lon: [{ x: 0, y: 1 }] },
        },
      ];
      createEmbeddedMapContainer(0);
      mapManager.loadRoute(0);
      expect(mockLeafletObj.marker).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ draggable: true })
      );
    });
  });

  describe('Overlay Mode (Shared Map)', () => {
    test('should initialize a single shared map for multiple files', () => {
      AppState.files = [
        {
          startTime: 0,
          availableSignals: ['Lat', 'Lon'],
          signals: { Lat: [{ x: 0, y: 10 }], Lon: [{ x: 0, y: 10 }] },
        },
        {
          startTime: 0,
          availableSignals: ['Lat', 'Lon'],
          signals: { Lat: [{ x: 0, y: 20 }], Lon: [{ x: 0, y: 20 }] },
        },
      ];
      const div = document.createElement('div');
      div.id = 'overlay-map-container';
      document.body.appendChild(div);
      mapManager.loadOverlayMap();
      expect(mockLeafletObj.map).toHaveBeenCalledTimes(1);
    });

    test('should sync multiple files relative to base start time', () => {
      AppState.files = [
        {
          startTime: 1000,
          availableSignals: ['Lat', 'Lon'],
          signals: {
            Lat: [
              { x: 1000, y: 10 },
              { x: 1100, y: 11 },
            ],
            Lon: [
              { x: 1000, y: 10 },
              { x: 1100, y: 11 },
            ],
          },
        },
        {
          startTime: 2000,
          availableSignals: ['Lat', 'Lon'],
          signals: {
            Lat: [
              { x: 2000, y: 20 },
              { x: 2100, y: 21 },
            ],
            Lon: [
              { x: 2000, y: 20 },
              { x: 2100, y: 21 },
            ],
          },
        },
      ];
      const div = document.createElement('div');
      div.id = 'overlay-map-container';
      document.body.appendChild(div);
      mapManager.loadOverlayMap();
      mockMarker.setLatLng.mockClear();
      mapManager.syncOverlayPosition(1100); // Relative 100ms offset
      expect(mockMarker.setLatLng).toHaveBeenCalledTimes(2);
    });

    test('ANTI-JITTER: should NOT update a marker if it is currently being dragged', () => {
      AppState.files = [
        {
          startTime: 0,
          availableSignals: ['Lat', 'Lon'],
          signals: { Lat: [{ x: 0, y: 0 }], Lon: [{ x: 0, y: 0 }] },
        },
      ];
      const div = document.createElement('div');
      div.id = 'overlay-map-container';
      document.body.appendChild(div);
      mapManager.loadOverlayMap();
      mockMarker.getElement().classList.add('leaflet-drag-target');
      mockMarker.setLatLng.mockClear();
      mapManager.syncOverlayPosition(0);
      expect(mockMarker.setLatLng).not.toHaveBeenCalled();
    });

    test('should emit map:position-selected with correct params when dragged', () => {
      AppState.files = [
        {
          startTime: 1000,
          availableSignals: ['Lat', 'Lon'],
          signals: {
            Lat: [
              { x: 1000, y: 10 },
              { x: 1100, y: 11 },
            ],
            Lon: [
              { x: 1000, y: 10 },
              { x: 1100, y: 11 },
            ],
          },
        },
      ];
      const div = document.createElement('div');
      div.id = 'overlay-map-container';
      document.body.appendChild(div);
      mapManager.loadOverlayMap();
      const dragHandler = mockMarker.on.mock.calls.find(
        (c) => c[0] === 'drag'
      )[1];
      dragHandler({ target: { getLatLng: () => ({ lat: 11, lng: 11 }) } });
      expect(mockMessenger.emit).toHaveBeenCalledWith(
        EVENTS.MAP_SELECTED,
        expect.objectContaining({ time: 1100 })
      );
    });
  });

  describe('Sync Map Bounds', () => {
    test('should sync bounds for single file', () => {
      AppState.files = [
        {
          availableSignals: ['Lat', 'Lon'],
          signals: {
            Lat: [
              { x: 0, y: 10 },
              { x: 50, y: 20 },
            ],
            Lon: [
              { x: 0, y: 10 },
              { x: 50, y: 20 },
            ],
          },
        },
      ];
      createEmbeddedMapContainer(0);
      mapManager.loadRoute(0);
      mapManager.syncMapBounds(0, 60, 0);
      expect(mockMap.fitBounds).toHaveBeenCalled();
    });
  });
});
