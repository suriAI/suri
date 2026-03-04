import { ipcMain, dialog, BrowserWindow, app } from "electron";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { backendService } from "../backendService.js";
import { syncManager } from "../managers/BackgroundSyncManager.js";
import { state } from "../State.js";

// ── Cryptographic Constants ───────────────────────────────────────────────────
const SURI_MAGIC = Buffer.from("SURI\x00\x01"); // 6 bytes
const SALT_SIZE = 16;
const IV_SIZE = 12;
const TAG_SIZE = 16;
const KEY_SIZE = 32; // AES-256
const PBKDF2_ITERS = 480_000;
const PBKDF2_DIGEST = "sha256";

// ── Key Derivation ────────────────────────────────────────────────────────────
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(
    password,
    salt,
    PBKDF2_ITERS,
    KEY_SIZE,
    PBKDF2_DIGEST,
  );
}

// ── Encrypt plaintext Buffer → encrypted .suri blob ───────────────────────────
function encryptVault(plaintext: Buffer, password: string): Buffer {
  const salt = crypto.randomBytes(SALT_SIZE);
  const iv = crypto.randomBytes(IV_SIZE);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes

  return Buffer.concat([SURI_MAGIC, salt, iv, tag, ciphertext]);
}

// ── Decrypt .suri blob → plaintext Buffer ─────────────────────────────────────
function decryptVault(blob: Buffer, password: string): Buffer {
  const magicLen = SURI_MAGIC.length;
  const minLen = magicLen + SALT_SIZE + IV_SIZE + TAG_SIZE + 1;

  if (blob.length < minLen) {
    throw new Error("File is too short to be a valid .suri vault.");
  }

  const magic = blob.subarray(0, magicLen);
  if (!crypto.timingSafeEqual(magic, SURI_MAGIC)) {
    throw new Error(
      "Invalid file format. This file is not a Suri vault (.suri).",
    );
  }

  let offset = magicLen;
  const salt = blob.subarray(offset, offset + SALT_SIZE);
  offset += SALT_SIZE;
  const iv = blob.subarray(offset, offset + IV_SIZE);
  offset += IV_SIZE;
  const tag = blob.subarray(offset, offset + TAG_SIZE);
  offset += TAG_SIZE;
  const ciphertext = blob.subarray(offset);

  const key = deriveKey(password, salt);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error(
      "Decryption failed. The password is incorrect or the file is corrupted.",
    );
  }
}

// ── Password Prompt Window ────────────────────────────────────────────────────
async function promptPassword(
  title: string,
  label: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const preloadPath = path.join(
      app.getAppPath(),
      "out",
      "preload",
      "preload.js",
    );

    const promptWindow = new BrowserWindow({
      width: 420,
      height: 220,
      resizable: false,
      modal: true,
      parent: state.mainWindow ?? undefined,
      show: false,
      frame: false,
      backgroundColor: "#111113",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: preloadPath,
      },
    });

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
body { background: #111113; color: #e8e8e8; padding: 24px; display: flex; flex-direction: column; gap: 16px; height: 100vh; justify-content: center; }
h3 { font-size: 13px; font-weight: 600; letter-spacing: 0.05em; color: #fff; text-transform: uppercase; }
label { font-size: 11px; color: rgba(255,255,255,0.45); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 4px; display: block; }
input { width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: #fff; padding: 8px 12px; font-size: 13px; outline: none; transition: border-color 0.15s; }
input:focus { border-color: rgba(6,182,212,0.5); }
.row { display: flex; gap: 8px; margin-top: 4px; }
button { flex: 1; padding: 8px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; border: 1px solid transparent; transition: background 0.15s; }
.confirm { background: rgba(6,182,212,0.15); color: #22d3ee; border-color: rgba(6,182,212,0.3); }
.confirm:hover { background: rgba(6,182,212,0.25); }
.cancel { background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.4); border-color: rgba(255,255,255,0.08); }
.cancel:hover { background: rgba(255,255,255,0.08); }
</style>
</head>
<body>
<h3>${title.replace(/</g, "&lt;")}</h3>
<div style="display:flex;flex-direction:column;gap:4px">
  <label>${label.replace(/</g, "&lt;")}</label>
  <input type="password" id="pw" placeholder="Enter password\u2026" autofocus />
</div>
<div class="row">
  <button class="cancel" id="btnCancel">Cancel</button>
  <button class="confirm" id="btnConfirm">Confirm</button>
</div>
<script>
  const input = document.getElementById('pw');
  const btnConfirm = document.getElementById('btnConfirm');
  const btnCancel = document.getElementById('btnCancel');
  function doConfirm() { window.electronAPI.invoke('vault:password-response', input.value); }
  function doCancel() { window.electronAPI.invoke('vault:password-response', null); }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doConfirm(); if (e.key === 'Escape') doCancel(); });
  btnConfirm.addEventListener('click', doConfirm);
  btnCancel.addEventListener('click', doCancel);
  window.addEventListener('DOMContentLoaded', () => { setTimeout(() => input.focus(), 50); });
</script>
</body>
</html>`;

    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    promptWindow.loadURL(dataUrl);

    promptWindow.once("ready-to-show", () => {
      promptWindow.show();
    });

    ipcMain.handleOnce(
      "vault:password-response",
      (_event, password: string | null) => {
        if (!promptWindow.isDestroyed()) promptWindow.destroy();
        resolve(password && password.length > 0 ? password : null);
      },
    );

    promptWindow.on("closed", () => {
      try {
        ipcMain.removeHandler("vault:password-response");
      } catch {
        /* already removed — ignore */
      }
      resolve(null);
    });
  });
}

// ── IPC Registration ──────────────────────────────────────────────────────────
export function registerSyncHandlers() {
  ipcMain.handle("sync:restart-manager", () => {
    syncManager.start();
    return true;
  });

  ipcMain.handle("sync:trigger-now", async () => {
    await syncManager.performSync();
    return true;
  });

  // ── Export: full encrypted vault (.suri) ─────────────────────────────────
  ipcMain.handle("sync:export-data", async () => {
    try {
      // 1. Collect full vault payload (attendance + biometrics) from Python
      const exportUrl = `${backendService.getUrl()}/vault/export`;
      const exportRes = await fetch(exportUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(60_000),
      });

      if (!exportRes.ok) {
        const errText = await exportRes.text();
        throw new Error(
          `Vault export failed: HTTP ${exportRes.status} — ${errText}`,
        );
      }

      const vaultPayload = await exportRes.json();

      // 2. Show save dialog
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: "Save Suri Vault",
        defaultPath: `suri-vault-${new Date().toISOString().slice(0, 10)}.suri`,
        filters: [{ name: "Suri Vault", extensions: ["suri"] }],
        buttonLabel: "Save Vault",
      });

      if (canceled || !filePath) return { success: false, canceled: true };

      // 3. Ask for an encryption password
      const password = await promptPassword(
        "Set Vault Password",
        "Password (required to restore this vault)",
      );

      if (!password) return { success: false, canceled: true };

      // 4. Encrypt and write to disk
      const plaintext = Buffer.from(JSON.stringify(vaultPayload), "utf-8");
      const encrypted = encryptVault(plaintext, password);
      await fs.writeFile(filePath, encrypted);

      return { success: true, filePath };
    } catch (error) {
      console.error("[Vault] Export failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // ── Import: open .suri, decrypt, restore everything ──────────────────────
  ipcMain.handle(
    "sync:import-data",
    async (_event, overwrite: boolean = false) => {
      try {
        // 1. Open file dialog (only .suri files)
        const { canceled, filePaths } = await dialog.showOpenDialog({
          title: "Open Suri Vault",
          filters: [{ name: "Suri Vault", extensions: ["suri"] }],
          properties: ["openFile"],
          buttonLabel: "Open Vault",
        });

        if (canceled || filePaths.length === 0)
          return { success: false, canceled: true };

        // 2. Prompt for decryption password
        const password = await promptPassword(
          "Unlock Vault",
          "Enter the vault password",
        );

        if (!password) return { success: false, canceled: true };

        // 3. Read encrypted file and decrypt
        const encryptedBlob = await fs.readFile(filePaths[0]);
        let plaintext: Buffer;
        try {
          plaintext = decryptVault(encryptedBlob, password);
        } catch (decryptErr) {
          return {
            success: false,
            error:
              decryptErr instanceof Error
                ? decryptErr.message
                : "Decryption failed.",
          };
        }

        // 4. Parse vault structure
        const vaultPayload = JSON.parse(plaintext.toString("utf-8"));

        // 5. Send to Python backend for full restoration (attendance + biometrics)
        const importUrl = `${backendService.getUrl()}/vault/import`;
        const importRes = await fetch(importUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version: vaultPayload.version ?? 1,
            exported_at: vaultPayload.exported_at,
            attendance: {
              data: vaultPayload.attendance,
              overwrite_existing: overwrite,
            },
            biometrics: vaultPayload.biometrics ?? [],
          }),
          signal: AbortSignal.timeout(120_000),
        });

        if (!importRes.ok) {
          const err = await importRes.text();
          throw new Error(`Import failed: ${err}`);
        }

        const result = await importRes.json();
        return { success: true, message: result.message };
      } catch (error) {
        console.error("[Vault] Import failed:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
}
