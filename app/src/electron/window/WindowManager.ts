import { BrowserWindow, dialog, shell, app } from "electron";
import path from "path";
import { fileURLToPath } from "node:url";
import isDev from "../util.js";
import { state } from "../State.js";
import { createRoundedShape } from "./windowUtils.js";
import { persistentStore } from "../persistentStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      roundedCorners: true,
      backgroundColor: "#00000000",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    const splashPath = path.join(__dirname, "../splash.html");
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
        preload: path.join(__dirname, "../preload.js"),
        webgl: true,
        zoomFactor: 1.0,
        devTools: isDev(),
      },
      titleBarStyle: "hidden",
      transparent: true,
    });

    state.mainWindow = mainWindow;

    // Load content
    if (isDev()) {
      const loadVite = () => {
        mainWindow.loadURL("http://localhost:3000").catch(() => {
          setTimeout(loadVite, 500);
        });
      };
      loadVite();
    } else {
      mainWindow.loadFile(
        path.join(__dirname, "../../../dist-react/index.html"),
      );
    }

    mainWindow.once("ready-to-show", () => {
      this.updateWindowShape(mainWindow);
    });

    mainWindow.on("maximize", () => {
      mainWindow.webContents.send("window:maximized");
      mainWindow.setResizable(false);
      if (process.platform === "win32") {
        try {
          mainWindow.setShape([]);
        } catch (error) {
          console.warn("Could not set window shape:", error);
        }
      }
    });

    mainWindow.on("unmaximize", () => {
      mainWindow.setResizable(true);
      mainWindow.webContents.send("window:unmaximized");
      this.updateWindowShape(mainWindow);
    });

    mainWindow.on("resize", () => {
      if (!mainWindow.isMaximized()) {
        this.updateWindowShape(mainWindow);
      }
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

  private static updateWindowShape(window: BrowserWindow) {
    if (process.platform === "win32") {
      try {
        const { width, height } = window.getBounds();
        window.setShape(createRoundedShape(width, height));
      } catch (error) {
        console.warn("Could not set window shape:", error);
      }
    }
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
