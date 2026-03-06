import { BrowserWindow, dialog, shell, app } from "electron";
import path from "path";
import { fileURLToPath } from "node:url";
import isDev from "../util.js";
import { state } from "../State.js";
import { persistentStore } from "../persistentStore.js";

const window_filename = fileURLToPath(import.meta.url);
const window_dirname = path.dirname(window_filename);

export class WindowManager {
  static createSplashWindow(): BrowserWindow {
    const splash = new BrowserWindow({
      width: 300,
      height: 280,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      center: true,
      backgroundColor: "#00000000",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    const splashPath = isDev()
      ? path.join(app.getAppPath(), "out", "main", "splash.html")
      : path.join(window_dirname, "splash.html");
    splash.loadFile(splashPath);

    state.splashWindow = splash;
    return splash;
  }

  static destroySplash(): void {
    if (state.splashWindow && !state.splashWindow.isDestroyed()) {
      state.splashWindow.destroy();
      state.splashWindow = null;
    }
  }

  static createWindow(): void {
    const mainWindow = new BrowserWindow({
      width: 1280,
      height: 600,
      minWidth: 800,
      minHeight: 500,
      maxWidth: 3840,
      maxHeight: 2160,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(window_dirname, "../preload/preload.js"),
        webgl: true,
        zoomFactor: 1.0,
        devTools: isDev(),
      },
      titleBarStyle: "hidden",
      transparent: false,
      backgroundColor: "#000000",
    });

    state.mainWindow = mainWindow;

    // Load content
    if (isDev() && process.env.ELECTRON_RENDERER_URL) {
      mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      mainWindow.loadFile(path.join(window_dirname, "../renderer/index.html"));
    }

    mainWindow.once("ready-to-show", () => {
      // Intentionally left blank or can be removed if nothing else is inside
    });

    mainWindow.on("maximize", () => {
      mainWindow.webContents.send("window:maximized");
      mainWindow.setResizable(false);
      if (process.platform === "win32") {
        // No shape workaround needed
      }
    });

    mainWindow.on("unmaximize", () => {
      mainWindow.setResizable(true);
      mainWindow.webContents.send("window:unmaximized");
    });

    let isHandlingClose = false;
    mainWindow.on("close", (event) => {
      if (state.isQuitting) return;
      if (isHandlingClose) {
        event.preventDefault();
        return;
      }

      event.preventDefault();

      const dismissed = Boolean(
        persistentStore.get("ui.closeToTrayNoticeDismissed"),
      );
      if (dismissed) {
        mainWindow.minimize();
        mainWindow.setSkipTaskbar(true);
        return;
      }

      isHandlingClose = true;
      void dialog
        .showMessageBox(mainWindow, {
          type: "info",
          title: "Suri is running in the background",
          message: "Suri will keep running in your system tray.",
          detail:
            "You can fully close the app by right-clicking the tray icon and selecting 'Quit'.",
          buttons: ["Got it", "Quit Suri"],
          defaultId: 0,
          cancelId: 0,
          checkboxLabel: "Don't show this reminder again",
          checkboxChecked: false,
          noLink: true,
        })
        .then(({ response, checkboxChecked }) => {
          if (checkboxChecked) {
            persistentStore.set("ui.closeToTrayNoticeDismissed", true);
          }

          if (response === 1) {
            state.isQuitting = true;
            app.quit();
            return;
          }

          mainWindow.minimize();
          mainWindow.setSkipTaskbar(true);
        })
        .finally(() => {
          isHandlingClose = false;
        });
    });

    mainWindow.on("closed", () => {
      state.mainWindow = null;
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("http"))
        shell.openExternal(url).catch((err) => {
          console.warn("Failed to open external URL:", err);
        });
      return { action: "deny" };
    });
  }

  static showMainWindow(): void {
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.setZoomLevel(0);
      state.mainWindow.show();
      state.mainWindow.focus();
      if (process.platform === "win32") {
        try {
          state.mainWindow.moveTop();
        } catch (error) {
          console.warn("Could not move window to top:", error);
        }
      }
    }
  }
}
