import { fetchWithRetry } from "../../utils/http";

export class HttpClient {
  private baseUrl: string;
  private readinessPromise: Promise<void> | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Gatekeeper: Blocks until backend is confirmed ready via IPC.
   * Prevents "Connection Refused" errors by ensuring we never call fetch() too early.
   */
  private async ensureBackendReady(): Promise<void> {
    if (this.readinessPromise) {
      return this.readinessPromise;
    }

    this.readinessPromise = (async () => {
      const maxWaitTime = 300000; // 5 minutes safety
      const checkInterval = 250;
      const startTime = Date.now();

      if (!window.electronAPI || !window.electronAPI.backend_ready) {
        console.warn(
          "[HttpClient] Electron API not found, skipping strict readiness check.",
        );
        return;
      }

      while (Date.now() - startTime < maxWaitTime) {
        try {
          const ready = await window.electronAPI.backend_ready.isReady();
          if (ready) {
            return;
          }
        } catch {
          // Ignore IPC errors
        }
        await new Promise((resolve) => setTimeout(resolve, checkInterval));
      }

      console.error("[HttpClient] Backend readiness check timed out.");
    })();

    return this.readinessPromise;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    await this.ensureBackendReady();

    const url = `${this.baseUrl}${endpoint}`;
    const method = (options.method || "GET").toUpperCase();
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    if (
      (method === "POST" || method === "PUT" || method === "PATCH") &&
      !headers["Content-Type"]
    ) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetchWithRetry(url, { ...options, headers });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const detail = (errorData as { detail?: unknown }).detail;
      const normalizedDetail =
        typeof detail === "string"
          ? detail
          : detail
            ? JSON.stringify(detail)
            : undefined;
      throw new Error(
        normalizedDetail ||
          (errorData as { error?: string }).error ||
          `HTTP ${response.status}: ${response.statusText}`,
      );
    }

    return response.json();
  }

  async get<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = params
      ? `${endpoint}?${new URLSearchParams(params).toString()}`
      : endpoint;
    return this.request<T>(url);
  }

  async post<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async put<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "PUT",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, {
      method: "DELETE",
    });
  }
}
