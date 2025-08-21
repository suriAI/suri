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

function startVideoWorker() {
    const args = [
        'src.api.video_worker',
    ]
    
    const pythonCmd = resolvePythonCmd()
    
    videoProc = spawn(pythonCmd, ['-m', ...args], {
        cwd: path.join(app.getAppPath(), '..'),
        env: { ...process.env },
        stdio: 'pipe'
    })
    videoProc.stdout.on('data', (data) => {
        try {
            const str = data.toString().trim()
            if (!str) return
            
            const lines = str.split('\n')
            for (const line of lines) {
                if (!line.trim()) continue
                try {
                    const msg = JSON.parse(line)
                    if (msg.type === 'frame' && mainWindowRef) {
                        mainWindowRef.webContents.send('video:frame', msg.data)
                    } else if (mainWindowRef) {
                        mainWindowRef.webContents.send('video:event', msg)
                    }
                } catch {
                    // Not a JSON message, log as plain text
                    console.log('[video][out]', line)
                }
            }
        } catch (e) {
            console.error('[video] stdout parse error:', e)
        }
    })
    videoProc.stderr.on('data', (d) => console.error('[video][err]', d.toString()))
    videoProc.on('exit', (code, signal) => {
        console.log('[video] exited', { code, signal })
        videoProc = null
    })
}

function startBackend() {
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
        '-m', 'src.api.video_worker',
        '--device', String(opts?.device ?? 0),
    ]
    if (opts?.annotate === false) args.push('--no-annotate')

    const cwd = path.join(app.getAppPath(), '..')
    videoProc = spawn(pythonCmd, args, { cwd, env: { ...process.env, SURI_LAZY_MODELS: '1' }, stdio: 'pipe' })
    console.log('[video] spawned', pythonCmd, args.join(' '))

    // Accumulate stdout buffer and emit frames via IPC
    let acc: Buffer = Buffer.alloc(0)
    let lastSent = 0
    const minIntervalMs = 1000 / 25 // throttle to ~25 fps to the renderer

    function handleData(chunk: Buffer) {
        acc = Buffer.concat([acc, chunk])
        while (acc.length >= 4) {
            const len = acc.readUInt32LE(0)
            // sanity guard: drop absurd sizes
            if (len <= 0 || len > 10 * 1024 * 1024) { // >10MB is suspicious for 640x480 JPEG
                console.warn('[video] invalid frame length, resetting buffer', len)
                acc = Buffer.alloc(0)
                break
            }
            if (acc.length < 4 + len) break
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

app.on("ready", () => {
    startBackend()
    startVideoWorker()
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