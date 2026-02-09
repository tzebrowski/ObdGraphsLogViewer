export const DEFAULT_SIGNALS = [
  'Boost',
  'Rpm',
  'Pedal',
  'Trim',
  'Spark',
  'Mass',
  'Intake',
  'Torque',
];

export const VIEW_MODES = {
  STACK: 'stack',
  OVERLAY: 'overlay',
};

export const EVENTS = {
  MAP_SELECTED: 'map:position-selected',
  FILE_REMOVED: 'file:removed',
  BATCH_LOADED: 'dataprocessor:batch-load-completed',
};

export const SIGNAL_MAPPINGS = {
  'Engine Speed': ['RPM', 'Engine Speed', 'Engine RPM', 'Engine Rpm'],
  'Intake Manifold Pressure Measured': [
    'Manifold Abs',
    'MAP',
    'Intake Press',
    'Boost Pressure',
    'Manifold Pressure',
    'Boost',
  ],

  MAF: ['Air Mass', 'MAF', 'Flow'],
  Latitude: ['GPS-Lat', 'lat', 'Lat', 'lateral', 'GPS Latitude', 'Latitude'],
  Longitude: ['GPS-Lon', 'lng', 'Lng', 'lon', 'GPS Longitude', 'Longitude'],

  Torque: ['Torque', 'Engine Torque', 'Nm'],
  'Vehicle Speed': ['Vehicle Speed', 'Speed', 'Velocity'],
  'Gas Pedal Position': [
    'Accelerator Pedal Position',
    'Pedal Pos',
    'Gas Pedal Position',
    'Throttle Pos',
    'TPS',
  ],
  'Spark Advance': ['Ignition Timing', 'Timing Adv', 'Spark Angle'],
  'Lambda Sensor 1': ['O2 Sensor', 'Equivalence Ratio', 'AFR', 'Lambda'],
  'Short Fuel Trim': ['SFT', 'STFT', 'Short Term'],

  'Atmospheric Pressure': [
    'Atmospheric',
    'Baro',
    'Barometric',
    'Ambient Pressure',
  ],
  'AFR Commanded': ['Commanded', 'Target AFR', 'Lambda Request', 'AFR Target'],
  'AFR Measured': [
    'Measured',
    'Current',
    'AFR Measured',
    'Lambda Actual',
    'AFR',
  ],
};

export const Config = {
  ANOMALY_TEMPLATES: {},
};

export const AppState = {
  version: {
    tag: import.meta.env.VITE_GIT_TAG || 'dev',
    repoUrl: 'https://github.com/tzebrowski/ObdGraphsLogViewer',
  },
  files: [],
  chartInstances: [],
  rawData: [],
  signals: {},
  chartInstance: null,
  activeHighlight: null,
  google: {
    tokenClient: null,
    gapiInited: false,
    gisInited: false,
  },
};

export const DOM = {
  get: (id) => document.getElementById(id),
};
