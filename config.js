const CHART_COLORS = [
  '#e6194b', '#3cb44b', '#aaad00', '#4363d8', '#f58231', '#911eb4', '#00adad', '#f032e6',
  '#800000', '#008080', '#9a6324', '#000075', '#808000', '#469990', '#306844', '#5b3391',
  '#f06292', '#4db6ac', '#ffb74d', '#9575cd', '#a1887f', '#90a4ae', '#00bfa5', '#64dd17',
  '#ff6f00', '#01579b', '#1a237e', '#b71c1c', '#004d40', '#3e2723'
];

const DEFAULT_SIGNALS = ["Boost", "Rpm", "Pedal", "Trim", "Spark", "Mass"];

const SIGNAL_MAPPINGS = {
    "Intake Manifold Pressure Measured": ["Manifold Abs", "MAP", "Intake Press", "Boost Pressure"],
    "Accelerator Pedal Position": ["Pedal Pos", "APP", "Throttle Pos", "TPS"],
    "Spark Advance": ["Ignition Timing", "Timing Adv", "Spark Angle"],
    "Lambda Sensor 1": ["O2 Sensor", "Equivalence Ratio", "AFR", "Lambda"],
    "Short Fuel Trim": ["SFT", "STFT", "Short Term"]
};

let ANOMALY_TEMPLATES = {};

const AppState = {
    files: [], // Array of objects: { name, rawData, signals, duration, startTime }
    chartInstances: [], // Array of Chart.js instances
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
        gisInited: false
    }
};

const DOM = {
    get: (id) => document.getElementById(id)
};