const { app, BrowserWindow } = require('electron');
const express = require('express');
const path = require('path');

// 1. Setup Local Web Server (Required for Google Auth)
const server = express();
const PORT = 3456; // We will run the app on http://localhost:3456

// Serve the current directory
server.use(express.static(__dirname));

// Start the server
const serverInstance = server.listen(PORT, () => {
    console.log(`Internal server running on http://localhost:${PORT}`);
});

// 2. Setup Electron Window
function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        title: "Alfa Romeo Telemetry Viewer",
        icon: path.join(__dirname, 'icon.png'), // Optional: Add an icon.png if you want
        webPreferences: {
            nodeIntegration: false, // Security best practice
            contextIsolation: true
        }
    });

    // Load the local server URL instead of a file path
    win.loadURL(`http://localhost:${PORT}/index.html`);

    // Maximize on startup
    win.maximize();
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        serverInstance.close(); // Stop server when app closes
        app.quit();
    }
});