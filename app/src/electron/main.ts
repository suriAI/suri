import { app, protocol, BrowserWindow } from "electron";
import path from "path";
import { fileURLToPath } from "node:url";
import { backendService } from "./backendService.js";
import { startBackgroundUpdateCheck } from "./updater.js";
import isDev from "./util.js";
import { state } from "./State.js";
// This file provides geometric window shape utilities for rounded corners on Windows.
import { WindowManager } from "./window/WindowManager.js";
import { TrayManager } from "./tray/TrayManager.js";
import { registerAllHandlers } from "./ipc/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.setName("Suri");

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.warn("[Main] Another instance is already running. Quitting...");
  app.quit();
  process.exit(0);
}

app.on("second-instance", () => {
  if (state.mainWindow) {
    if (state.mainWindow.isMinimized()) state.mainWindow.restore();
    state.mainWindow.show();
    state.mainWindow.focus();
  }
});

// GPU Optimizations
app.commandLine.appendSwitch("enable-features", "Vulkan,UseSkiaRenderer");
app.commandLine.appendSwitch("enable-webgl");
app.commandLine.appendSwitch("enable-webgl2-compute-context");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("enable-unsafe-swiftshader");
app.commandLine.appendSwitch("use-gl", "any");

if (process.platform === "win32") {
  app.commandLine.appendSwitch("use-angle", "default");
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// =============================================================================
// APP LIFECYCLE
// =============================================================================

app.whenReady().then(async () => {
  registerAllHandlers();

  // Custom protocol for static file access
  protocol.registerFileProtocol("app", (request, callback) => {
    const url = request.url.replace("app://", "");
    const relativeUrl = url.replace(/^\/+/, "");

    let baseDir: string;
    if (isDev()) {
      baseDir = path.join(__dirname, "../../public");
    } else {
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

  WindowManager.createSplashWindow();

  const backendPromise = (async () => {
    try {
      await backendService.start();

      const maxWaitTime = 120000;
      const pollInterval = 1000;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitTime) {
        const readiness = await backendService.checkReadiness();
        if (readiness.ready) return true;
        await new Promise((r) => setTimeout(r, pollInterval));
      }

      throw new Error("Backend synchronization timed out.");
    } catch (e) {
      console.error("[Main] Backend fail:", e);
      const { dialog } = await import("electron");
      await dialog.showMessageBox({
        type: "error",
        title: "SURI Startup Error",
        message: "Failed to start background services.",
        detail:
          e instanceof Error
            ? e.message
            : "An unknown error occurred during backend startup.",
        buttons: ["Retry", "Quit"],
      });
      return false;
    }
  })();

  const windowPromise = new Promise<void>((resolve) => {
    WindowManager.createWindow();
    state.mainWindow?.once("ready-to-show", () => resolve());
  });

  await Promise.all([backendPromise, windowPromise]);

  WindowManager.destroySplash();
  WindowManager.showMainWindow();
  TrayManager.createTray();

  if (!isDev()) {
    startBackgroundUpdateCheck(state.mainWindow, 60000);
  }
});

function cleanup() {
  if (state.isQuitting) return;
  state.isQuitting = true;
  console.log("[Main] Stopping backend...");
  backendService.killSync();
}

app.on("before-quit", (event) => {
  if (!state.isQuitting) {
    event.preventDefault();
    cleanup();
    setImmediate(() => app.exit(0));
  }
});

app.on("activate", () => {
  if (state.mainWindow === null) {
    WindowManager.createWindow();
    const win = state.mainWindow as BrowserWindow | null;
    win?.once("ready-to-show", () => WindowManager.showMainWindow());
  } else if (state.mainWindow && !state.mainWindow.isVisible()) {
    state.mainWindow.show();
  }
});
