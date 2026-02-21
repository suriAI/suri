import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // Generic IPC invoke method
  invoke: (channel: string, ...args: unknown[]) => {
    return ipcRenderer.invoke(channel, ...args);
  },
  // Backend readiness check (models are loaded on server side)
  backend_ready: {
    isReady: () => {
      return ipcRenderer.invoke("backend:is-ready");
    },
  },
  backend: {
    checkAvailability: () => {
      return ipcRenderer.invoke("backend:check-availability");
    },
    checkReadiness: () => {
      return ipcRenderer.invoke("backend:check-readiness");
    },
    getModels: () => {
      return ipcRenderer.invoke("backend:get-models");
    },
    detectFaces: (
      imageBase64: string,
      options?: {
        model_type?: string;
        confidence_threshold?: number;
        nms_threshold?: number;
      },
    ) => {
      return ipcRenderer.invoke("backend:detect-faces", imageBase64, options);
    },
    // Face recognition APIs
    recognizeFace: (
      imageData: string,
      bbox: number[],
      groupId: string,
      landmarks_5: number[][],
      enableLivenessDetection: boolean,
    ) => {
      return ipcRenderer.invoke(
        "backend:recognize-face",
        imageData,
        bbox,
        groupId,
        landmarks_5,
        enableLivenessDetection,
      );
    },
    registerFace: (
      imageData: string,
      personId: string,
      bbox: number[],
      groupId: string,
      landmarks_5: number[][],
      enableLivenessDetection: boolean,
    ) => {
      return ipcRenderer.invoke(
        "backend:register-face",
        imageData,
        personId,
        bbox,
        groupId,
        landmarks_5,
        enableLivenessDetection,
      );
    },
    getFaceStats: () => {
      return ipcRenderer.invoke("backend:get-face-stats");
    },
    removePerson: (personId: string) => {
      return ipcRenderer.invoke("backend:remove-person", personId);
    },
    updatePerson: (oldPersonId: string, newPersonId: string) => {
      return ipcRenderer.invoke(
        "backend:update-person",
        oldPersonId,
        newPersonId,
      );
    },
    getAllPersons: () => {
      return ipcRenderer.invoke("backend:get-all-persons");
    },
    setThreshold: (threshold: number) => {
      return ipcRenderer.invoke("backend:set-threshold", threshold);
    },
    clearDatabase: () => {
      return ipcRenderer.invoke("backend:clear-database");
    },
  },
  store: {
    get: (key: string) => {
      return ipcRenderer.invoke("store:get", key);
    },
    set: (key: string, value: unknown) => {
      return ipcRenderer.invoke("store:set", key, value);
    },
    delete: (key: string) => {
      return ipcRenderer.invoke("store:delete", key);
    },
    getAll: () => {
      return ipcRenderer.invoke("store:getAll");
    },
    reset: () => {
      return ipcRenderer.invoke("store:reset");
    },
  },
  updater: {
    checkForUpdates: (force?: boolean) => {
      return ipcRenderer.invoke("updater:check-for-updates", force);
    },
    getVersion: () => {
      return ipcRenderer.invoke("updater:get-version");
    },
    openReleasePage: (url?: string) => {
      return ipcRenderer.invoke("updater:open-release-page", url);
    },
    onUpdateAvailable: (
      callback: (updateInfo: {
        currentVersion: string;
        latestVersion: string;
        hasUpdate: boolean;
        releaseUrl: string;
        releaseNotes: string;
        publishedAt: string;
        downloadUrl: string | null;
      }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        updateInfo: Parameters<typeof callback>[0],
      ) => callback(updateInfo);
      ipcRenderer.on("updater:update-available", listener);
      return () =>
        ipcRenderer.removeListener("updater:update-available", listener);
    },
  },

  assets: {
    listRecognitionSounds: () => {
      return ipcRenderer.invoke("assets:list-recognition-sounds");
    },
  },

  sync: {
    exportData: () => {
      return ipcRenderer.invoke("sync:export-data");
    },
    importData: (overwrite: boolean = false) => {
      return ipcRenderer.invoke("sync:import-data", overwrite);
    },
    restartManager: () => {
      return ipcRenderer.invoke("sync:restart-manager");
    },
    triggerNow: () => {
      return ipcRenderer.invoke("sync:trigger-now");
    },
  },
});

contextBridge.exposeInMainWorld("suriElectron", {
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  onMaximize: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("window:maximized", listener);
    return () => ipcRenderer.removeListener("window:maximized", listener);
  },
  onUnmaximize: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("window:unmaximized", listener);
    return () => ipcRenderer.removeListener("window:unmaximized", listener);
  },
  onMinimize: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("window:minimized", listener);
    return () => ipcRenderer.removeListener("window:minimized", listener);
  },
  onRestore: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("window:restored", listener);
    return () => ipcRenderer.removeListener("window:restored", listener);
  },
  getSystemStats: () => ipcRenderer.invoke("system:get-stats"),
  // Shorthand for getting current app version
  getVersion: () => ipcRenderer.invoke("updater:get-version"),
});
