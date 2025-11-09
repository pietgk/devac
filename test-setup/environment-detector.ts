// test-setup/environment-detector.ts

import { exec } from 'child_process';
import { promisify } from 'util';
import net from 'net';
import type { EnvironmentCapabilities } from './types.js';

const execAsync = promisify(exec);

/**
 * Detects available capabilities in the current environment.
 * Used to determine which database strategies can be used.
 */
export class EnvironmentDetector {
  private cache: EnvironmentCapabilities | null = null;

  /**
   * Detect all environment capabilities.
   * Results are cached for performance.
   */
  async detect(databaseType: string, servicePort?: number): Promise<EnvironmentCapabilities> {
    if (this.cache) {
      return this.cache;
    }

    const [hasService, serviceDetails, hasDocker, dockerVersion, hasJava, javaVersion, javaHome] =
      await Promise.all([
        this.detectService(servicePort || this.getDefaultPort(databaseType)),
        this.getServiceDetails(servicePort || this.getDefaultPort(databaseType)),
        this.detectDocker(),
        this.getDockerVersion(),
        this.detectJava(),
        this.getJavaVersion(),
        this.getJavaHome(),
      ]);

    this.cache = {
      hasService,
      serviceDetails: hasService ? serviceDetails : undefined,
      hasDocker,
      dockerVersion: hasDocker ? dockerVersion : undefined,
      hasJava,
      javaVersion: hasJava ? javaVersion : undefined,
      javaHome: hasJava ? javaHome : undefined,
    };

    return this.cache;
  }

  /**
   * Clear the detection cache.
   * Useful for re-detection after environment changes.
   */
  clearCache(): void {
    this.cache = null;
  }

  /**
   * Check if a database service is running on the given port.
   */
  private async detectService(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 1000); // 1 second timeout

      socket.on('connect', () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(true);
      });

      socket.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });

      socket.connect(port, 'localhost');
    });
  }

  /**
   * Get service connection details if available.
   */
  private async getServiceDetails(port: number): Promise<{ host: string; port: number } | undefined> {
    const isAvailable = await this.detectService(port);
    return isAvailable ? { host: 'localhost', port } : undefined;
  }

  /**
   * Check if Docker is available.
   */
  private async detectDocker(): Promise<boolean> {
    try {
      await execAsync('docker info', { timeout: 2000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get Docker version if available.
   */
  private async getDockerVersion(): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync('docker --version', { timeout: 2000 });
      const match = stdout.match(/Docker version ([\d.]+)/);
      return match ? match[1] : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Check if Java is available.
   */
  private async detectJava(): Promise<boolean> {
    try {
      await execAsync('java -version', { timeout: 2000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get Java version if available.
   */
  private async getJavaVersion(): Promise<string | undefined> {
    try {
      const { stderr } = await execAsync('java -version', { timeout: 2000 });
      // Java version is printed to stderr
      const match = stderr.match(/version "([^"]+)"/);
      return match ? match[1] : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Get JAVA_HOME or detect Java installation path.
   */
  private async getJavaHome(): Promise<string | undefined> {
    // First try JAVA_HOME environment variable
    if (process.env.JAVA_HOME) {
      return process.env.JAVA_HOME;
    }

    // Try to find java path
    try {
      const { stdout } = await execAsync('which java', { timeout: 2000 });
      const javaPath = stdout.trim();

      // If java is a symlink, resolve it
      try {
        const { stdout: realPath } = await execAsync(`readlink -f ${javaPath}`, { timeout: 2000 });
        // JAVA_HOME is typically two levels up from bin/java
        // e.g., /usr/lib/jvm/java-21-openjdk/bin/java -> /usr/lib/jvm/java-21-openjdk
        const binDir = realPath.trim().split('/').slice(0, -1).join('/');
        const javaHome = binDir.split('/').slice(0, -1).join('/');
        return javaHome;
      } catch {
        return undefined;
      }
    } catch {
      return undefined;
    }
  }

  /**
   * Get default port for database type.
   */
  private getDefaultPort(databaseType: string): number {
    const ports: Record<string, number> = {
      neo4j: 7687,
      postgresql: 5432,
      mysql: 3306,
      dynamodb: 8000,
    };
    return ports[databaseType] || 0;
  }
}
