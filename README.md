# MyGiulia LOG Viewer (ObdGraphsLogViewer)

## Overview

**ObdGraphsLogViewer** (also known as the MyGiulia Online Log Analyzer) is a lightweight, browser-based telemetry log viewer designed specifically for automotive diagnostics. It serves as the official web companion to the **ObdGraphs / MyGiulia** Android application.

This tool empowers users to take telemetry data recorded on the road and analyze it on a larger screen. Whether you are reviewing a track day, diagnosing a misfire, or fine-tuning performance, the analyzer provides interactive visualization, automated anomaly scanning, and seamless cloud synchronization.

## Video Walkthrough

Watch the video below to see the log viewer, cloud synchronization, tagging, and virtual dyno features in action:

[![ObdGraphsLogViewer Walkthrough](https://img.youtube.com/vi/GPiEH2WuFo8/0.jpg)](https://www.youtube.com/watch?v=GPiEH2WuFo8 "ObdGraphsLogViewer Walkthrough")

## Key Features

- **Virtual Dyno:** Instantly estimate horsepower and torque curves. The app analyzes your telemetry data (such as RPM and speed over time) to generate dyno-style graphs without needing expensive physical equipment.
- **Custom Tagging & Bookmarking:** Easily tag specific moments in your logs (e.g., "3rd gear pull," "misfire here," or "clean shift"). This allows you to quickly jump back to points of interest without manually scrubbing through the entire timeline.
- **Interactive Telemetry Visualization:** High-performance, responsive line charts powered by Chart.js. Supports smooth zooming and panning (via Hammer.js) to inspect micro-events in your engine data.
- **Seamless Cloud Sync:** Natively integrates with Google Drive using Google Identity Services (GSI) and GAPI. Pull your recorded JSON logs directly from the cloud without manual file transfers.
- **Local File Support:** Prefer offline analysis? Simply drag and drop your local JSON log files directly into the browser.
- **Automated Anomaly Detection:** Features a built-in scanner that uses customizable JSON templates to identify dangerous or specific engine conditions (e.g., "High Load / Spark Retard" or brake-boosting).
- **Event Highlighting:** Automatically maps and highlights detected anomaly ranges directly on the chart timeline, saving you from manually scrubbing through thousands of data points.
- **Smart Signal Mapping:** Utilizes a strict alias system to map raw telemetry headers to standardized, easy-to-read metric names.

## How the Ecosystem Works

The Log Viewer is designed to work frictionlessly with the mobile app ecosystem:

1. **Record on the Go:** Use the ObdGraphs/MyGiulia mobile app to log your vehicle's telemetry data during a drive.
2. **Upload to Cloud:** Use the app's Cloud Synchronization feature to securely push the generated JSON trip logs to your Google Drive.
3. **Analyze on Desktop:** Open the **ObdGraphsLogViewer** in your web browser, authenticate with Google Drive, and instantly load your logs for deep-dive performance reviews.

## Hosting & Deployment

The application is automatically built and deployed via GitHub Actions to GitHub Pages. This ensures that the latest version of the viewer is always accessible as a static web application at:

**[https://my-giulia.com/](https://my-giulia.com/)**

## Tech Stack & Architecture

This project is built for speed and maintainability, migrating from a legacy global-script structure to a modern Vite architecture:

- **Bundler:** Vite for ultra-fast development and optimized production builds.
- **Architecture:** Fully modular ES Modules (ESM) structure, eliminating global variable pollution.
- **Charts:** Chart.js integrated via NPM, utilizing the `date-fns` adapter and zoom plugin.
- **Integration:** Google API (GAPI) & Google Identity Services for Drive access.
- **Linting & Code Quality:** Automated code quality enforcement via ESLint (JS) and Stylelint (CSS).