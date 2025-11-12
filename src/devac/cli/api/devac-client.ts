// src/devac/cli/api/devac-client.ts

import type { CommandError } from "../../services/command-based-service.js";

/**
 * Service metadata response from DevAC API
 */
export interface ServiceMetadata {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  status: "idle" | "starting" | "running" | "stopping" | "stopped" | "error";
  health: "healthy" | "degraded" | "unhealthy" | "unknown";
  stats: {
    successCount: number;
    failureCount: number;
    lastRunDuration?: number;
    lastRunTimestamp?: string;
  };
  lastError?: {
    message: string;
    timestamp: string;
    stack?: string;
  };
  version: string;
}

/**
 * Service details response from DevAC API
 */
export interface ServiceDetails extends ServiceMetadata {
  config: Record<string, any>;
}

/**
 * Service status with errors
 */
export interface ServiceStatusWithErrors extends ServiceMetadata {
  errors?: CommandError[];
  warnings?: CommandError[];
}

/**
 * Overall system status
 */
export interface SystemStatus {
  services: ServiceMetadata[];
  summary: {
    total: number;
    running: number;
    stopped: number;
    error: number;
    healthy: number;
    unhealthy: number;
  };
  hasErrors: boolean;
  hasWarnings: boolean;
}

/**
 * DevAC API client for CLI commands
 *
 * Communicates with the DevAC web server to retrieve status information
 * and control services.
 */
export class DevACClient {
  private baseUrl: string;
  private timeout: number;

  constructor(baseUrl: string = "http://localhost:3000", timeout: number = 5000) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.timeout = timeout;
  }

  /**
   * Check if DevAC server is running
   */
  async isServerRunning(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/api/services`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get all services
   */
  async getServices(): Promise<ServiceMetadata[]> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/api/services`);

    if (!response.ok) {
      throw new Error(`Failed to fetch services: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Get service details
   */
  async getServiceDetails(serviceId: string): Promise<ServiceDetails> {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/api/services/${serviceId}`,
    );

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Service not found: ${serviceId}`);
      }
      throw new Error(
        `Failed to fetch service details: ${response.statusText}`,
      );
    }

    return await response.json();
  }

  /**
   * Get service health
   */
  async getServiceHealth(serviceId: string): Promise<{
    serviceId: string;
    health: string;
    status: string;
    lastError?: any;
    timestamp: string;
  }> {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/api/services/${serviceId}/health`,
    );

    // 503 is acceptable for unhealthy services
    if (!response.ok && response.status !== 503) {
      throw new Error(
        `Failed to fetch service health: ${response.statusText}`,
      );
    }

    return await response.json();
  }

  /**
   * Start a service
   */
  async startService(serviceId: string): Promise<void> {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/api/services/${serviceId}/start`,
      {
        method: "POST",
      },
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.message || `Failed to start service: ${response.statusText}`,
      );
    }
  }

  /**
   * Stop a service
   */
  async stopService(
    serviceId: string,
    graceful: boolean = true,
  ): Promise<void> {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/api/services/${serviceId}/stop`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ graceful }),
      },
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.message || `Failed to stop service: ${response.statusText}`,
      );
    }
  }

  /**
   * Restart a service
   */
  async restartService(
    serviceId: string,
    graceful: boolean = true,
  ): Promise<void> {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/api/services/${serviceId}/restart`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ graceful }),
      },
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.message || `Failed to restart service: ${response.statusText}`,
      );
    }
  }

  /**
   * Get system status with aggregated information
   */
  async getSystemStatus(): Promise<SystemStatus> {
    const services = await this.getServices();

    const summary = {
      total: services.length,
      running: services.filter((s) => s.status === "running").length,
      stopped: services.filter(
        (s) => s.status === "stopped" || s.status === "idle",
      ).length,
      error: services.filter((s) => s.status === "error").length,
      healthy: services.filter((s) => s.health === "healthy").length,
      unhealthy: services.filter(
        (s) => s.health === "unhealthy" || s.health === "degraded",
      ).length,
    };

    const hasErrors = services.some(
      (s) => s.status === "error" || s.health === "unhealthy",
    );
    const hasWarnings = services.some((s) => s.health === "degraded");

    return {
      services,
      summary,
      hasErrors,
      hasWarnings,
    };
  }

  /**
   * Fetch with timeout
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === "AbortError") {
        throw new Error(`Request timeout after ${this.timeout}ms`);
      }

      // Connection refused or network error
      if (
        error.code === "ECONNREFUSED" ||
        error.message.includes("fetch failed")
      ) {
        throw new Error(
          `Cannot connect to DevAC server at ${this.baseUrl}. Is it running?`,
        );
      }

      throw error;
    }
  }
}
