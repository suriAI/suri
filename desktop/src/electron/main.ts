import { app, BrowserWindow, ipcMain } from "electron"
import path from "path"
import { fileURLToPath } from 'node:url'
import isDev from "./util.js";
import { ScrfdService } from "../services/ScrfdService.js";
import type { SerializableImageData } from "../services/ScrfdService.js";
import { setupFaceLogIPC } from "./faceLogIPC.js";
import { sqliteFaceDB } from "../services/SimpleSqliteFaceDatabase.js";

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
let scrfdService: ScrfdService | null = null
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Face Recognition Pipeline IPC handlers
ipcMain.handle('face-recognition:initialize', async () => {
    try {
        if (!scrfdService) {
            scrfdService = new ScrfdService()
        }

        // Initialize the SCRFD service
        const weightsDir = path.join(__dirname, '../../../weights')
        await scrfdService.initialize(path.join(weightsDir, 'scrfd_2.5g_kps_640x640.onnx'))
        
        return { success: true, message: 'SCRFD service initialized successfully' }
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
})

ipcMain.handle('face-recognition:process-frame', async (_evt, imageData: SerializableImageData) => {
    try {
        if (!scrfdService) {
            throw new Error('SCRFD service not initialized')
        }
        
        const startTime = performance.now()
        
        // Process frame through SCRFD service
        const detections = await scrfdService.detect(imageData)
        const processingTime = Math.round(performance.now() - startTime)
        
        // Convert to expected format
        const result = {
            detections: detections.map(det => ({
                bbox: det.bbox,
                confidence: det.confidence,
                landmarks: det.landmarks,
                recognition: {
                    personId: null,
                    similarity: 0
                }
            })),
            processingTime
        }
        
        return result
    } catch (error) {
        return {
            detections: [],
            processingTime: 0,
            error: error instanceof Error ? error.message : String(error)
        }
    }
})

ipcMain.handle('face-recognition:register-person', async () => {
    try {
        // For now, just return success since we're focusing on detection
        // TODO: Implement face registration when recognition service is added
        return true
    } catch {
        return false
    }
})

ipcMain.handle('face-recognition:get-persons', async () => {
    try {
        // For now, return empty array since we're focusing on detection
        // TODO: Implement person list when recognition service is added
        return []
    } catch {
        return []
    }
})

ipcMain.handle('face-recognition:remove-person', async () => {
    try {
        // For now, just return success since we're focusing on detection
        // TODO: Implement person removal when recognition service is added
        return true
    } catch {
        return false
    }
})

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
            preload: path.join(__dirname, '../../src/electron/preload.js'),
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
        mainWindow.loadFile(path.join(__dirname, '../index.html'))
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
    createWindow()
    
    // Initialize SQLite database first
    try {
        await sqliteFaceDB.initialize();
        console.log('✅ SQLite Face Database initialized successfully');
    } catch (error) {
        console.error('❌ Failed to initialize SQLite database:', error);
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
    if (scrfdService) {
        // ScrfdService doesn't need explicit disposal
    }
})