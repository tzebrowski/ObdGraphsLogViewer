const CHART_COLORS = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6'];

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