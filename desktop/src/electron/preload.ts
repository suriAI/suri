import { contextBridge, ipcRenderer } from 'electron'

// Type definitions
interface FaceLogEntry {
    id?: string;
    timestamp: string;
    personId: string | null;
    confidence: number;
    bbox: [number, number, number, number];
    similarity?: number;
    mode: 'auto' | 'manual';
}

// Face Log Database API
contextBridge.exposeInMainWorld('electronAPI', {
    logDetection: (detection: FaceLogEntry) => {
        return ipcRenderer.invoke('face-db:log-detection', detection)
    },
    getRecentLogs: (limit?: number) => {
        return ipcRenderer.invoke('face-db:get-recent-logs', limit)
    },
    getTodayStats: () => {
        return ipcRenderer.invoke('face-db:get-today-stats')
    },
    exportData: (filePath: string) => {
        return ipcRenderer.invoke('face-db:export-data', filePath)
    },
    clearOldData: (daysToKeep: number) => {
        return ipcRenderer.invoke('face-db:clear-old-data', daysToKeep)
    },
    // Person Management API
    getAllPeople: () => {
        return ipcRenderer.invoke('face-db:get-all-people')
    },
    getPersonLogs: (personId: string, limit?: number) => {
        return ipcRenderer.invoke('face-db:get-person-logs', personId, limit)
    },
    updatePersonId: (oldPersonId: string, newPersonId: string) => {
        return ipcRenderer.invoke('face-db:update-person-id', oldPersonId, newPersonId)
    },
    deletePersonRecords: (personId: string) => {
        return ipcRenderer.invoke('face-db:delete-person', personId)
    },
    getPersonStats: (personId: string) => {
        return ipcRenderer.invoke('face-db:get-person-stats', personId)
    },
    // Face Recognition Database API (File-based)
    saveFaceDatabase: (databaseData: Record<string, number[]>) => {
        return ipcRenderer.invoke('face-recognition:save-database', databaseData)
    },
    loadFaceDatabase: () => {
        return ipcRenderer.invoke('face-recognition:load-database')
    },
    removeFacePerson: (personId: string) => {
        return ipcRenderer.invoke('face-recognition:remove-person', personId)
    },
    getAllFacePersons: () => {
        return ipcRenderer.invoke('face-recognition:get-all-persons')
    },
    // Generic IPC invoke method
    invoke: (channel: string, ...args: unknown[]) => {
        return ipcRenderer.invoke(channel, ...args)
    },
    // Backend Service API
    backend: {
        checkAvailability: () => {
            return ipcRenderer.invoke('backend:check-availability')
        },
        getModels: () => {
            return ipcRenderer.invoke('backend:get-models')
        },
        detectFaces: (imageBase64: string, options?: { threshold?: number; max_faces?: number }) => {
            return ipcRenderer.invoke('backend:detect-faces', imageBase64, options)
        }
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