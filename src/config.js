const CHART_COLORS = [
  '#00F2FF', // Electric Cyan (Boost/Turbo)
  '#39FF14', // Neon Green (RPM)
  '#FF007F', // Hot Pink (AFR/Lambda)
  '#FFFF00', // Bright Yellow (Throttle)
  '#BC13FE', // Neon Purple (Timing)
  '#FF4D00', // Safety Orange (Temperatures)
  '#00FF9F', // Spring Green
  '#FFD700', // Gold
  '#FF0000', // Pure Red (Critical Errors)
];

export const CHART_COLORS_LIGHT = [
  '#1A73E8', // Cobalt Blue (Boost/Turbo/Intake)
  '#2E7D32', // Hunter Green (Engine RPM)
  '#C2185B', // Raspberry (AFR / Lambda)
  '#F57C00', // Deep Orange (Throttle / Load)
  '#7B1FA2', // Deep Purple (Ignition Timing)
  '#D32F2F', // Signal Red (Coolant / Oil Temp)
  '#0097A7', // Teal (Airflow / MAF)
  '#607D8B', // Blue Grey (Battery / Voltage)
  '#AFB42B', // Avocado (Fuel Trims / Efficiency)
];

export const getChartColors = () => {
  const isDarkMode = document.body.classList.contains('dark-theme');
  return isDarkMode ? CHART_COLORS : CHART_COLORS_LIGHT;
};

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
  'Intake Manifold Pressure Measured': [
    'Manifold Abs',
    'MAP',
    'Intake Press',
    'Boost Pressure',
  ],
  'Accelerator Pedal Position': ['Pedal Pos', 'APP', 'Throttle Pos', 'TPS'],
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
  availableSignals: [],
  globalStartTime: 0,
  logDuration: 0,
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
