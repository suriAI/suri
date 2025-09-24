import { app, BrowserWindow, ipcMain, protocol } from "electron"
import path from "path"
import { fileURLToPath } from 'node:url'
import isDev from "./util.js";
import { readFile } from 'fs/promises';
import { backendService, type DetectionOptions } from './backendService.js';

// Pre-loaded model buffers for better performance
const modelBuffers: Map<string, ArrayBuffer> = new Map();
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

// Backend Service Management
async function startBackend(): Promise<void> {
    try {
        await backendService.start();
        console.log('Backend service started successfully');
    } catch (error) {
        console.error('Failed to start backend service:', error);
        throw error;
    }
}

function stopBackend(): void {
    backendService.stop().catch(error => {
        console.error('Error stopping backend service:', error);
    });
}

// Face Recognition Pipeline IPC handlers
// Removed legacy face-recognition IPC; detection/recognition handled in renderer via Web Workers

// Backend Service IPC handlers for FastAPI integration
ipcMain.handle('backend:check-availability', async () => {
    try {
        return await backendService.checkAvailability();
    } catch (error) {
        return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
});

ipcMain.handle('backend:get-models', async () => {
    try {
        return await backendService.getModels();
    } catch (error) {
        throw new Error(`Failed to get models: ${error instanceof Error ? error.message : String(error)}`);
    }
});

ipcMain.handle('backend:detect-faces', async (_event, imageBase64: string, options: DetectionOptions = {}) => {
    try {
        return await backendService.detectFaces(imageBase64, options);
    } catch (error) {
        throw new Error(`Face detection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
});

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

// Pre-load all models during app startup
async function preloadModels(): Promise<void> {
  const modelNames = [
    'det_500m_kps_640.onnx',
    'edgeface-recognition.onnx', 
    'AntiSpoofing_bin_1.5_128.onnx'
  ];
  
  try {
    for (const modelName of modelNames) {
      const modelPath = isDev()
        ? path.join(__dirname, '../../public/weights', modelName)
        : path.join(process.resourcesPath, 'weights', modelName);
      
      const buffer = await readFile(modelPath);
      const arrayBuffer = new ArrayBuffer(buffer.byteLength);
      new Uint8Array(arrayBuffer).set(new Uint8Array(buffer));
      modelBuffers.set(modelName, arrayBuffer);
  
    }
    


  } catch (error) {
    console.error('❌ Failed to pre-load models:', error);
    throw error;
  }
}

// Model loading IPC handlers - now returns pre-loaded buffers
ipcMain.handle('model:load', async (_event, modelName: string) => {
  const buffer = modelBuffers.get(modelName);
  if (!buffer) {
    throw new Error(`Model ${modelName} not found in pre-loaded cache`);
  }
  return buffer;
});

// Get all pre-loaded model buffers (for worker initialization)
ipcMain.handle('models:get-all', async () => {
  const result: Record<string, ArrayBuffer> = {};
  for (const [name, buffer] of modelBuffers.entries()) {
    result[name] = buffer;
  }
  return result;
});

function createWindow(): void {
    // Create the browser window.
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webgl: true,
        },
        titleBarStyle: 'hidden',
        transparent: true
    })

    mainWindowRef = mainWindow

    // Create rounded window shape
    const createShape = (width: number, height: number) => {
        const radius = 4 // corner radius
        const shapes = []
        
        for (let y = 0; y < height; y++) {
            let startX = 0
            let endX = width

            // Top-left corner
            if (y < radius) {
                const offset = Math.ceil(radius - Math.sqrt(radius * radius - (radius - y) * (radius - y)))
                startX = offset
            }

            // Top-right corner
            if (y < radius) {
                const offset = Math.ceil(radius - Math.sqrt(radius * radius - (radius - y) * (radius - y)))
                endX = width - offset
            }

            // Bottom-left corner
            if (y >= height - radius) {
                const offset = Math.ceil(radius - Math.sqrt(radius * radius - (y - (height - radius)) * (y - (height - radius))))
                startX = offset
            }

            // Bottom-right corner
            if (y >= height - radius) {
                const offset = Math.ceil(radius - Math.sqrt(radius * radius - (y - (height - radius)) * (y - (height - radius))))
                endX = width - offset
            }

            if (endX > startX) {
                shapes.push({ x: startX, y, width: endX - startX, height: 1 })
            }
        }
        
        return shapes
    }

    // Function to update window shape
    const updateWindowShape = () => {
        if (process.platform === 'win32') {
            try {
                const { width, height } = mainWindow.getBounds()
                mainWindow.setShape(createShape(width, height))
            } catch (error) {
                console.warn('Could not set window shape:', error)
            }
        }
    }

    // Load the app
    if (isDev()) {
        mainWindow.loadURL('http://localhost:3000')
    } else {
        mainWindow.loadFile(path.join(__dirname, '../../dist-react/index.html'))
    }

    // Set rounded window shape after window is ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show()
        if (process.platform === 'win32') {
            try {
                const { width, height } = mainWindow.getBounds()
                mainWindow.setShape(createShape(width, height))
            } catch (error) {
                console.warn('Could not set window shape:', error)
            }
        }
    })

    // Handle window maximize/restore events
    mainWindow.on('maximize', () => {
        mainWindow.webContents.send('window:maximized')
        mainWindow.setResizable(false)
        // Reset shape when maximized (rectangular)
        if (process.platform === 'win32') {
            try {
                mainWindow.setShape([])
            } catch (error) {
                console.warn('Could not reset window shape:', error)
            }
        }
    })

    mainWindow.on('unmaximize', () => {
        mainWindow.setResizable(true)
        mainWindow.webContents.send('window:unmaximized')
        // Restore rounded shape when unmaximized
        setTimeout(updateWindowShape, 100)
    })
    
    // Update shape on resize
    mainWindow.on('resize', () => {
        if (!mainWindow.isMaximized()) {
            updateWindowShape()
        }
    })

    // Handle window close
    mainWindow.on('closed', () => {
        mainWindowRef = null
    })
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,  // 👈 allow fetch() to use app://
      corsEnabled: true,
      stream: true
    },
  },
]);

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
    // Register custom protocol for direct static file access
    protocol.registerFileProtocol('app', (request, callback) => {
        const url = request.url.replace('app://', ''); // Remove 'app://' prefix
        const filePath = isDev()
            ? path.join(__dirname, '../../public', url)
            : path.join(process.resourcesPath, url);
        callback(filePath);
    });
    
    createWindow()
    
    // Start backend service
    try {
        await startBackend();
        console.log('[INFO] Backend service started successfully');
    } catch (error) {
        console.error('[ERROR] Failed to start backend service:', error);
    }
    
    // Pre-load models for optimal performance
    try {
        await preloadModels();
    } catch (error) {
        console.error('[ERROR] Failed to pre-load models:', error);
    }

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
    stopBackend();
})