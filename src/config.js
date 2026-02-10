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
