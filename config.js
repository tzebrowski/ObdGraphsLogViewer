// config.js

// --- CONSTANTS ---
const CHART_COLORS = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6'];

// Strict Mapping: Key = Template Rule Name, Value = Array of possible CSV Headers
const SIGNAL_MAPPINGS = {
    "Intake Manifold Pressure Measured": ["Manifold Abs", "MAP", "Intake Press", "Boost Pressure"],
    "Accelerator Pedal Position": ["Pedal Pos", "APP", "Throttle Pos", "TPS"],
    "Spark Advance": ["Ignition Timing", "Timing Adv", "Spark Angle"],
    "Lambda Sensor 1": ["O2 Sensor", "Equivalence Ratio", "AFR", "Lambda"],
    "Short Fuel Trim": ["SFT", "STFT", "Short Term"]
};

const ANOMALY_TEMPLATES = {
    "high_load_retard": {
        name: "High Load / Spark Retard",
        rules: [
            { sig: "Accelerator Pedal Position", op: ">", val: 50 },
            { sig: "Intake Manifold Pressure Measured", op: ">", val: 2200 },
            { sig: "Spark Advance", op: "<", val: 0 }
        ]
    },
    "lean_in_boost": {
        name: "Lean Mixture under Boost (Dangerous)",
        rules: [
            { sig: "Intake Manifold Pressure Measured", op: ">", val: 1500 },
            { sig: "Lambda Sensor 1", op: ">", val: 1.0 }
        ]
    },
    "boost_leak_rich": {
        name: "Potential Boost Leak (Rich Trim)",
        rules: [
            { sig: "Intake Manifold Pressure Measured", op: ">", val: 2000 },
            { sig: "Short Fuel Trim", op: "<", val: -15 }
        ]
    }
};

// --- GLOBAL STATE ---
const AppState = {
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

// --- DOM HELPER ---
const DOM = {
    get: (id) => document.getElementById(id),
    sidebar: document.getElementById('sidebar'),
    chartCtx: document.getElementById('telemetryChart').getContext('2d'),
};