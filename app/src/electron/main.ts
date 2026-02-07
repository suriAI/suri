import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  shell,
  Tray,
  Menu,
  nativeImage,
} from "electron";
import path from "path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import isDev from "./util.js";
import { backendService, type DetectionOptions } from "./backendService.js";
import { persistentStore } from "./persistentStore.js";
import {
  checkForUpdates,
  getCurrentVersion,
  openReleasePage,
  startBackgroundUpdateCheck,
} from "./updater.js";
// Set consistent app name across all platforms for userData directory
app.setName("Suri");

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Show a message before quitting to explain why it's closing (useful for dev)
  console.warn("[Main] Another instance is already running. Quitting...");
  app.quit();
  process.exit(0);
}

// Handle second instance attempts - focus existing window
app.on("second-instance", () => {
  if (mainWindowRef) {
    // Restore window if minimized
    if (mainWindowRef.isMinimized()) {
      mainWindowRef.restore();
    }
    // Show and focus the existing window
    mainWindowRef.show();
    mainWindowRef.focus();
  }
});

// Dynamic GPU configuration - works on both old and new hardware
// Enable modern GPU features for capable hardware, graceful fallback for old GPUs

// Always try modern GPU features first (for new laptops)
app.commandLine.appendSwitch("enable-features", "Vulkan,UseSkiaRenderer");
app.commandLine.appendSwitch("enable-webgl");
app.commandLine.appendSwitch("enable-webgl2-compute-context");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");

// Add graceful fallback options for old hardware
app.commandLine.appendSwitch("enable-unsafe-swiftshader"); // Software WebGL fallback
app.commandLine.appendSwitch("use-gl", "any"); // Try any available GL implementation

// Platform-specific optimizations
if (process.platform === "win32") {
  app.commandLine.appendSwitch("use-angle", "default"); // Let ANGLE choose best backend
}

let mainWindowRef: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create a lightweight splash window for instant visual feedback
 * Shows immediately while backend and main window load in parallel
 */
function createSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 300,
    height: 280,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    center: true,
    roundedCorners: true,
    backgroundColor: "#00000000", // Fully transparent for rounded effect
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const splashPath = path.join(__dirname, "splash.html");
  splash.loadFile(splashPath);

  return splash;
}

/**
 * Destroy splash window safely
 */
function destroySplash(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.destroy();
    splashWindow = null;
  }
}

/**
 * Show main window with proper initialization
 */
function showMainWindow(): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    // Disable zooming
    mainWindowRef.webContents.setZoomLevel(0);
    mainWindowRef.webContents.setZoomFactor(1.0);

    mainWindowRef.show();
    mainWindowRef.focus();

    if (process.platform === "win32") {
      try {
        mainWindowRef.moveTop();
      } catch (error) {
        console.warn("Could not move window to top:", error);
      }
    }

    // Create tray icon if it doesn't exist
    if (!tray) {
      createTray();
    }
  }
}

// Backend Service Management
async function startBackend(): Promise<void> {
  try {
    await backendService.start();
  } catch (error) {
    console.error("Failed to start backend service:", error);
    throw error;
  }
}

// Face Recognition Pipeline IPC handlers
// Detection handled via Binary WebSocket; recognition/registration via IPC

// Backend Service IPC handlers for FastAPI integration
ipcMain.handle("backend:check-availability", async () => {
  try {
    return await backendService.checkAvailability();
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("backend:check-readiness", async () => {
  try {
    return await backendService.checkReadiness();
  } catch (error) {
    return {
      ready: false,
      modelsLoaded: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("backend:get-models", async () => {
  try {
    return await backendService.getModels();
  } catch (error) {
    throw new Error(
      `Failed to get models: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
});

ipcMain.handle(
  "backend:detect-faces",
  async (_event, imageBase64: string, options: DetectionOptions = {}) => {
    try {
      return await backendService.detectFaces(imageBase64, options);
    } catch (error) {
      throw new Error(
        `Face detection failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
);

// Face recognition via IPC
ipcMain.handle(
  "backend:recognize-face",
  async (
    _event,
    imageData: string,
    bbox: number[],
    groupId: string,
    landmarks_5: number[][],
    enableLivenessDetection: boolean,
  ) => {
    try {
      const url = `${backendService.getUrl()}/face/recognize`;

      const requestBody = {
        image: imageData,
        bbox: bbox,
        group_id: groupId,
        landmarks_5: landmarks_5,
        enable_liveness_detection: enableLivenessDetection,
      };

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Face recognition failed:", error);
      return {
        success: false,
        person_id: null,
        similarity: 0.0,
        processing_time: 0.0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
);

// Face registration via IPC
ipcMain.handle(
  "backend:register-face",
  async (
    _event,
    imageData: string,
    personId: string,
    bbox: number[],
    groupId: string,
    landmarks_5: number[][],
    enableLivenessDetection: boolean,
  ) => {
    try {
      const url = `${backendService.getUrl()}/face/register`;

      const requestBody = {
        image: imageData,
        person_id: personId,
        bbox: bbox,
        group_id: groupId,
        landmarks_5: landmarks_5,
        enable_liveness_detection: enableLivenessDetection,
      };

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Face registration failed:", error);
      return {
        success: false,
        person_id: personId,
        total_persons: 0,
        processing_time: 0.0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
);

// Get face database stats via IPC
ipcMain.handle("backend:get-face-stats", async () => {
  try {
    const url = `${backendService.getUrl()}/face/stats`;

    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Get face stats failed:", error);
    throw error;
  }
});

// Remove person via IPC
ipcMain.handle("backend:remove-person", async (_event, personId: string) => {
  try {
    const url = `${backendService.getUrl()}/face/person/${encodeURIComponent(personId)}`;

    const response = await fetch(url, {
      method: "DELETE",
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Remove person failed:", error);
    throw error;
  }
});

// Update person via IPC
ipcMain.handle(
  "backend:update-person",
  async (_event, oldPersonId: string, newPersonId: string) => {
    try {
      const url = `${backendService.getUrl()}/face/person`;

      const requestBody = {
        old_person_id: oldPersonId,
        new_person_id: newPersonId,
      };

      const response = await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Update person failed:", error);
      throw error;
    }
  },
);

// Get all persons via IPC
ipcMain.handle("backend:get-all-persons", async () => {
  try {
    const url = `${backendService.getUrl()}/face/persons`;

    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Get all persons failed:", error);
    throw error;
  }
});

// Set similarity threshold via IPC
ipcMain.handle("backend:set-threshold", async (_event, threshold: number) => {
  try {
    const url = `${backendService.getUrl()}/face/threshold`;

    const requestBody = {
      threshold: threshold,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Set threshold failed:", error);
    throw error;
  }
});

// Clear face database via IPC
ipcMain.handle("backend:clear-database", async () => {
  try {
    const url = `${backendService.getUrl()}/face/database`;

    const response = await fetch(url, {
      method: "DELETE",
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Clear database failed:", error);
    throw error;
  }
});

// Window control IPC handlers
ipcMain.handle("window:minimize", () => {
  if (mainWindowRef) mainWindowRef.minimize();
  return true;
});

ipcMain.handle("window:maximize", () => {
  if (mainWindowRef) {
    if (mainWindowRef.isMaximized()) {
      mainWindowRef.unmaximize();
    } else {
      mainWindowRef.maximize();
    }
  }
  return true;
});

ipcMain.handle("window:close", () => {
  if (mainWindowRef) mainWindowRef.close();
  return true;
});

// =============================================================================
// STORE IPC HANDLERS
// =============================================================================

// Get persistent settings value
ipcMain.handle("store:get", (_event, key: string) => {
  return persistentStore.get(key);
});

// Set persistent settings value
ipcMain.handle("store:set", (_event, key: string, value: unknown) => {
  persistentStore.set(key, value);
  return true;
});

// Delete persistent settings value
ipcMain.handle("store:delete", (_event, key: string) => {
  // electron-store supports dot notation paths (e.g., "ui.sidebarCollapsed")
  // Type assertion needed because IPC passes string, but store expects typed key
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (persistentStore.delete as any)(key);
  return true;
});

// Get all persistent settings data
ipcMain.handle("store:getAll", () => {
  return persistentStore.store;
});

// Reset persistent settings to defaults
ipcMain.handle("store:reset", () => {
  persistentStore.clear();
  return true;
});

// =============================================================================
// ASSETS IPC HANDLERS
// =============================================================================

ipcMain.handle("assets:list-recognition-sounds", async () => {
  const soundsDir = isDev()
    ? path.join(__dirname, "../../public/assets/sounds")
    : path.join(__dirname, "../../dist-react/assets/sounds");

  try {
    const entries = await fs.readdir(soundsDir, { withFileTypes: true });
    const allowedExt = new Set([".mp3", ".wav", ".ogg", ".m4a"]);

    const files = entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((name) => allowedExt.has(path.extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b));

    return files.map((fileName) => {
      // URL served by Vite (dev) or relative to index.html (prod)
      // Use relative path (./assets/...) so it works with file:// protocol
      const url = `./assets/sounds/${encodeURIComponent(fileName)}`;
      return { fileName, url };
    });
  } catch {
    return [];
  }
});

// System Stats IPC Handler
ipcMain.handle("system:get-stats", () => {
  const cpu = process.getCPUUsage();
  const memory = process.getSystemMemoryInfo();

  return {
    cpu: cpu.percentCPUUsage,
    memory: {
      total: memory.total,
      free: memory.free,
      // approximate application usage (RSS)
      appUsage: process.memoryUsage().rss,
    },
  };
});

// Check if backend server is ready
// All AI models are loaded on the server side, not in Electron
ipcMain.handle("backend:is-ready", async () => {
  try {
    // Add timeout to prevent hanging
    const timeoutPromise = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), 5000);
    });

    const readinessPromise = backendService.checkReadiness().then((result) => {
      return result.ready && result.modelsLoaded;
    });

    return await Promise.race([readinessPromise, timeoutPromise]);
  } catch (error) {
    console.error("[Main] Backend readiness check error:", error);
    return false;
  }
});

// =============================================================================
// UPDATE CHECKER IPC HANDLERS
// =============================================================================

// Check for updates (manual or automatic)
ipcMain.handle("updater:check-for-updates", async (_event, force?: boolean) => {
  try {
    return await checkForUpdates(force);
  } catch (error) {
    console.error("[Main] Update check failed:", error);
    return {
      currentVersion: getCurrentVersion(),
      latestVersion: getCurrentVersion(),
      hasUpdate: false,
      releaseUrl: "",
      releaseNotes: "",
      publishedAt: "",
      downloadUrl: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// Get current app version
ipcMain.handle("updater:get-version", () => {
  return getCurrentVersion();
});

// Open release page in browser
ipcMain.handle("updater:open-release-page", (_event, url?: string) => {
  openReleasePage(url);
  return true;
});

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 600,
    minWidth: 800,
    minHeight: 500,
    maxWidth: 3840, // 4K width limit
    maxHeight: 2160, // 4K height limit
    show: false, // Prevent flash, show after ready
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      webgl: true,
      // Disable zooming
      zoomFactor: 1.0,
      // Disable DevTools in production
      devTools: isDev(),
    },
    titleBarStyle: "hidden",
    transparent: true,
  });

  mainWindowRef = mainWindow;

  // Create rounded window shape
  const createShape = (width: number, height: number) => {
    const radius = 4; // corner radius
    const shapes = [];

    for (let y = 0; y < height; y++) {
      let startX = 0;
      let endX = width;

      // Top-left corner
      if (y < radius) {
        const offset = Math.ceil(
          radius - Math.sqrt(radius * radius - (radius - y) * (radius - y)),
        );
        startX = offset;
      }

      // Top-right corner
      if (y < radius) {
        const offset = Math.ceil(
          radius - Math.sqrt(radius * radius - (radius - y) * (radius - y)),
        );
        endX = width - offset;
      }

      // Bottom-left corner
      if (y >= height - radius) {
        const offset = Math.ceil(
          radius -
          Math.sqrt(
            radius * radius -
            (y - (height - radius)) * (y - (height - radius)),
          ),
        );
        startX = offset;
      }

      // Bottom-right corner
      if (y >= height - radius) {
        const offset = Math.ceil(
          radius -
          Math.sqrt(
            radius * radius -
            (y - (height - radius)) * (y - (height - radius)),
          ),
        );
        endX = width - offset;
      }

      if (endX > startX) {
        shapes.push({ x: startX, y, width: endX - startX, height: 1 });
      }
    }

    return shapes;
  };

  // Function to update window shape
  const updateWindowShape = () => {
    if (process.platform === "win32") {
      try {
        const { width, height } = mainWindow.getBounds();
        mainWindow.setShape(createShape(width, height));
      } catch (error) {
        console.warn("Could not set window shape:", error);
      }
    }
  };

  // Load the app
  if (isDev()) {
    // Retry loading URL until Vite is ready prevents white screen/crash
    const loadVite = () => {
      mainWindow.loadURL("http://localhost:3000").catch(() => {
        console.log("Waiting for Vite server...");
        setTimeout(loadVite, 500);
      });
    };
    loadVite();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist-react/index.html"));
  }

  // Set rounded window shape after window is ready
  // NOTE: We don't auto-show here anymore - splash coordinator handles this
  mainWindow.once("ready-to-show", () => {
    if (process.platform === "win32") {
      try {
        const { width, height } = mainWindow.getBounds();
        mainWindow.setShape(createShape(width, height));
      } catch (error) {
        console.warn("Could not set window shape:", error);
      }
    }
  });

  // Handle window maximize/restore events
  mainWindow.on("maximize", () => {
    mainWindow.webContents.send("window:maximized");
    mainWindow.setResizable(false);
    // Reset shape when maximized (rectangular)
    if (process.platform === "win32") {
      try {
        mainWindow.setShape([]);
      } catch (error) {
        console.warn("Could not reset window shape:", error);
      }
    }
  });

  mainWindow.on("unmaximize", () => {
    mainWindow.setResizable(true);
    mainWindow.webContents.send("window:unmaximized");
    // Restore rounded shape when unmaximized
    updateWindowShape();
  });

  // Handle minimize/restore for auto-pause tracking
  mainWindow.on("minimize", () => {
    mainWindow.webContents.send("window:minimized");
  });

  mainWindow.on("restore", () => {
    mainWindow.webContents.send("window:restored");
  });

  // Update shape on resize
  mainWindow.on("resize", () => {
    if (!mainWindow.isMaximized()) {
      updateWindowShape();
    }
  });

  // Disable zooming via keyboard shortcuts
  mainWindow.webContents.on("before-input-event", (event, input) => {
    // Disable Ctrl+Plus, Ctrl+Minus, Ctrl+0 (zoom shortcuts)
    if (
      input.control &&
      (input.key === "=" || input.key === "-" || input.key === "0")
    ) {
      event.preventDefault();
    }
    // Disable Ctrl+Mouse wheel zoom
    if (input.control && input.type === "mouseWheel") {
      event.preventDefault();
    }
  });

  // PRODUCTION SECURITY: Disable Default Menu
  if (!isDev()) {
    // Remove default menu (File, Edit, etc.)
    mainWindow.setMenu(null);
  }

  // Handle renderer process crash or reload
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.log("[Main] Renderer process gone:", details.reason);
    // WebSocket connections will be automatically closed when renderer process dies
  });

  // Handle navigation
  mainWindow.webContents.on("did-start-navigation", (_event, navigationUrl) => {
    if (navigationUrl && navigationUrl !== mainWindow.webContents.getURL()) {
      console.log("[Main] Navigation started to:", navigationUrl);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url).catch(() => { });
    }

    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowedPrefixes = isDev()
      ? ["http://localhost:3000", "http://127.0.0.1:3000"]
      : ["file://", "app://"];

    const isAllowed = allowedPrefixes.some((prefix) => url.startsWith(prefix));
    if (!isAllowed) {
      event.preventDefault();
      if (url.startsWith("http://") || url.startsWith("https://")) {
        shell.openExternal(url).catch(() => { });
      }
    }
  });

  // Handle window close (Minimize to Tray)
  // First close shows an informational prompt so users don't think the app is "stuck".
  let isHandlingClose = false;
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    if (isHandlingClose) {
      event.preventDefault();
      return false;
    }

    event.preventDefault();

    // Ensure tray exists so the app is discoverable after closing
    if (!tray) {
      createTray();
    }

    const dismissed = Boolean(
      persistentStore.get("ui.closeToTrayNoticeDismissed"),
    );
    if (dismissed) {
      mainWindow.minimize();
      mainWindow.setSkipTaskbar(true);
      return false;
    }

    isHandlingClose = true;
    void dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Suri is still running",
        message: "Closing Suri keeps it running in the system tray.",
        detail: "To fully quit, use the tray icon menu and choose Quit Suri.",
        buttons: ["OK", "Quit Suri"],
        defaultId: 0,
        cancelId: 0,
        checkboxLabel: "Don't show this again",
        checkboxChecked: false,
        noLink: true,
      })
      .then(({ response, checkboxChecked }) => {
        if (checkboxChecked) {
          persistentStore.set("ui.closeToTrayNoticeDismissed", true);
        }

        if (response === 1) {
          isQuitting = true;
          app.quit();
          return;
        }

        mainWindow.minimize();
        mainWindow.setSkipTaskbar(true);
      })
      .finally(() => {
        isHandlingClose = false;
      });

    return false;
  });

  // Handle window closed
  mainWindow.on("closed", () => {
    mainWindowRef = null;
  });
}

function createTray() {
  const iconPath = isDev()
    ? path.join(__dirname, "../../public/icons/suri_mark_logo_transparent.png")
    : path.join(process.resourcesPath, "icons/suri_mark_logo_transparent.png"); // Adjust for prod

  // Fallback for icon if specific one missing, though checking dev path above.
  // Ideally we use a known good path. Let's assume the public folder structure is preserved in dist or resources.
  // Actually, in prod, resources are usually in `resources` folder or `dist-react` if copied there.
  // Let's stick to a safe bet: if dev, public/icons. If prod, likely in resources or we can use app.getAppPath().

  let image;
  try {
    image = nativeImage.createFromPath(iconPath);
  } catch (e) {
    console.warn("Failed to load tray icon", e);
    return;
  }

  tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.setToolTip("Suri");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Quit Suri",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    if (!mainWindowRef) return;

    // Smart Toggle Logic (Discord-like)
    // We use minimized state + skipTaskbar to emulate "Close to Tray"
    const isVisible = mainWindowRef.isVisible();
    const isMinimized = mainWindowRef.isMinimized();
    const isFocused = mainWindowRef.isFocused();

    if (isMinimized || !isVisible) {
      // Restore from tray/minimized state
      if (isMinimized) mainWindowRef.restore();
      else mainWindowRef.show();

      mainWindowRef.setSkipTaskbar(false);
      mainWindowRef.focus();
      return;
    }

    // It is visible and fully open
    if (isFocused) {
      // Minimize to tray if actively focused
      mainWindowRef.minimize();
      mainWindowRef.setSkipTaskbar(true);
    } else {
      // Just bring to front if obscured
      mainWindowRef.focus();
    }
  });
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true, // 👈 allow fetch() to use app://
      corsEnabled: true,
      stream: true,
    },
  },
]);

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Register custom protocol for direct static file access
  protocol.registerFileProtocol("app", (request, callback) => {
    const url = request.url.replace("app://", ""); // Remove 'app://' prefix
    const relativeUrl = url.replace(/^\/+/, "");

    let baseDir: string;
    if (isDev()) {
      baseDir = path.join(__dirname, "../../public");
    } else {
      // In production, use app.getAppPath() which correctly resolves to the asar location
      const appPath = app.getAppPath();
      baseDir = path.join(appPath, "dist-react");
    }

    const resolvedBaseDir = path.resolve(baseDir);
    const resolvedFilePath = path.resolve(resolvedBaseDir, relativeUrl);

    if (
      resolvedFilePath !== resolvedBaseDir &&
      !resolvedFilePath.startsWith(resolvedBaseDir + path.sep)
    ) {
      callback({ error: -6 });
      return;
    }

    callback({ path: resolvedFilePath });
  });

  // =========================================================================
  // DISCORD-STYLE FAST STARTUP
  // 1. Show splash immediately (sub-50ms visual feedback)
  // 2. Start backend and main window loading in PARALLEL
  // 3. Transition to main window when both are ready
  // =========================================================================

  // Show splash immediately (no minimize-all-windows behavior)
  splashWindow = createSplashWindow();

  // Start parallel loading

  // Promise 1: Backend startup AND models ready (can take 3-30s)
  const backendPromise = (async () => {
    try {
      await startBackend();

      // Now wait for models to be fully loaded
      // This ensures React won't show a loading screen
      const maxWaitTime = 120000; // 2 minutes max
      const pollInterval = 500;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitTime) {
        try {
          const readiness = await backendService.checkReadiness();
          if (readiness.ready && readiness.modelsLoaded) {
            return true;
          }
        } catch {
          // Keep trying
        }
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      console.warn("[Main] Models did not load in time");
      return true;
    } catch (error) {
      console.error("[ERROR] Failed to start backend service:", error);
      return false;
    }
  })();

  // Promise 2: Main window ready (React bundle load)
  const windowPromise = new Promise<void>((resolve) => {
    createWindow();
    if (mainWindowRef) {
      mainWindowRef.once("ready-to-show", () => {
        resolve();
      });
    } else {
      resolve();
    }
  });

  // Wait for BOTH to complete
  await Promise.all([backendPromise, windowPromise]);

  // Smooth transition: destroy splash, show main
  destroySplash();
  showMainWindow();

  // Start background update check (1 minute after startup, non-blocking)
  if (!isDev()) {
    startBackgroundUpdateCheck(mainWindowRef, 60000);
  }

  app.on("activate", function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      // In activate context, show immediately since splash is long gone
      if (mainWindowRef) {
        mainWindowRef.once("ready-to-show", () => {
          showMainWindow();
        });
      }
    } else if (mainWindowRef && !mainWindowRef.isVisible()) {
      // Show and focus window if it exists but is hidden
      mainWindowRef.show();
      mainWindowRef.focus();
    }
  });
});

// =============================================================================
// BACKEND CLEANUP MANAGEMENT
// Simplified cleanup that matches backend signal handling
// =============================================================================

/**
 * Cleanup backend - synchronous kill that blocks until complete
 * Backend handles SIGTERM gracefully now, so this is clean
 */
function cleanupBackend(): void {
  if (isQuitting) return;
  isQuitting = true;

  console.log("[Main] Stopping backend...");
  backendService.killSync(); // Sends taskkill, backend handles gracefully
  console.log("[Main] Backend stopped");
}

// Primary handler: Before quit (covers window close + menu quit + Alt+F4)
app.on("before-quit", (event) => {
  if (!isQuitting) {
    console.log("[Main] App quitting - cleanup backend...");
    event.preventDefault();

    cleanupBackend();

    // Allow quit after cleanup
    setImmediate(() => app.exit(0));
  }
});
