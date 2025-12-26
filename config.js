const CHART_COLORS = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b',

    '#003366', '#4B0082', '#004d40', '#3e2723', '#212121', '#b71c1c',

    '#00e676', '#ffea00', '#d500f9', '#00b0ff', '#ff3d00', '#c6ff00',

    '#827717', '#e65100', '#006064', '#5d4037', '#455a64', '#1a237e',

    '#f06292', '#4db6ac', '#7986cb', '#a1887f', '#00acc1', '#f4511e'
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