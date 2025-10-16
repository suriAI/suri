import { app, BrowserWindow, ipcMain, protocol } from "electron"
import { execSync } from "child_process"
import path from "path"
import { fileURLToPath } from 'node:url'
import isDev from "./util.js";
import { backendService, type DetectionOptions } from './backendService.js';
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

// Enable logging for debugging (commented out GPU error suppression)
// app.commandLine.appendSwitch('disable-logging')
// app.commandLine.appendSwitch('log-level', '3') // Only show fatal errors

let mainWindowRef: BrowserWindow | null = null
// Removed legacy scrfdService usage
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Backend Service Management
async function startBackend(): Promise<void> {
    try {
        await backendService.start();
    } catch (error) {
        console.error('Failed to start backend service:', error);
        throw error;
    }
}

// Face Recognition Pipeline IPC handlers
// Detection handled via Binary WebSocket; recognition/registration via IPC

// Backend Service IPC handlers for FastAPI integration
ipcMain.handle('backend:check-availability', async () => {
    try {
        return await backendService.checkAvailability();
    } catch (error) {
        return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
});

ipcMain.handle('backend:check-readiness', async () => {
    try {
        return await backendService.checkReadiness();
    } catch (error) {
        return { ready: false, modelsLoaded: false, error: error instanceof Error ? error.message : String(error) };
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

// Face recognition via IPC
ipcMain.handle('backend:recognize-face', async (_event, imageData: string, bbox: number[], groupId?: string) => {
    try {
        const url = `${backendService.getUrl()}/face/recognize`;
        
        const requestBody = {
            image: imageData,
            bbox: bbox,
            group_id: groupId
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(30000)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Face recognition failed:', error);
        return {
            success: false,
            person_id: null,
            similarity: 0.0,
            processing_time: 0,
            error: error instanceof Error ? error.message : String(error)
        };
    }
});

// Face registration via IPC
ipcMain.handle('backend:register-face', async (_event, imageData: string, personId: string, bbox: number[], groupId?: string) => {
    try {
        const url = `${backendService.getUrl()}/face/register`;
        
        const requestBody = {
            image: imageData,
            person_id: personId,
            bbox: bbox,
            group_id: groupId
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(30000)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Face registration failed:', error);
        return {
            success: false,
            person_id: personId,
            total_persons: 0,
            processing_time: 0,
            error: error instanceof Error ? error.message : String(error)
        };
    }
});

// Get face database stats via IPC
ipcMain.handle('backend:get-face-stats', async () => {
    try {
        const url = `${backendService.getUrl()}/face/stats`;
        
        const response = await fetch(url, {
            method: 'GET',
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Get face stats failed:', error);
        throw error;
    }
});

// Remove person via IPC
ipcMain.handle('backend:remove-person', async (_event, personId: string) => {
    try {
        const url = `${backendService.getUrl()}/face/person/${encodeURIComponent(personId)}`;
        
        const response = await fetch(url, {
            method: 'DELETE',
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Remove person failed:', error);
        throw error;
    }
});

// Update person via IPC
ipcMain.handle('backend:update-person', async (_event, oldPersonId: string, newPersonId: string) => {
    try {
        const url = `${backendService.getUrl()}/face/person`;
        
        const requestBody = {
            old_person_id: oldPersonId,
            new_person_id: newPersonId
        };

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Update person failed:', error);
        throw error;
    }
});

// Get all persons via IPC
ipcMain.handle('backend:get-all-persons', async () => {
    try {
        const url = `${backendService.getUrl()}/face/persons`;
        
        const response = await fetch(url, {
            method: 'GET',
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Get all persons failed:', error);
        throw error;
    }
});

// Set similarity threshold via IPC
ipcMain.handle('backend:set-threshold', async (_event, threshold: number) => {
    try {
        const url = `${backendService.getUrl()}/face/threshold`;
        
        const requestBody = {
            threshold: threshold
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Set threshold failed:', error);
        throw error;
    }
});

// Clear face database via IPC
ipcMain.handle('backend:clear-database', async () => {
    try {
        const url = `${backendService.getUrl()}/face/database`;
        
        const response = await fetch(url, {
            method: 'DELETE',
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Clear database failed:', error);
        throw error;
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

// Check if backend server is ready
// All AI models are loaded on the server side, not in Electron
ipcMain.handle('backend:is-ready', async () => {
  const result = await backendService.checkReadiness();
  return result.ready && result.modelsLoaded;
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
    
    // Start backend service (models are loaded on the server side)
    console.log('[Main] Starting backend service...');
    try {
        await startBackend();
        console.log('[Main] Backend service started successfully!');
    } catch (error) {
        console.error('[ERROR] Failed to start backend service:', error);
    }

    app.on('activate', function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

// =============================================================================
// BACKEND CLEANUP MANAGEMENT
// Simplified cleanup that matches backend signal handling
// =============================================================================

let isQuitting = false;

/**
 * Cleanup backend - synchronous kill that blocks until complete
 * Backend handles SIGTERM gracefully now, so this is clean
 */
function cleanupBackend(): void {
    if (isQuitting) return;
    isQuitting = true;
    
    console.log('[Main] 🛑 Stopping backend...');
    backendService.killSync(); // Sends taskkill, backend handles gracefully
    console.log('[Main] ✅ Backend stopped');
}

// Primary handler: Before quit (covers window close + menu quit + Alt+F4)
app.on('before-quit', (event) => {
    if (!isQuitting) {
        console.log('[Main] App quitting - cleanup backend...');
        event.preventDefault();
        
        cleanupBackend();
        
        // Allow quit after cleanup
        setImmediate(() => app.exit(0));
    }
});

// Failsafe: Process exit (synchronous emergency cleanup)
process.on('exit', (code) => {
    console.log(`[Main] Process exiting (code ${code})`);
    
    // Emergency kill if backend still running
    if (!isQuitting) {
        try {
            if (process.platform === 'win32') {
                execSync('taskkill /F /IM suri-backend.exe /T', { stdio: 'ignore', timeout: 2000 });
            } else {
                execSync('pkill -9 suri-backend', { stdio: 'ignore', timeout: 2000 });
            }
        } catch {
            // Already stopped - OK
        }
    }
});