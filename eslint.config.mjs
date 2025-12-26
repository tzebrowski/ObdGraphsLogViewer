// eslint.config.mjs
import js from "@eslint/js";
import globals from "globals";

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                ...globals.browser,
                // Project Globals
                Chart: "readonly",
                AppState: "writable",
                DOM: "readonly",
                UI: "readonly",
                ChartManager: "readonly",
                Sliders: "readonly",
                Analysis: "readonly",
                CHART_COLORS: "readonly",
                DataProcessor: "readonly",
                Auth: "readonly",
                Drive: "readonly",
                loadConfiguration: "readonly",
                ANOMALY_TEMPLATES: "writable",
                SIGNAL_MAPPINGS: "readonly",
                DEFAULT_SIGNALS: "readonly",

                // GOOGLE SDK GLOBALS
                gapi: "readonly",
                google: "readonly"
            },
        },
        rules: {
            "no-unused-vars": "warn",
            "no-undef": "error"
        }
    },
    {
        files: ["**/main.js"], 
        languageOptions: {
            globals: {
                ...globals.node // This defines require, __dirname, and process
            }
        }
    }
];