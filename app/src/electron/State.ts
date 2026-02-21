import { BrowserWindow, Tray } from "electron";

export const state = {
  mainWindow: null as BrowserWindow | null,
  splashWindow: null as BrowserWindow | null,
  tray: null as Tray | null,
  isQuitting: false,
};
