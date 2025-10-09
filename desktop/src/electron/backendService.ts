/**
 * Backend Service Manager for PyInstaller-built Suri Backend
 * Handles process lifecycle, health checks, and communication
 */

import { spawn, ChildProcess } from 'child_process';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { fileURLToPath } from 'node:url';
import isDev from './util.js';

const sleep = promisify(setTimeout);

export interface BackendConfig {
  port: number;
  host: string;
  timeout: number;
  maxRetries: number;
  healthCheckInterval: number;
}

export interface BackendStatus {
  isRunning: boolean;
  port: number;
  pid?: number;
  startTime?: Date;
  lastHealthCheck?: Date;
  error?: string;
}

export interface ModelInfo {
  model_name?: string;
  model_path: string;
  input_size: number[] | [number, number];
  conf_threshold?: number;
  nms_threshold?: number;
  top_k?: number;
  backend_id?: number;
  target_id?: number;
  embedding_dimension?: number;
  similarity_threshold?: number;
  providers?: string[];
  description?: string;
  version?: string;
  supported_formats?: string[];
  requires_landmarks?: boolean;
  landmark_count?: number;
}

export interface ModelEntry {
  available: boolean;
  info?: ModelInfo;
}

export interface ModelsResponse {
  models: {
    yunet?: ModelEntry;
    antispoofing?: ModelEntry;
    optimized_antispoofing?: ModelEntry;
    edgeface?: ModelEntry;
  };
}

export interface DetectionOptions {
  model_type?: string;
  confidence_threshold?: number;
  nms_threshold?: number;
}

export interface DetectionResponse {
  faces: Array<{
    bbox: [number, number, number, number];
    confidence: number;
    landmarks: number[][];
    landmarks_468?: number[][]; // FaceMesh 468 landmarks for frontend visualization
  }>;
  model_used: string;
  processing_time: number;
}

export class BackendService {
  private process: ChildProcess | null = null;
  private config: BackendConfig;
  private status: BackendStatus;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private startupPromise: Promise<void> | null = null;

  constructor(config: Partial<BackendConfig> = {}) {
    this.config = {
      port: 8700, 
      host: '127.0.0.1',
      timeout: 30000,
      maxRetries: 3,
      healthCheckInterval: 10000,
      ...config
    };

    this.status = {
      isRunning: false,
      port: this.config.port
    };
  }

  /**
   * Get the path to the backend executable
   */
  private getBackendExecutablePath(): string {
    if (isDev()) {
      // In development, use Python script
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const serverDir = path.join(currentDir, '..', '..', '..', 'server');
      return path.join(serverDir, 'run.py');
    } else {
      // In production, use PyInstaller executable
      const platform = process.platform;
      const executableName = platform === 'win32' ? 'suri-backend.exe' : 'suri-backend';
      
      // Try multiple possible locations
      const possiblePaths = [
        path.join(process.resourcesPath, 'server', executableName),
        path.join(process.resourcesPath, executableName),
        path.join(app.getAppPath(), 'server', executableName),
        path.join(app.getAppPath(), 'resources', 'server', executableName),
      ];

      for (const execPath of possiblePaths) {
        if (fs.existsSync(execPath)) {
          return execPath;
        }
      }

      throw new Error(`Server executable not found. Searched paths: ${possiblePaths.join(', ')}`);
    }
  }

  /**
   * Check if backend is responding to health checks
   */
  private async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`http://${this.config.host}:${this.config.port}/`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      
      const isHealthy = response.ok;
      if (isHealthy) {
        this.status.lastHealthCheck = new Date();
      }
      
      return isHealthy;
    } catch {
      return false;
    }
  }

  /**
   * Start the backend process
   */
  async start(): Promise<void> {
    if (this.startupPromise) {
      return this.startupPromise;
    }

    this.startupPromise = this._start();
    return this.startupPromise;
  }

  private async _start(): Promise<void> {
    if (this.status.isRunning) {
      return;
    }


    try {
      const executablePath = this.getBackendExecutablePath();

      // Prepare command and arguments
      let command: string;
      let args: string[];

      if (isDev()) {
        // Development mode - use Python
        command = 'python';
        args = [executablePath, '--port', this.config.port.toString(), '--host', this.config.host];
      } else {
        // Production mode - use PyInstaller executable
        command = executablePath;
        args = ['--port', this.config.port.toString(), '--host', this.config.host];
      }

      // Spawn the process
      console.log(`[BackendService] Starting backend with command: ${command} ${args.join(' ')}`);
      this.process = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false,
        windowsHide: false, // Show console window for debugging
      });

      // Set up process event handlers
      this.setupProcessHandlers();

      // Wait for the backend to be ready
      await this.waitForBackendReady();

      this.status.isRunning = true;
      this.status.pid = this.process.pid;
      this.status.startTime = new Date();
      this.status.error = undefined;

      console.log(`[BackendService] Backend started successfully! PID: ${this.process.pid}, Port: ${this.config.port}`);

      // Start health monitoring
      this.startHealthMonitoring();


    } catch (error) {
      console.error(`[BackendService] Failed to start backend: ${error}`);
      this.status.error = error instanceof Error ? error.message : String(error);
      this.cleanup();
      throw error;
    } finally {
      this.startupPromise = null;
    }
  }

  /**
   * Set up process event handlers
   */
  private setupProcessHandlers(): void {
    if (!this.process) return;

    this.process.stdout?.on('data', (data) => {
      console.log('[Backend]', data.toString().trim());
    });

    this.process.stderr?.on('data', (data) => {
      console.error('[Backend Error]', data.toString().trim());
    });

    this.process.on('error', (error) => {
      this.status.error = error.message;
      this.status.isRunning = false;
    });

    this.process.on('exit', () => {
      this.status.isRunning = false;
      this.cleanup();
    });
  }

  /**
   * Wait for backend to be ready by checking health endpoint
   */
  private async waitForBackendReady(): Promise<void> {
    const startTime = Date.now();
    const timeout = this.config.timeout;

    while (Date.now() - startTime < timeout) {
      if (await this.healthCheck()) {
        return;
      }
      await sleep(1000);
    }

    throw new Error(`Backend failed to start within ${timeout}ms`);
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(async () => {
      if (this.status.isRunning) {
        const isHealthy = await this.healthCheck();
        if (!isHealthy) {
          this.status.isRunning = false;
        }
      }
    }, this.config.healthCheckInterval);
  }

  /**
   * Stop the backend process
   */
  async stop(): Promise<void> {

    this.cleanup();

    if (this.process) {
      // Try graceful shutdown first
      this.process.kill('SIGTERM');

      // Wait a bit for graceful shutdown
      await sleep(2000);

      // Force kill if still running
      if (this.process && !this.process.killed) {
        this.process.kill('SIGKILL');
      }

      this.process = null;
    }

    this.status.isRunning = false;
    this.status.pid = undefined;
    this.status.error = undefined;

  }

  /**
   * Restart the backend process
   */
  async restart(): Promise<void> {
    await this.stop();
    await sleep(1000);
    await this.start();
  }

  /**
   * Get current backend status
   */
  getStatus(): BackendStatus {
    return { ...this.status };
  }

  /**
   * Check if backend is available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.status.isRunning) {
      return false;
    }
    return await this.healthCheck();
  }

  /**
   * Get backend URL
   */
  getUrl(): string {
    return `http://${this.config.host}:${this.config.port}`;
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Check backend availability for IPC
   */
  async checkAvailability(): Promise<{ available: boolean; status?: number; error?: string }> {
    try {
      if (!this.status.isRunning) {
        return { available: false, error: 'Backend service not started' };
      }

      const response = await fetch(`${this.getUrl()}/`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });

      return { available: response.ok, status: response.status };
    } catch (error) {
      return { 
        available: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * Check if backend is fully ready for face recognition (models loaded)
   */
  async checkReadiness(): Promise<{ ready: boolean; modelsLoaded: boolean; error?: string }> {
    try {
      if (!this.status.isRunning) {
        return { ready: false, modelsLoaded: false, error: 'Backend service not started' };
      }

      // First check basic availability
      const healthResponse = await fetch(`${this.getUrl()}/`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });

      if (!healthResponse.ok) {
        return { ready: false, modelsLoaded: false, error: 'Backend health check failed' };
      }

      // Then check if models are loaded and ready
      const modelsResponse = await fetch(`${this.getUrl()}/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000)
      });

      if (!modelsResponse.ok) {
        return { ready: false, modelsLoaded: false, error: 'Models endpoint not available' };
      }

      const modelsData: ModelsResponse = await modelsResponse.json();
      
      // Check if critical models for face recognition are available
      const yunetAvailable = modelsData.models.yunet?.available || false;
      const edgefaceAvailable = modelsData.models.edgeface?.available || false;
      
      const modelsLoaded = yunetAvailable && edgefaceAvailable;
      
      return { 
        ready: modelsLoaded, 
        modelsLoaded,
        error: modelsLoaded ? undefined : 'Face recognition models not fully loaded'
      };
    } catch (error) {
      return { 
        ready: false, 
        modelsLoaded: false,
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * Get available models from backend
   */
  async getModels(): Promise<ModelsResponse> {
    const response = await fetch(`${this.getUrl()}/models`, {
      method: 'GET',
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Detect faces using backend API
   */
  async detectFaces(imageBase64: string, options: DetectionOptions = {}): Promise<DetectionResponse> {
    const request = {
      image: imageBase64,
      model_type: options.model_type || 'yunet',
      confidence_threshold: options.confidence_threshold || 0.5,
      nms_threshold: options.nms_threshold || 0.3
    };

    const response = await fetch(`${this.getUrl()}/detect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Clean up on app exit
   */
  async dispose(): Promise<void> {
    await this.stop();
  }
}

// Singleton instance
export const backendService = new BackendService();