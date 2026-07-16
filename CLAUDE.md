# CLAUDE.md

## AI Assistant Directives (Token & Context Management)

- **Aggressive Context Management:**
  - You MUST monitor context size. Prompt the user to use `/compact` mid-task if the conversation history grows too long (to prevent >150k token context bloat and expensive cache reads).
  - Remind the user to use `/clear` when switching to a completely new task or a different module. Do not carry stale context.
- **Subagent & Fork Efficiency:** When spawning subagents or using "forks", keep instructions strictly scoped to prevent runaway loops. If performing simple file-system reads, prefer cheaper models (like Haiku) if the environment allows it.
- **Brevity is required:** Provide code solutions directly. Omit preamble, conversational filler, and lengthy explanations unless explicitly requested.
- **Tooling Reliance:** Do not act as a syntax linter or formatter. Rely on ESLint, Stylelint, and Prettier (see Commands below) and CI to catch formatting/lint issues.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ObdGraphsLogViewer (aka "MyGiulia Online Log Analyzer") is a browser-based telemetry log viewer for automotive diagnostics — the web companion to the ObdGraphs/MyGiulia Android app. Users load JSON/CSV telemetry logs (drag-and-drop or from Google Drive) and get interactive charts, a virtual dyno, anomaly scanning, and map playback of a drive.

It is deployed as a static site to GitHub Pages (https://my-giulia.com/) and is also wrapped in Electron for a desktop build, but the Electron shell (`main.js`) is trivial — it just serves `dist/` via a local Express server and loads it in a `BrowserWindow`. There is no `ipcRenderer`/native-bridge usage anywhere in `src/`, so all app code is plain browser code and should be treated as such.

## Commands

```bash
npm run dev             # Vite dev server
npx vite build --base ./  # Production build -> dist/ (what CI runs; `npm run dist`-style build)

npm test                 # Run all tests (Jest + jsdom)
npm run test:coverage    # Run tests with coverage report

npx eslint src --ext .js                                      # Lint JS (CI runs this)
npx stylelint "**/*.css" --config stylelint.config.mjs --ignore-pattern "coverage/**"  # Lint CSS
npx prettier --check .   # Formatting check (npm run format to auto-fix)

npm start                # Run the Electron-wrapped desktop build (electron . --no-sandbox)
npm run pack             # electron-builder --dir (unpacked desktop build)
npm run dist             # electron-builder (packaged desktop installer)
```

To run a single test file: `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/chartmanager.test.js`
To run one test by name: add `-t "<test name pattern>"` to the above.

Tests live in `tests/*.test.js`, mirroring module names in `src/` 1:1 (e.g. `src/drive.js` ↔ `tests/drive.test.js`). When adding a new `src/<name>.js` module, add a matching `tests/<name>.test.js`.

CI (`.github/workflows/static.yml`) runs, in order: ESLint → Stylelint → Prettier check → `npm test` → `npm run test:coverage` → Vite build. On a `v*` tag push it also zips `dist/` into a GitHub release and deploys `dist/` to GitHub Pages.

## Architecture

**No framework** — plain ES modules manipulating the DOM directly (`document.getElementById`, template strings for HTML injection). `index.html` (~1300 lines) is the single page shell containing all modals/panels; `src/style.css` (~6900 lines) is the single stylesheet. There are two other static pages, `policy.html` and `help_spark.html`, also built as separate Vite entry points (see `vite.config.mjs`).

**Singleton-manager pattern**: nearly every file in `src/` exports one singleton — either a plain object literal with an `init()` method (`Auth`, `UI`, `ChartManager`, `Preferences`, `Navigation`, `DragnDrop`, `Analysis`, `DynoManager`, `Alert`, `DeepLink`, `PaletteManager`, `Histogram`), or a `class ... {}` instantiated once at module scope (`dataProcessor`, `dbManager`, `Drive`, `mathChannels`, `projectManager`, `signalRegistry`, `xyAnalysis`, `mapManager`). There are no instances/factories beyond these singletons.

**Boot sequence** — `src/entry.js` is the composition root: on `window.onload` it calls `dataProcessor.loadConfiguration()` then `.init()` on each manager in a fixed order (config → auth → UI → chart → drag/drop → prefs → nav → palette → xy-analysis → histogram → project → signal registry → dyno). It also attaches every user-facing action as a `window.<fn>` global, because `index.html` wires up behavior with inline `onclick="..."` handlers rather than addEventListener — when adding a new UI action, follow this same pattern (define it on the relevant manager, expose it via `window.x = () => Manager.x()` in `entry.js`, reference it from an inline handler in `index.html`).

**Cross-module communication** goes through `src/bus.js` (`messenger`, a small pub/sub `EventEmitter`) and shared event names in `src/config.js` (`EVENTS`). Prefer emitting/subscribing on `messenger` over adding direct imports between unrelated managers. `src/config.js` also holds `AppState` (the one shared mutable state object — loaded files, chart instances, raw data, signals, Google auth state) and `DOM.get(id)` as the standard element-lookup helper.

**Data flow**: `dataProcessor` (src/dataprocessor.js) is the ingestion point for both local files (drag-and-drop, `<input type=file>`) and Google Drive downloads — it normalizes JSON and CSV telemetry into a common `{x, y}` schema (see `SCHEMA_REGISTRY`/`SCHEMA`), then persists parsed files via `dbManager` (IndexedDB, two object stores: lightweight `files` metadata and heavy `signals` data, DB name `GiuliaTelemetryDB`) so reloads don't require re-parsing. `signalRegistry` (src/signalregistry.js) maps raw OBD/telemetry signal keys to human-readable metadata by fetching and caching (7-day TTL) JSON dictionaries from the `tzebrowski/ObdMetrics` GitHub repo at runtime — this is a live network dependency, not a local file.

**Google Drive integration** (`src/auth.js`, `src/drive.js`) uses Google Identity Services (GSI) + GAPI loaded dynamically from Google's CDN (`accounts.google.com/gsi/client`, `apis.google.com/js/api.js`), scoped to `drive.readonly`. `Auth.onAuthSuccess` is wired to `Drive.listFiles` in `entry.js`.

**Charts**: `chartmanager.js` wraps Chart.js (+ `chartjs-plugin-zoom`, `chartjs-plugin-datalabels`, `chartjs-adapter-date-fns`, and Hammer.js for touch gestures) and supports both stacked and overlay view modes (`VIEW_MODES` in config.js). `mapmanager.js` drives a Leaflet map synced to chart cursor position via the `messenger` bus (`EVENTS.MAP_SELECTED`). `xyanalysis.js` and `histogram.js` are separate analysis views over the same loaded signal data. `dynomanager.js` derives horsepower/torque curves from RPM/speed telemetry. `mathchannels.js` lets users define derived signals from formulas (`mathdefinitions.js` holds the built-in formula set).

**Anomaly detection**: `analysis.js` runs scans driven by JSON templates in `src/templates.json` (loaded once via `dataProcessor.loadConfiguration`) — templates describe conditions like "High Load / Spark Retard" over signal ranges.

**Config note**: `import.meta.env.VITE_GIT_TAG` is injected by `vite.config.mjs` from `git describe --tags` at build time (used for the version shown in-app) — Jest can't resolve `import.meta.env` natively, hence `babel-plugin-transform-vite-meta-env` and `babel-plugin-transform-import-meta` in `babel.config.json` exist specifically to make `src/config.js` testable under Jest.
