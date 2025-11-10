// test-setup/jar-downloader.ts

import { createWriteStream, existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { pipeline } from 'stream/promises';
import { get } from 'https';

/**
 * Download the test harness JAR from GitHub releases if not available locally.
 *
 * This is a fallback for environments where:
 * - Git LFS is not available
 * - Maven build cannot run (no network to Maven Central)
 * - JAR was not committed directly to repo
 */
export class JarDownloader {
  private readonly jarPath: string;
  private readonly githubReleaseUrl: string;

  constructor(jarPath: string, githubReleaseUrl?: string) {
    this.jarPath = jarPath;
    // Default to GitHub releases URL (can be overridden)
    this.githubReleaseUrl = githubReleaseUrl ||
      'https://github.com/pietgk/devac/releases/latest/download/test-harness-wrapper.jar';
  }

  /**
   * Check if JAR exists and is valid (not a Git LFS pointer)
   */
  async jarExists(): Promise<boolean> {
    if (!existsSync(this.jarPath)) {
      return false;
    }

    // Check if it's a Git LFS pointer (text file) vs actual JAR (binary)
    const fs = await import('fs');
    const stats = fs.statSync(this.jarPath);

    // Git LFS pointers are tiny (< 1KB), real JAR is ~140MB
    if (stats.size < 1000) {
      return false; // Likely a Git LFS pointer
    }

    return true;
  }

  /**
   * Download JAR from GitHub release
   */
  async downloadJar(onProgress?: (downloaded: number, total: number) => void): Promise<void> {
    console.log(`Downloading test harness JAR from GitHub releases...`);
    console.log(`URL: ${this.githubReleaseUrl}`);

    // Ensure target directory exists
    await mkdir(dirname(this.jarPath), { recursive: true });

    return new Promise((resolve, reject) => {
      get(this.githubReleaseUrl, (response) => {
        // Handle redirects
        if (response.statusCode === 302 || response.statusCode === 301) {
          const redirectUrl = response.headers.location;
          if (!redirectUrl) {
            reject(new Error('Redirect without location header'));
            return;
          }

          // Follow redirect
          get(redirectUrl, (redirectResponse) => {
            this.handleDownloadResponse(redirectResponse, onProgress, resolve, reject);
          }).on('error', reject);
        } else {
          this.handleDownloadResponse(response, onProgress, resolve, reject);
        }
      }).on('error', reject);
    });
  }

  private handleDownloadResponse(
    response: any,
    onProgress: ((downloaded: number, total: number) => void) | undefined,
    resolve: () => void,
    reject: (error: Error) => void
  ): void {
    if (response.statusCode !== 200) {
      reject(new Error(`Download failed with status ${response.statusCode}`));
      return;
    }

    const totalSize = parseInt(response.headers['content-length'] || '0', 10);
    let downloadedSize = 0;

    const fileStream = createWriteStream(this.jarPath);

    response.on('data', (chunk: Buffer) => {
      downloadedSize += chunk.length;
      if (onProgress && totalSize > 0) {
        onProgress(downloadedSize, totalSize);
      }
    });

    pipeline(response, fileStream)
      .then(() => {
        console.log(`✅ JAR downloaded successfully to ${this.jarPath}`);
        console.log(`   Size: ${(downloadedSize / 1024 / 1024).toFixed(2)} MB`);
        resolve();
      })
      .catch(reject);
  }

  /**
   * Ensure JAR is available - download if needed
   */
  async ensureJarAvailable(): Promise<void> {
    const exists = await this.jarExists();

    if (exists) {
      console.log('✅ Test harness JAR already available');
      return;
    }

    console.log('⚠️  Test harness JAR not found or is Git LFS pointer');

    try {
      await this.downloadJar((downloaded, total) => {
        const percent = ((downloaded / total) * 100).toFixed(1);
        const downloadedMB = (downloaded / 1024 / 1024).toFixed(1);
        const totalMB = (total / 1024 / 1024).toFixed(1);
        process.stdout.write(`\r   Downloading: ${downloadedMB}/${totalMB} MB (${percent}%)`);
      });
      process.stdout.write('\n'); // New line after progress
    } catch (error) {
      throw new Error(
        `Failed to download test harness JAR: ${error instanceof Error ? error.message : String(error)}\n\n` +
        `Alternatives:\n` +
        `1. Build locally: cd test-harness-wrapper && mvn clean package\n` +
        `2. Install Git LFS: git lfs install && git lfs pull\n` +
        `3. Download manually from: ${this.githubReleaseUrl}\n` +
        `   and place at: ${this.jarPath}`
      );
    }
  }
}

/**
 * Helper function to ensure JAR is available before tests run
 */
export async function ensureTestHarnessJar(
  jarPath: string = 'test-harness-wrapper/target/test-harness-wrapper.jar'
): Promise<void> {
  const downloader = new JarDownloader(jarPath);
  await downloader.ensureJarAvailable();
}
