// src/devac/web/frontend/lib/api/client.ts

import type {
  Service,
  ServiceDetails,
  HealthCheckResponse,
  ServiceActionResponse,
  SSEStats,
  APIError,
} from "./types.js";

/**
 * API client configuration
 */
export interface APIClientConfig {
  baseURL: string;
  timeout?: number;
}

/**
 * API client for DevAC backend
 */
export class APIClient {
  private baseURL: string;
  private timeout: number;

  constructor(config: APIClientConfig) {
    this.baseURL = config.baseURL;
    this.timeout = config.timeout || 30000;
  }

  /**
   * Make a fetch request with error handling
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error: APIError = await response.json().catch(() => ({
          error: response.statusText,
          message: `HTTP ${response.status}`,
        }));

        throw new Error(error.message || error.error);
      }

      return response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === "AbortError") {
        throw new Error("Request timeout");
      }

      throw error;
    }
  }

  /**
   * Health check
   */
  async health(): Promise<HealthCheckResponse> {
    return this.request<HealthCheckResponse>("/health");
  }

  /**
   * List all services
   */
  async listServices(): Promise<Service[]> {
    return this.request<Service[]>("/api/services");
  }

  /**
   * Get service details
   */
  async getService(serviceId: string): Promise<ServiceDetails> {
    return this.request<ServiceDetails>(`/api/services/${serviceId}`);
  }

  /**
   * Start a service
   */
  async startService(serviceId: string): Promise<ServiceActionResponse> {
    return this.request<ServiceActionResponse>(`/api/services/${serviceId}/start`, {
      method: "POST",
    });
  }

  /**
   * Stop a service
   */
  async stopService(
    serviceId: string,
    graceful = true
  ): Promise<ServiceActionResponse> {
    return this.request<ServiceActionResponse>(`/api/services/${serviceId}/stop`, {
      method: "POST",
      body: JSON.stringify({ graceful }),
    });
  }

  /**
   * Restart a service
   */
  async restartService(
    serviceId: string,
    graceful = true
  ): Promise<ServiceActionResponse> {
    return this.request<ServiceActionResponse>(
      `/api/services/${serviceId}/restart`,
      {
        method: "POST",
        body: JSON.stringify({ graceful }),
      }
    );
  }

  /**
   * Get service health
   */
  async getServiceHealth(serviceId: string): Promise<{
    serviceId: string;
    health: string;
    status: string;
    lastError?: {
      message: string;
      timestamp: string;
      stack?: string;
    };
    timestamp: string;
  }> {
    return this.request(`/api/services/${serviceId}/health`);
  }

  /**
   * Get SSE statistics
   */
  async getSSEStats(): Promise<SSEStats> {
    return this.request<SSEStats>("/api/events/stats");
  }

  /**
   * Get SSE event source URL
   */
  getSSEURL(): string {
    return `${this.baseURL}/api/events`;
  }
}

/**
 * Create API client instance
 */
export function createAPIClient(config: APIClientConfig): APIClient {
  return new APIClient(config);
}

/**
 * Default API client (assumes backend on same host, port 3000)
 */
export const apiClient = createAPIClient({
  baseURL: typeof window !== "undefined"
    ? `http://${window.location.hostname}:3000`
    : "http://localhost:3000",
});
