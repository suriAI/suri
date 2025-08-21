import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('suriVideo', {
    start: async (opts?: { device?: number; width?: number; height?: number; fps?: number; annotate?: boolean }) => {
        return ipcRenderer.invoke('video:start', opts)
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
    }
})

// Signal to main that preload is ready
ipcRenderer.send('preload-ready')
