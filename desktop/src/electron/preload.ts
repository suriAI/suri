import { contextBridge, ipcRenderer } from "electron";

// Backend API
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
  // Backend Service API
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
      options?: { threshold?: number; max_faces?: number },
    ) => {
      return ipcRenderer.invoke("backend:detect-faces", imageBase64, options);
    },
    // Face recognition APIs
    recognizeFace: (
      imageData: string,
      bbox: number[],
      groupId?: string,
      landmarks_5?: number[][],
      enableLivenessDetection?: boolean,
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
      groupId?: string,
      enableLivenessDetection?: boolean,
    ) => {
      return ipcRenderer.invoke(
        "backend:register-face",
        imageData,
        personId,
        bbox,
        groupId,
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
  // Store API
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
});

// Window control functions
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
});
