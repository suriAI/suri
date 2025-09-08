import { app, BrowserWindow, ipcMain, session } from "electron"
import path from "path"
import { fileURLToPath } from 'node:url'
import isDev from "./util.js";
// Legacy SCRFD service (node-onnx) is unused now; using WebWorker-based pipeline in renderer
import { setupFaceLogIPC } from "./faceLogIPC.js";
import { sqliteFaceDB } from "../services/SimpleSqliteFaceDatabase.js";

// Set consistent app name across all platforms for userData directory
app.setName('Suri');

// Dynamic GPU configuration - works on both old and new hardware
// Enable modern GPU features for capable hardware, graceful fallback for old GPUs

// Always try modern GPU features first (for new laptops)
app.commandLine.appendSwitch('enable-features', 'Vulkan,UseSkiaRenderer')
app.commandLine.appendSwitch('enable-webgl')
app.commandLine.appendSwitch('enable-webgl2-compute-context')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('ignore-gpu-blacklist') // Legacy support
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')

// Add graceful fallback options for old hardware
app.commandLine.appendSwitch('enable-unsafe-swiftshader') // Software WebGL fallback
app.commandLine.appendSwitch('use-gl', 'any') // Try any available GL implementation

// Platform-specific optimizations
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('use-angle', 'default') // Let ANGLE choose best backend
}

// Suppress GPU process errors for old hardware (cosmetic fix)
app.commandLine.appendSwitch('disable-logging')
app.commandLine.appendSwitch('log-level', '3') // Only show fatal errors

let mainWindowRef: BrowserWindow | null = null
// Removed legacy scrfdService usage
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Face Recognition Pipeline IPC handlers
// Removed legacy face-recognition IPC; detection/recognition handled in renderer via Web Workers

// Window control IPC handlers
ipcMain.handle('window:minimize', () => {
    if (mainWindowRef) mainWindowRef.minimize()
    return true
})

ipcMain.handle('window:maximize', () => {
    if (mainWindowRef) {
        if (mainWindowRef.isMaximized()) {
            mainWindowRef.unmaximize()
        } else {
            mainWindowRef.maximize()
        }
    }
    return true
})

ipcMain.handle('window:close', () => {
    if (mainWindowRef) mainWindowRef.close()
    return true
})

function createWindow(): void {
    // Create the browser window.
    const mainWindow = new BrowserWindow({
        width: 1600,
        height: 1000,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            // Basic WebGL support only - avoid experimental features
            webgl: true,
            // Remove experimental features to eliminate security warnings
            // experimentalFeatures: false,  // Explicitly disable
            // enableBlinkFeatures: undefined,  // Don't enable additional features
            disableBlinkFeatures: 'Autofill' // Disable autofill to prevent console errors
        },
        titleBarStyle: 'hidden',
        frame: false,
        show: false,
        backgroundColor: '#000000'
    })

    mainWindowRef = mainWindow

    // Load the app
    if (isDev()) {
        mainWindow.loadURL('http://localhost:5123')
    } else {
        mainWindow.loadFile(path.join(__dirname, '../../dist-react/index.html'))
    }

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show()
    })

    // Handle window maximize/restore events
    mainWindow.on('maximize', () => {
        mainWindow.webContents.send('window:maximized')
    })

    mainWindow.on('unmaximize', () => {
        mainWindow.webContents.send('window:unmaximized')
    })

    // Handle window close
    mainWindow.on('closed', () => {
        mainWindowRef = null
    })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
    // Register protocol to serve static files in packaged app
    if (!isDev()) {
        session.defaultSession.protocol.registerFileProtocol('app', (request, callback) => {
            const url = request.url.substr(6); // Remove 'app://' prefix
            const filePath = path.join(__dirname, '../../dist-react', url);
            callback({ path: filePath });
        });
    }
    
    createWindow()
    
    // Initialize SQLite database first
    try {
        await sqliteFaceDB.initialize();
        console.log('[SUCCESS] SQLite Face Database initialized successfully');
    } catch (error) {
        console.error('[ERROR] Failed to initialize SQLite database:', error);
    }
    
    // Setup database IPC handlers
    setupFaceLogIPC()

    app.on('activate', function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

// Handle app quit
app.on('before-quit', () => {
    // Clean up resources
    // nothing to dispose
})