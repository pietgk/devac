// src/utils/sleep-detector.ts
import { EventEmitter } from "events";
import { createContextLogger } from "./logger.js";

const logger = createContextLogger("SleepDetector");

/**
 * Detects when the system goes to sleep and wakes up.
 * Uses timing-based detection since Node.js doesn't have native sleep events.
 */
export class SleepDetector extends EventEmitter {
  private checkInterval: NodeJS.Timeout | null = null;
  private lastCheckTime: number = Date.now();
  private readonly threshold: number;
  private readonly checkFrequency: number;
  private isMonitoring: boolean = false;

  /**
   * Creates a SleepDetector instance.
   * @param threshold - Time in milliseconds to consider as sleep (default: 10 seconds)
   * @param checkFrequency - How often to check in milliseconds (default: 1 second)
   */
  constructor(threshold: number = 10000, checkFrequency: number = 1000) {
    super();
    this.threshold = threshold;
    this.checkFrequency = checkFrequency;
  }

  /**
   * Starts monitoring for system sleep events.
   */
  public start(): void {
    if (this.isMonitoring) {
      logger.debug("Sleep detector already running");
      return;
    }

    logger.info(
      `Starting sleep detector (threshold: ${this.threshold}ms, check: ${this.checkFrequency}ms)`,
    );
    this.isMonitoring = true;
    this.lastCheckTime = Date.now();

    this.checkInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - this.lastCheckTime;

      // If elapsed time is significantly longer than check frequency, system likely slept
      if (elapsed > this.threshold) {
        const sleepDuration = elapsed - this.checkFrequency;
        logger.warn(
          `System sleep detected! Elapsed: ${elapsed}ms (sleep duration: ~${Math.round(sleepDuration / 1000)}s)`,
        );
        this.emit("wake", { sleepDuration, detectedAt: now });
      }

      this.lastCheckTime = now;
    }, this.checkFrequency);

    // Also monitor for SIGCONT (resume from stop on Unix systems)
    process.on("SIGCONT", this.handleSigCont);

    logger.debug("Sleep detector started successfully");
  }

  /**
   * Stops monitoring for system sleep events.
   */
  public stop(): void {
    if (!this.isMonitoring) {
      logger.debug("Sleep detector not running");
      return;
    }

    logger.info("Stopping sleep detector");
    this.isMonitoring = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    process.off("SIGCONT", this.handleSigCont);
    logger.debug("Sleep detector stopped");
  }

  /**
   * Handles SIGCONT signal (resume from stop).
   */
  private handleSigCont = (): void => {
    logger.info("SIGCONT received - system resumed from stop");
    this.emit("wake", { sleepDuration: 0, detectedAt: Date.now() });
    this.lastCheckTime = Date.now(); // Reset timer
  };

  /**
   * Returns whether the detector is currently monitoring.
   */
  public isRunning(): boolean {
    return this.isMonitoring;
  }
}
