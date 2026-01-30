/**
 * Copy static Electron assets (HTML, images) to dist-electron
 * This is needed because TypeScript only compiles .ts files
 */

const fs = require("fs");
const path = require("path");

const srcElectronDir = path.join(__dirname, "..", "src", "electron");
const srcIconsDir = path.join(__dirname, "..", "public", "icons");
const destDir = path.join(__dirname, "..", "dist-electron", "electron");

// Electron source files to copy
const electronFiles = ["splash.html", "splash.css"];

// Icon files needed for splash
const iconFiles = ["suri_primary_emblem_transparent.png"];

// Ensure destination directory exists
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

// Copy electron files
for (const file of electronFiles) {
  const srcPath = path.join(srcElectronDir, file);
  const destPath = path.join(destDir, file);

  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
  } else {
    console.warn(`⚠️  Not found: ${srcPath}`);
  }
}

// Copy icon files
for (const file of iconFiles) {
  const srcPath = path.join(srcIconsDir, file);
  const destPath = path.join(destDir, file);

  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
  } else {
    console.warn(`⚠️  Icon not found: ${srcPath}`);
  }
}
