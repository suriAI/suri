import { app, BrowserWindow, ipcMain } from "electron"
import path from "path"
import isDev from "./util.js";
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'fs'

let backendProc: ChildProcessWithoutNullStreams | null = null
let videoProc: ChildProcessWithoutNullStreams | null = null
let mainWindowRef: BrowserWindow | null = null
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

function startVideo(opts?: { device?: number, annotate?: boolean }) {
    if (videoProc) return
    const pythonCmd = resolvePythonCmd()
    const args = [
        '-m',
        'src.api.video_worker',
        '--device', String(opts?.device ?? 0)
    ]
    if (opts?.annotate === false) args.push('--no-annotate')

    const cwd = path.join(app.getAppPath(), '..')
    console.log('[video] starting with args:', args)
    videoProc = spawn(pythonCmd, args, { 
        cwd, 
        env: { ...process.env }, 
        stdio: 'pipe'
    })
    console.log('[video] spawned', pythonCmd, args.join(' '))

    // Accumulate stdout buffer and emit frames via IPC
    let acc: Buffer = Buffer.alloc(0)
    let lastSent = 0
    const minIntervalMs = 1000 / 25 // throttle to ~25 fps to the renderer

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
                    const now = Date.now()
                    if (now - lastSent >= minIntervalMs) {
                        lastSent = now
                        if (mainWindowRef) {
                            // send as Buffer to avoid base64 overhead
                            mainWindowRef.webContents.send('video:frame', frame)
                        }
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
ipcMain.handle('video:stop', () => { stopVideo(); return true })
ipcMain.handle('video:pause', () => { if (videoProc) videoProc.stdin.write(JSON.stringify({ action: 'pause' }) + '\n'); return true })
ipcMain.handle('video:resume', () => { if (videoProc) videoProc.stdin.write(JSON.stringify({ action: 'resume' }) + '\n'); return true })
ipcMain.handle('video:setDevice', (_evt, device: number) => { if (videoProc) videoProc.stdin.write(JSON.stringify({ action: 'set_device', device }) + '\n'); return true })

async function preloadModels() {
    try {
        const pythonCmd = resolvePythonCmd()
        const preloadProc = spawn(pythonCmd, [
            '-c',
            'from experiments.prototype.main import yolo_sess, input_size; import numpy as np; dummy=np.zeros((480,640,3),np.uint8); yolo_sess.run(None, {"images": dummy.reshape(1,input_size,input_size,3)})'
        ], {
            cwd: path.join(app.getAppPath(), '..'),
            stdio: 'pipe'
        })
        await new Promise((resolve, reject) => {
            preloadProc.on('exit', (code) => code === 0 ? resolve(undefined) : reject(new Error(`Preload failed with code ${code}`)))
        })
        console.log('[main] Models preloaded successfully')
    } catch (e) {
        console.warn('[main] Model preload failed:', e)
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
        webPreferences: {
            contextIsolation: true,
            sandbox: false,
            nodeIntegration: false,
            preload: preloadPath
        }
    });
    mainWindowRef = mainWindow
    if (isDev()) {
        mainWindow.loadURL("http://localhost:5123");
    } else {
        mainWindow.loadFile(path.join(app.getAppPath(), "dist-react/index.html"));
    }
})

app.on('before-quit', () => {
    stopBackend()
    stopVideo()
})