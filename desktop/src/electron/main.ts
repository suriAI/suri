import { app, BrowserWindow, ipcMain } from "electron"
import path from "path"
import isDev from "./util.js";
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'fs'
import { FaceRecognitionPipeline } from "../services/FaceRecognitionPipeline.js";

let backendProc: ChildProcessWithoutNullStreams | null = null
let videoProc: ChildProcessWithoutNullStreams | null = null
let mainWindowRef: BrowserWindow | null = null
let faceRecognitionPipeline: FaceRecognitionPipeline | null = null
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function resolvePythonCmd(): string {
    const possiblePythonPaths = [
        path.join(app.getAppPath(), '..', 'venv', 'Scripts', 'python.exe'), // Windows venv
        path.join(app.getAppPath(), '..', 'venv', 'bin', 'python'), // Unix venv
        'python' // System python fallback
    ]
    for (const pythonPath of possiblePythonPaths) {
        if (pythonPath !== 'python' && fs.existsSync(pythonPath)) {
            console.log('[py] Using virtual environment python:', pythonPath)
            return pythonPath
        }
    }
    return 'python'
}

function startBackend(): void {
    try {
        const args = [
            '-m', 'uvicorn',
            'src.api.api_server:app',
            '--host', '127.0.0.1',
            '--port', '8770'
        ]
        
        // Try to use virtual environment python first, fallback to system python
        const pythonCmd = resolvePythonCmd()
        
        backendProc = spawn(pythonCmd, args, {
            cwd: path.join(app.getAppPath(), '..'),
            env: { ...process.env },
            stdio: 'pipe'
        })

        backendProc.stdout.on('data', (d) => console.log('[py][out]', d.toString()))
        backendProc.stderr.on('data', (d) => console.error('[py][err]', d.toString()))
        backendProc.on('exit', (code, signal) => {
            console.log('[py] exited', { code, signal })
            backendProc = null
        })
    } catch (err) {
        console.error('[py] Failed to start backend:', err)
        backendProc = null
    }
}

function stopBackend() {
    if (!backendProc) return
    try {
        if (process.platform === 'win32') {
            // Best-effort kill on Windows
            spawn('taskkill', ['/pid', String(backendProc.pid), '/f', '/t'])
        } else {
            backendProc.kill('SIGTERM')
        }
    } catch {
        // ignore errors when stopping backend
    }
    backendProc = null
}

function startVideo(opts?: { device?: number, annotate?: boolean, fastPreview?: boolean }) {
    if (videoProc) return
    const pythonCmd = resolvePythonCmd()
    const args = [
        '-m',
        'src.api.video_worker',
        '--device', String(opts?.device ?? 0)
    ]
    if (opts?.annotate === false) args.push('--no-annotate')
    if (opts?.fastPreview === true) args.push('--fast-preview')

    const cwd = path.join(app.getAppPath(), '..')
    console.log('[video] starting with args:', args)
    videoProc = spawn(pythonCmd, args, { 
        cwd, 
        env: { ...process.env }, 
        stdio: 'pipe'
    })
    console.log('[video] spawned', pythonCmd, args.join(' '))

    // Uncapped frame handling for maximum performance
    let acc: Buffer = Buffer.alloc(0)
    let frameDropped = 0

    function handleData(chunk: Buffer) {
        const maxSize = 1024 * 1024  // 1MB should be plenty for 640x480 JPEG
        try {
            acc = Buffer.concat([acc, chunk])
            while (acc.length >= 4) {
                const len = acc.readUInt32LE(0)
                // More strict sanity check for frame size
                if (len <= 0 || len > maxSize) {
                    console.warn('[video] invalid frame length, resetting buffer', { len, bufferSize: acc.length })
                    acc = Buffer.alloc(0)
                    break
                }
                if (acc.length < 4 + len) break
                
                try {
                    // Copy to detach from the underlying accumulator memory
                    const frame = Buffer.from(acc.subarray(4, 4 + len))
                    acc = acc.subarray(4 + len)
                    
                    // Send all frames immediately - uncapped FPS
                    if (mainWindowRef) {
                        setImmediate(() => {
                            mainWindowRef?.webContents.send('video:frame', frame)
                        })
                    }
                } catch (e) {
                    console.error('[video] frame processing error:', e)
                    acc = Buffer.alloc(0)
                    break
                }
            }
            // Safety check - if buffer gets too large without finding valid frames, reset it
            if (acc.length > maxSize) {
                console.warn('[video] buffer overflow, resetting')
                acc = Buffer.alloc(0)
            }
        } catch (e) {
            console.error('[video] buffer handling error:', e)
            acc = Buffer.alloc(0)
        }
    }

    videoProc.stdout.on('data', (d: Buffer) => handleData(d))
    videoProc.stderr.on('data', (d: Buffer) => {
        const text = d.toString()
        // Forward structured events prefixed with EVT to renderer
        text.split(/\r?\n/).forEach(line => {
            if (!line) return
            if (line.startsWith('EVT ')) {
                try {
                    const evt = JSON.parse(line.slice(4))
                    if (mainWindowRef) mainWindowRef.webContents.send('video:event', evt)
                } catch (e) {
                    console.error('[video][evt-parse]', e)
                }
            } else if (line.startsWith('WS_BROADCAST ')) {
                try {
                    const wsEvent = JSON.parse(line.slice(13)) // Remove 'WS_BROADCAST ' prefix
                    if (mainWindowRef) mainWindowRef.webContents.send('websocket:broadcast', wsEvent)
                } catch (e) {
                    console.error('[video][ws-parse]', e)
                }
            } else {
                console.log('[video][err]', line)
            }
        })
    })
    videoProc.on('exit', (code, signal) => {
        console.log('[video] exited', { code, signal })
        videoProc = null
    })
}

function stopVideo() {
    if (!videoProc) return
    try {
        // attempt graceful stop via stdin control
        videoProc.stdin.write(JSON.stringify({ action: 'stop' }) + '\n')
        setTimeout(() => {
            if (!videoProc) return
            try {
                if (process.platform === 'win32') {
                    spawn('taskkill', ['/pid', String(videoProc.pid), '/f', '/t'])
                } else {
                    videoProc.kill('SIGTERM')
                }
            } catch (e) {
                console.warn('[video] forced stop error', e)
            }
        }, 500)
    } catch (e) {
        console.warn('[video] stopVideo error', e)
    }
}

// IPC bridge for renderer controls
ipcMain.handle('video:start', (_evt, opts) => { startVideo(opts); return true })
ipcMain.handle('video:start-fast', (_evt, opts) => { startVideo({...opts, fastPreview: true}); return true })
ipcMain.handle('video:stop', () => { stopVideo(); return true })
ipcMain.handle('video:pause', () => { if (videoProc) videoProc.stdin.write(JSON.stringify({ action: 'pause' }) + '\n'); return true })
ipcMain.handle('video:resume', () => { if (videoProc) videoProc.stdin.write(JSON.stringify({ action: 'resume' }) + '\n'); return true })
ipcMain.handle('video:setDevice', (_evt, device: number) => { if (videoProc) videoProc.stdin.write(JSON.stringify({ action: 'set_device', device }) + '\n'); return true })

// Face Recognition IPC Handlers
ipcMain.handle('face-recognition:initialize', async (_evt, options) => {
  try {
    if (!faceRecognitionPipeline) {
      faceRecognitionPipeline = new FaceRecognitionPipeline()
    }
    
    const weightsDir = path.join(__dirname, '../../weights')
    await faceRecognitionPipeline.initialize({
      detectionModelPath: path.join(weightsDir, 'det_500m.onnx'),
      recognitionModelPath: path.join(weightsDir, 'edgeface-recognition.onnx'),
      similarityThreshold: options?.similarityThreshold || 0.6
    })
    
    return { success: true }
  } catch (error) {
    console.error('Failed to initialize face recognition:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('face-recognition:process-frame', async (_evt, imageData) => {
  try {
    if (!faceRecognitionPipeline) {
      throw new Error('Face recognition pipeline not initialized')
    }
    
    // Process frame with minimal overhead for real-time performance
    const result = await faceRecognitionPipeline.processFrame(imageData)
    return result
  } catch (error) {
    // Reduced error logging for performance
    return { detections: [], processingTime: 0 }
  }
})

ipcMain.handle('face-recognition:register-person', async (_evt, personId, imageData, landmarks) => {
  try {
    if (!faceRecognitionPipeline) {
      throw new Error('Face recognition pipeline not initialized')
    }
    
    const success = await faceRecognitionPipeline.registerPerson(personId, imageData, landmarks)
    return success
  } catch (error) {
    console.error('Person registration error:', error)
    return false
  }
})

ipcMain.handle('face-recognition:get-persons', () => {
  if (!faceRecognitionPipeline) {
    return []
  }
  return faceRecognitionPipeline.getAllPersons()
})

ipcMain.handle('face-recognition:remove-person', (_evt, personId) => {
  if (!faceRecognitionPipeline) {
    return false
  }
  return faceRecognitionPipeline.removePerson(personId)
})

// Window control handlers
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

async function preloadModels() {
    try {
        const pythonCmd = resolvePythonCmd()
        console.log('[main] Starting comprehensive model preload...')
        
        const preloadScript = `
import sys
import os
sys.path.append('.')

print("Loading YOLO detection model...")
from experiments.prototype.main import yolo_sess, input_size, Main
print("Loading face recognition model...")
app = Main()
print("Warming up models with dummy data...")

import numpy as np
import cv2

# Warm up YOLO
dummy_img = np.zeros((480, 640, 3), dtype=np.uint8)
from experiments.prototype.main import preprocess_yolo, non_max_suppression, conf_thresh, iou_thresh
input_blob, scale, dx, dy = preprocess_yolo(dummy_img)
preds = yolo_sess.run(None, {'images': input_blob})[0]
faces = non_max_suppression(preds, conf_thresh, iou_thresh, 
                          img_shape=(480, 640), input_shape=(input_size, input_size), 
                          pad=(dx, dy), scale=scale)

# Warm up face recognition if we have a small dummy face
if len(faces) == 0:
    # Create a synthetic face region for recognition warmup
    dummy_face = np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8)
    try:
        app.identify_face_enhanced(dummy_face, 0.8, 1)
    except:
        pass  # Expected to fail, just warming up the models

print(f"Models preloaded successfully! YOLO ready, Recognition ready.")
`
        
        const preloadProc = spawn(pythonCmd, ['-c', preloadScript], {
            cwd: path.join(app.getAppPath(), '..'),
            stdio: 'pipe'
        })
        
        preloadProc.stdout.on('data', (data) => {
            console.log('[preload]', data.toString().trim())
        })
        
        preloadProc.stderr.on('data', (data) => {
            console.warn('[preload][err]', data.toString().trim())
        })
        
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                preloadProc.kill()
                reject(new Error('Preload timeout'))
            }, 30000) // 30 second timeout
            
            preloadProc.on('exit', (code) => {
                clearTimeout(timeout)
                if (code === 0) {
                    resolve(undefined)
                } else {
                    reject(new Error(`Preload failed with code ${code}`))
                }
            })
        })
        console.log('[main] ✅ Models preloaded successfully - camera should start instantly!')
    } catch (e) {
        console.warn('[main] ⚠️ Model preload failed:', e, '- camera may be slower on first start')
    }
}

app.on("ready", async () => {
    startBackend()
    await preloadModels()
	const preloadPath = path.join(__dirname, 'preload.js')
    console.log('[main] preload path:', preloadPath)
    // Diagnostics: confirm preload is loaded
    ipcMain.on('preload-ready', () => console.log('[main] preload ready'))
	const mainWindow = new BrowserWindow({
        autoHideMenuBar: true,
        frame: false,
        titleBarStyle: 'hidden',
        titleBarOverlay: false,
        transparent: true,
        width: 1200,
        height: 800,
        webPreferences: {
            contextIsolation: true,
            sandbox: false,
            nodeIntegration: false,
            preload: preloadPath
        }
    });
    mainWindowRef = mainWindow
    
    // style rounded window shape  
    const createShape = (width: number, height: number) => {
        const radius = 8 // like corner radius
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

    // Set rounded window shape after window is ready
    mainWindow.once('ready-to-show', () => {
        if (process.platform === 'win32') {
            try {
                const { width, height } = mainWindow.getBounds()
                mainWindow.setShape(createShape(width, height))
            } catch (error) {
                console.warn('Could not set window shape:', error)
            }
        }
    })
    
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

    // Window state change events
    mainWindow.on('maximize', () => {
        mainWindow.webContents.send('window:maximized')
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
    
    if (isDev()) {
        mainWindow.loadURL("http://localhost:5123");
    } else {
        mainWindow.loadFile(path.join(app.getAppPath(), "dist-react/index.html"));
    }
})

app.on('before-quit', () => {
    stopBackend()
    stopVideo()
    
    if (faceRecognitionPipeline) {
        console.log('[main] Disposing face recognition pipeline...')
        faceRecognitionPipeline.dispose()
        faceRecognitionPipeline = null
    }
})