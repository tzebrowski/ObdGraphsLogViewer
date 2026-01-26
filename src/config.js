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

export const SIGNAL_MAPPINGS = {
  'Engine Speed': ['RPM', 'Engine Speed', 'Engine RPM'],
  'Intake Manifold Pressure Measured': [
    'Manifold Abs',
    'MAP',
    'Intake Press',
    'Boost Pressure',
  ],

  MAF: ['Air Mass', 'MAF', 'Flow'],

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
