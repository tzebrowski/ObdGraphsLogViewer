const CHART_COLORS = [
    '#00F2FF', // Electric Cyan (Boost/Turbo)
    '#39FF14', // Neon Green (RPM)
    '#FF007F', // Hot Pink (AFR/Lambda)
    '#FFFF00', // Bright Yellow (Throttle)
    '#BC13FE', // Neon Purple (Timing)
    '#FF4D00', // Safety Orange (Temperatures)
    '#00FF9F', // Spring Green
    '#FFD700', // Gold
    '#FF0000'  // Pure Red (Critical Errors)
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


window.CHART_COLORS = CHART_COLORS;
window.DEFAULT_SIGNALS = DEFAULT_SIGNALS;
window.SIGNAL_MAPPINGS = SIGNAL_MAPPINGS;
window.ANOMALY_TEMPLATES = ANOMALY_TEMPLATES;
window.DOM = DOM;
window.AppState = AppState;