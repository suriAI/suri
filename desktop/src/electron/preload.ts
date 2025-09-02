import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('suriVideo', {
    start: async (opts?: { device?: number; width?: number; height?: number; fps?: number; annotate?: boolean }) => {
        return ipcRenderer.invoke('video:start', opts)
    },
    startFast: async (opts?: { device?: number; width?: number; height?: number; fps?: number; annotate?: boolean }) => {
        return ipcRenderer.invoke('video:start-fast', opts)
    },
    stop: async () => {
        return ipcRenderer.invoke('video:stop')
    },
    pause: async () => {
        return ipcRenderer.invoke('video:pause')
    },
    resume: async () => {
        return ipcRenderer.invoke('video:resume')
    },
    setDevice: async (device: number) => {
        return ipcRenderer.invoke('video:setDevice', device)
    },
    onFrame: (handler: (buf: ArrayBuffer | Uint8Array) => void) => {
        const listener = (_: Electron.IpcRendererEvent, data: ArrayBuffer | Uint8Array) => handler(data)
        ipcRenderer.on('video:frame', listener)
        return () => {
            ipcRenderer.removeListener('video:frame', listener)
        }
    },
    onEvent: (handler: (evt: Record<string, unknown>) => void) => {
        const listener = (_: Electron.IpcRendererEvent, data: Record<string, unknown>) => handler(data)
        ipcRenderer.on('video:event', listener)
        return () => {
            ipcRenderer.removeListener('video:event', listener)
        }
    },
    onWebSocketBroadcast: (handler: (evt: Record<string, unknown>) => void) => {
        const listener = (_: Electron.IpcRendererEvent, data: Record<string, unknown>) => handler(data)
        ipcRenderer.on('websocket:broadcast', listener)
        return () => {
            ipcRenderer.removeListener('websocket:broadcast', listener)
        }
    }
})

// Face Recognition API
contextBridge.exposeInMainWorld('electronAPI', {
    initializeFaceRecognition: (options?: { similarityThreshold?: number }) => {
        return ipcRenderer.invoke('face-recognition:initialize', options)
    },
    processFrame: (imageData: ImageData) => {
        return ipcRenderer.invoke('face-recognition:process-frame', imageData)
    },
    registerPerson: (personId: string, imageData: ImageData, landmarks: number[][]) => {
        return ipcRenderer.invoke('face-recognition:register-person', personId, imageData, landmarks)
    },
    getAllPersons: () => {
        return ipcRenderer.invoke('face-recognition:get-persons')
    },
    removePerson: (personId: string) => {
        return ipcRenderer.invoke('face-recognition:remove-person', personId)
    }
})

// Window control functions
contextBridge.exposeInMainWorld('suriElectron', {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    onMaximize: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('window:maximized', listener)
        return () => ipcRenderer.removeListener('window:maximized', listener)
    },
    onUnmaximize: (callback: () => void) => {
        const listener = () => callback()
        ipcRenderer.on('window:unmaximized', listener)
        return () => ipcRenderer.removeListener('window:unmaximized', listener)
    }
})

// WebSocket client for real-time communication
let ws: WebSocket | null = null
let messageHandlers: ((msg: Record<string, unknown>) => void)[] = []

contextBridge.exposeInMainWorld('suriWS', {
    connect: async (url: string = 'ws://127.0.0.1:8770/ws') => {
        if (ws) {
            ws.close()
        }
        
        return new Promise<void>((resolve, reject) => {
            ws = new WebSocket(url)
            
            ws.onopen = () => {
                console.log('[ws] Connected to backend')
                resolve()
            }
            
            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data)
                    messageHandlers.forEach(handler => handler(msg))
                } catch (error) {
                    console.error('[ws] Failed to parse message:', error)
                }
            }
            
            ws.onerror = (error) => {
                console.error('[ws] WebSocket error:', error)
                // Don't reject on error, let it try to connect
                // The error might be temporary
            }
            
            ws.onclose = (event) => {
                console.log('[ws] WebSocket closed:', event.code, event.reason)
                ws = null
            }
        })
    },
    
    send: (msg: unknown) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg))
        }
    },
    
    sendRequest: async (action: string, payload?: unknown, timeoutMs: number = 5000) => {
        return new Promise((resolve, reject) => {
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket not connected'))
                return
            }
            
            const requestId = Date.now().toString()
            const request = { id: requestId, action, payload }
            
            const timeout = setTimeout(() => {
                reject(new Error('Request timeout'))
            }, timeoutMs)
            
            const responseHandler = (msg: Record<string, unknown>) => {
                if (msg.id === requestId) {
                    clearTimeout(timeout)
                    resolve(msg)
                }
            }
            
            messageHandlers.push(responseHandler)
            ws.send(JSON.stringify(request))
        })
    },
    
    onMessage: (handler: (msg: Record<string, unknown>) => void) => {
        messageHandlers.push(handler)
        return () => {
            const index = messageHandlers.indexOf(handler)
            if (index > -1) {
                messageHandlers.splice(index, 1)
            }
        }
    },
    
    close: () => {
        if (ws) {
            ws.close()
            ws = null
        }
        messageHandlers = []
    }
})


