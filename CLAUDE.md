# CLAUDE.md

## AI Assistant Directives (Token & Context Management)

- **Aggressive Context Management:**
  - You MUST monitor context size. Prompt the user to use `/compact` mid-task if the conversation history grows too long (to prevent >150k token context bloat and expensive cache reads).
  - Remind the user to use `/clear` when switching to a completely new task or a different module. Do not carry stale context.
- **Subagent & Fork Efficiency:** When spawning subagents or using "forks", keep instructions strictly scoped to prevent runaway loops. If performing simple file-system reads, prefer cheaper models (like Haiku) if the environment allows it.
- **Brevity is required:** Provide code solutions directly. Omit preamble, conversational filler, and lengthy explanations unless explicitly requested.
- **Tooling Reliance:** Do not act as a syntax linter or formatter. Rely on ESLint, Stylelint, and Prettier (see Commands below) and CI to catch formatting/lint issues.
- **Never amend commits:** Always create a new commit instead of `git commit --amend`, even for a small immediate follow-up fix (e.g. a lint/format correction) to a commit made moments earlier. This holds regardless of whether the original commit has been pushed.
- **Run Prettier before committing:** Run `npx prettier --write` on changed files (or `npm run format`) before creating a commit, so CI's Prettier check doesn't fail on avoidable formatting issues.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ObdGraphsLogViewer (aka "MyGiulia Online Log Analyzer") is a browser-based telemetry log viewer for automotive diagnostics — the web companion to the ObdGraphs/MyGiulia Android app. Users load JSON/CSV telemetry logs (drag-and-drop or from Google Drive) and get interactive charts, a virtual dyno, anomaly scanning, and map playback of a drive.

It is deployed as a static site to GitHub Pages (https://my-giulia.com/) — web-only. There is no Electron/desktop build (that was dropped during the Angular rewrite; do not resurrect `main.js`/`electron-builder`-style tooling without checking with the user first).

The app is a **standalone Angular application** (Angular 21, `bootstrapApplication`, no NgModules). It is a from-scratch rewrite of a prior plain-ES-modules app, which is preserved untouched under `legacy/` for reference — `legacy/` has its own `vite.config.mjs`/`jest.config.js`/`package.json`-scripts (`legacy:dev`, `legacy:test`, `legacy:test:coverage`) and is excluded from ESLint/the Angular build. Don't edit `legacy/` except to consult it as the behavioral spec when porting a not-yet-ported feature.

## Related repos

This repo and `/home/tzebrowski/github/tuning-tools` (the "hextune" webapp, same author) should stay **architecturally aligned** — shared UX patterns (e.g. update/release notifications, general app-shell conventions) should look and behave consistently across both. Before designing or implementing any cross-cutting UX/architecture feature here, check how `tuning-tools` (its `webapp/` dir and its own `CLAUDE.md`) already does it, and propose matching that rather than inventing a new pattern from scratch. Flag it to the user if matching isn't feasible.

## Commands

```bash
npm start                 # ng serve — Angular dev server
npm run build             # ng build -> dist/ (what CI runs)
npm run watch             # ng build --watch --configuration development

npm test                  # ng test (Vitest under the Angular builder)

npx eslint src --ext .ts  # Lint TS (CI runs this; legacy/**/*.js has its own looser block in eslint.config.mjs)
npx prettier --check .    # Formatting check (npm run format to auto-fix)

npm run legacy:dev            # Vite dev server for the old legacy/ app, for behavioral reference only
npm run legacy:test           # Jest tests for legacy/
npm run legacy:test:coverage  # Jest coverage for legacy/
```

To run one test by name: `npx ng test --watch=false -- -t "<test name pattern>"`.

Tests are colocated as `*.spec.ts` next to the file they cover (e.g. `src/app/core/drive.service.ts` ↔ `src/app/core/drive.service.spec.ts`). When adding a new service or component, add a matching `.spec.ts` beside it.

CI (`.github/workflows/static.yml`) runs, in order: ESLint → Prettier check → `ng test` → `ng build`. On a `v*` tag push it also zips `dist/` into a GitHub release and deploys `dist/` to GitHub Pages.

## Architecture

**Standalone components + injectable services**, no NgModules. `src/main.ts` calls `bootstrapApplication(App, appConfig)`. `App` (`src/app/app.ts`) is the composition root: it does hash-based routing (`#analyzer` vs. landing — a deliberate simplification, not the Angular Router) and calls `.init()` on `ProjectManagerService`, `AuthService`, `SignalRegistryService`, and `DeepLinkService` in its constructor. Feature UI lives under `src/app/analyzer/<feature>/` (one folder per legacy manager's view: `chart-view`, `sidebar`, `drive-panel`, `dyno-modal`, `histogram-modal`, `math-channel-modal`, `xy-modal`, `embedded-map`, `overlay-map`, `anomaly-scanner`, `library-panel`, `file-loader`, `loading-overlay`); `top-nav/` and `landing/` are the other top-level UI pieces.

**Every legacy singleton manager has a 1:1 Angular service** in `src/app/core/`, `@Injectable({ providedIn: 'root' })`, named `<Thing>Service`: `AuthService`, `DriveService`, `DbManagerService`, `SignalRegistryService`, `DataProcessorService`, `MathChannelsService`, `ProjectManagerService`, `XyAnalysisService`, `MapService`, `DynoService`, `AnalysisService`, `HistogramService`, `PreferencesService`, `DeepLinkService`. State that used to live on the shared `AppState` object (`config.js`) is now `AppStateService` (`src/app/core/app-state.service.ts`), built on Angular signals (`signal`/`computed`) instead of a plain mutable object — read state by calling the signal, don't mutate it directly. `UiStateService` holds transient UI-only state (sidebar open/closed, modal visibility, etc).

**Cross-module communication**: `EventBusService` (`src/app/core/event-bus.service.ts`) is a thin RxJS `Subject`-based pub/sub, ported 1:1 from `legacy/src/bus.js` — event name strings carry over unchanged, defined in `EVENTS` in `src/app/core/models.ts` (was `src/config.js`). Prefer `EventBusService.emit`/`.on` over adding direct service-to-service injection between unrelated features, matching the legacy convention.

**Data flow**: `DataProcessorService` is the ingestion point for local files and Google Drive downloads, normalizing JSON/CSV into a common `{x, y}` schema, then persisting via `DbManagerService` (IndexedDB, DB name `GiuliaTelemetryDB`, two object stores: `files` metadata and `signals` data) so reloads skip re-parsing. `SignalRegistryService` maps raw OBD/telemetry keys to human-readable metadata by fetching and caching (7-day TTL) JSON dictionaries from the `tzebrowski/ObdMetrics` GitHub repo at runtime — a live network dependency, not a local file.

**Google Drive integration** (`AuthService`, `DriveService`) uses Google Identity Services (GSI) + GAPI loaded dynamically from Google's CDN. Scoped to the full `drive` scope (not `drive.readonly` as legacy requested) — a deliberate fix documented in `auth.service.ts`, since file tagging (`appProperties`) and public-link sharing call Drive _write_ endpoints against folder-scanned files, which `drive.file`/`drive.readonly` don't cover; legacy's narrower scope silently broke those writes at runtime.

**Charts**: the `chart-view` feature wraps Chart.js (+ `chartjs-plugin-zoom`, `chartjs-plugin-datalabels`, `chartjs-adapter-date-fns`, Hammer.js for touch) with stack/overlay view modes. `embedded-map`/`overlay-map` drive a Leaflet map synced to chart cursor position over the event bus. `xy-modal` and `histogram-modal` are separate analysis views over the same loaded signal data. `dyno-modal`/`DynoService` derive horsepower/torque curves from RPM/speed telemetry. `math-channel-modal`/`MathChannelsService` let users define derived signals from formulas (`math-definitions.ts` holds the built-in set). `hammerjs` and `leaflet` are CommonJS packages — `ng build` emits (harmless, expected) optimization-bailout warnings for both; `allowedCommonJsDependencies` in `angular.json` silences them.

**Anomaly detection**: `AnalysisService` runs scans driven by JSON templates in `src/app/core/analysis-templates.json` — templates describe conditions like "High Load / Spark Retard" over signal ranges.

**Styling**: `src/styles.css` (~6900 lines) is still one large global stylesheet carried over from legacy; individual components additionally have their own scoped `<component>.css`. There isn't yet a hard rule about where new styles should go — check whether the pattern already exists in `styles.css` before adding a component-scoped file.

**Versioning note**: unlike legacy (which injected a git tag at build time via Vite's `VITE_GIT_TAG`), the Angular app has no build-time git-describe injection set up, so `App.appVersion` just reads `package.json`'s `version` field directly (see the comment in `src/app/app.ts`) — don't assume `VITE_GIT_TAG`/`import.meta.env` exist anywhere in `src/app`. Separately, `scripts/gen-version.js` (run via the `postinstall`/`prebuild` npm hooks, mirroring hextune's `tuning-tools/webapp/scripts/gen-version.js`) stamps a plain ISO-timestamp build id into two **generated, gitignored** files — `src/app/core/version.generated.ts` and `public/version.json` — purely so `VersionCheckService` can detect a redeploy at runtime; this is unrelated to the `appVersion` footer badge above and isn't a git-describe mechanism.

**Build output obfuscation**: `npm run build`'s `postbuild` hook runs `scripts/obfuscate.js`, which obfuscates every `.js` file in `dist/` in place with `javascript-obfuscator` (identifier renaming, base64 string-array encoding, etc. — config in `scripts/obfuscator-config.js`) and re-attaches the AGPL license banner esbuild strips, mirroring hextune's `tuning-tools/webapp/scripts/obfuscate.js`/`obfuscator-config.js`. It skips itself when `.map` files are present (a development build). Unlike hextune, this app has no gated/paywalled feature chunks, so there's no `gate-chunks.js` counterpart here.

**Porting-in-progress convention**: several files carry JSDoc comments explicitly noting where the Angular port deliberately deviates from `legacy/` behavior (e.g. `src/app/app.ts`'s routing, the version-badge note above). When you spot one of these, treat it as the source of truth over what `legacy/` does — read it before "fixing" an apparent behavioral mismatch.
