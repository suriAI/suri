/**
 * GitHub Release Update Checker
 * Handles version comparison and manual download prompting via GitHub Releases.
 * Designed to be non-blocking and offline-safe.
 */

import { app, shell, BrowserWindow, net } from "electron";

// GitHub repository configuration (suriAI organization)
const GITHUB_OWNER = "suriAI";
const GITHUB_REPO = "suri";
const GITHUB_RELEASES_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const GITHUB_RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

// Cache configuration
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const NETWORK_TIMEOUT_MS = 8000; // 8 seconds - fail fast if no internet
let lastCheckTime = 0;
let cachedUpdateInfo: UpdateInfo | null = null;

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseUrl: string;
  releaseNotes: string;
  publishedAt: string;
  downloadUrl: string | null;
  error?: string;
  isOffline?: boolean;
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
  assets: {
    name: string;
    browser_download_url: string;
  }[];
}

function extractSemverLikeVersion(input: string): string | null {
  const trimmed = (input || "").trim();
  if (!trimmed) return null;

  // Look for a semver-ish token anywhere in the string.
  // Examples matched: "2.0.0", "v2.0.0", "2.0.0-beta.1", "Release v2.0.0"
  const match = trimmed.match(/v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  if (!match) return null;

  return match[0].replace(/^v/, "");
}

/**
 * Parse semantic version string into comparable parts
 */
function parseVersion(version: string): number[] {
  // Remove 'v' prefix if present
  const clean = version.replace(/^v/, "");
  return clean.split(".").map((part) => parseInt(part, 10) || 0);
}

/**
 * Compare two semantic versions
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
  const partsA = parseVersion(a);
  const partsB = parseVersion(b);

  const maxLength = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLength; i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;

    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }

  return 0;
}

/**
 * Get the appropriate download asset URL for current platform
 */
function getDownloadUrl(assets: GitHubRelease["assets"]): string | null {
  const platform = process.platform;
  const patterns: Record<string, RegExp[]> = {
    win32: [/\.exe$/i, /\.msi$/i, /portable.*\.exe$/i],
    darwin: [/\.dmg$/i, /\.pkg$/i],
    linux: [/\.AppImage$/i, /\.deb$/i, /\.rpm$/i],
  };

  const platformPatterns = patterns[platform] || [];

  for (const pattern of platformPatterns) {
    const asset = assets.find((a) => pattern.test(a.name));
    if (asset) {
      return asset.browser_download_url;
    }
  }

  return null;
}

/**
 * Check if we have network connectivity
 * Uses Electron's net module for accurate online status
 */
function isOnline(): boolean {
  return net.isOnline();
}

async function fetchLatestRelease(): Promise<GitHubRelease | null> {
  if (!isOnline()) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

    const response = await fetch(GITHUB_RELEASES_URL, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": `Suri/${app.getVersion()}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 404) {
        console.log("[Updater] No releases found");
        return null;
      }
      console.log(`[Updater] GitHub API returned ${response.status}`);
      return null;
    }

    return (await response.json()) as GitHubRelease;
  } catch (error) {
    // Silently handle all errors - this is expected when offline
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        console.log(
          "[Updater] Request timed out - likely offline or slow connection",
        );
      } else {
        console.log(
          "[Updater] Network error (expected if offline):",
          error.message,
        );
      }
    }
    return null;
  }
}

export async function checkForUpdates(force = false): Promise<UpdateInfo> {
  const currentVersion = app.getVersion();
  const now = Date.now();

  if (!force && cachedUpdateInfo && now - lastCheckTime < CHECK_INTERVAL_MS) {
    return cachedUpdateInfo;
  }

  if (!isOnline()) {
    return {
      currentVersion,
      latestVersion: currentVersion,
      hasUpdate: false,
      releaseUrl: GITHUB_RELEASES_PAGE,
      releaseNotes: "",
      publishedAt: "",
      downloadUrl: null,
      isOffline: true,
    };
  }

  console.log(`[Updater] Checking for updates (current: v${currentVersion})`);

  const release = await fetchLatestRelease();

  if (!release) {
    // Network error or no releases - return gracefully
    const noUpdateInfo: UpdateInfo = {
      currentVersion,
      latestVersion: currentVersion,
      hasUpdate: false,
      releaseUrl: GITHUB_RELEASES_PAGE,
      releaseNotes: "",
      publishedAt: "",
      downloadUrl: null,
    };
    // Cache this result to avoid hammering the API
    cachedUpdateInfo = noUpdateInfo;
    lastCheckTime = now;
    return noUpdateInfo;
  }

  const latestVersion = extractSemverLikeVersion(release.tag_name);

  if (!latestVersion) {
    const unknownVersionInfo: UpdateInfo = {
      currentVersion,
      latestVersion: currentVersion,
      hasUpdate: false,
      releaseUrl: release.html_url,
      releaseNotes: release.body || "",
      publishedAt: release.published_at,
      downloadUrl: getDownloadUrl(release.assets),
      error:
        "Latest release tag did not contain a semantic version (expected something like v2.0.0)",
    };

    cachedUpdateInfo = unknownVersionInfo;
    lastCheckTime = now;
    console.log(
      `[Updater] Latest release tag has no semver (tag: ${release.tag_name})`,
    );
    return unknownVersionInfo;
  }

  const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

  const updateInfo: UpdateInfo = {
    currentVersion,
    latestVersion,
    hasUpdate,
    releaseUrl: release.html_url,
    releaseNotes: release.body || "",
    publishedAt: release.published_at,
    downloadUrl: getDownloadUrl(release.assets),
  };

  cachedUpdateInfo = updateInfo;
  lastCheckTime = now;

  console.log(
    `[Updater] Latest: v${latestVersion}, Current: v${currentVersion}, Update available: ${hasUpdate}`,
  );

  return updateInfo;
}

/**
 * Get current app version
 */
export function getCurrentVersion(): string {
  return app.getVersion();
}

/**
 * Open the GitHub releases page in the default browser
 */
export function openReleasePage(url?: string): void {
  shell.openExternal(url || GITHUB_RELEASES_PAGE);
}

/**
 * Send update notification to renderer process
 */
export function notifyRenderer(
  mainWindow: BrowserWindow | null,
  updateInfo: UpdateInfo,
): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("updater:update-available", updateInfo);
  }
}

/**
 * Background update check - runs periodically after app startup
 * This is completely non-blocking and offline-safe
 */
export async function startBackgroundUpdateCheck(
  mainWindow: BrowserWindow | null,
  delayMs = 60000, // 1 minute after startup
): Promise<void> {
  // Initial delayed check
  setTimeout(async () => {
    // Only check if online
    if (!isOnline()) {
      console.log("[Updater] Skipping background check - offline");
      return;
    }

    try {
      const updateInfo = await checkForUpdates();
      if (updateInfo.hasUpdate && !updateInfo.isOffline) {
        console.log(`[Updater] Update available: v${updateInfo.latestVersion}`);
        notifyRenderer(mainWindow, updateInfo);
      }
    } catch (error) {
      // Silently ignore all errors - update checks should never affect app
      console.log("[Updater] Background check failed (non-critical):", error);
    }
  }, delayMs);
}
