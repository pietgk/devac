import winston from "winston";
import path from "path";
import config from "../config/index.js";

const logsDir = path.resolve(process.cwd(), "logs");

/**
 * Log level mappings based on verbosity
 * 0 (default): info, warn, error
 * 1 (-v):      info, warn, error, verbose
 * 2 (-vv):     info, warn, error, verbose, debug
 * 3 (-vvv):    info, warn, error, verbose, debug, trace (silly)
 */
const VERBOSITY_TO_LEVELS: Record<number, string[]> = {
  0: ["error", "warn", "info"],
  1: ["error", "warn", "info", "verbose"],
  2: ["error", "warn", "info", "verbose", "debug"],
  3: ["error", "warn", "info", "verbose", "debug", "silly"],
};

/**
 * Check if a message at the given level should be logged based on current verbosity
 */
function shouldLog(messageLevel: string): boolean {
  const verbosity = Math.max(0, Math.min(3, config.verbosity)) as 0 | 1 | 2 | 3;
  const allowedLevels = VERBOSITY_TO_LEVELS[verbosity]!;
  return allowedLevels.includes(messageLevel);
}

// Ensure logs directory exists (optional, Winston can create files but not dirs)
// import fs from 'fs';
// if (!fs.existsSync(logsDir)) {
//   fs.mkdirSync(logsDir, { recursive: true });
// }

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

// Custom format for console logging
const consoleFormat = printf(
  ({ level, message, timestamp, context, stack, ...metadata }) => {
    let log = `${timestamp} [${context || "App"}] ${level}: ${message}`;
    // Include stack trace for errors if available
    if (stack) {
      log += `\n${stack}`;
    }
    // Include metadata if any exists
    const meta = Object.keys(metadata).length
      ? JSON.stringify(metadata, null, 2)
      : "";
    if (meta && meta !== "{}") {
      // Avoid printing empty metadata objects
      log += ` ${meta}`;
    }
    return log;
  },
);

// Custom format for file logging
const fileFormat = combine(
  timestamp(),
  errors({ stack: true }), // Log stack traces
  json(), // Log in JSON format
);

/**
 * Get the appropriate log level based on verbosity
 */
function getLogLevel(): string {
  if (config.verbosity >= 3) return "silly"; // -vvv or --debug
  if (config.verbosity >= 2) return "debug"; // -vv
  if (config.verbosity >= 1) return "verbose"; // -v
  return config.logLevel || "info"; // default
}

const logger = winston.createLogger({
  level: getLogLevel(),
  format: combine(
    timestamp({ format: "YYYY-MM-DDTHH:mm:ss.SSSZ" }), // ISO 8601 format
    errors({ stack: true }), // Ensure errors format includes stack trace
  ),
  transports: [
    // Console Transport
    new winston.transports.Console({
      format: combine(
        colorize(), // Add colors to console output
        consoleFormat, // Use the custom console format
      ),
      handleExceptions: true, // Log uncaught exceptions
      handleRejections: true, // Log unhandled promise rejections
    }),
    // File Transport - All Logs
    new winston.transports.File({
      filename: path.join(logsDir, "combined.log"),
      format: fileFormat, // Use JSON format for files
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      tailable: true,
      handleExceptions: true,
      handleRejections: true,
    }),
    // File Transport - Error Logs
    new winston.transports.File({
      level: "error",
      filename: path.join(logsDir, "error.log"),
      format: fileFormat, // Use JSON format for error file
      maxsize: 5242880, // 5MB
      maxFiles: 3,
      tailable: true,
      handleExceptions: true,
      handleRejections: true,
    }),
  ],
  exitOnError: false, // Do not exit on handled exceptions
});

/**
 * Creates a child logger with a specific context label.
 * @param context - The context label (e.g., 'AstParser', 'Neo4jClient').
 * @returns A child logger instance.
 */
export const createContextLogger = (context: string): winston.Logger => {
  return logger.child({ context });
};

/**
 * Updates the logger level based on current verbosity setting.
 * Call this after changing config.verbosity at runtime.
 */
export function updateLogLevel(): void {
  const newLevel = getLogLevel();
  logger.level = newLevel;
  logger.info(
    `Log level updated to: ${newLevel} (verbosity: ${config.verbosity})`,
  );
}

// Export the main logger instance if needed directly
export default logger;
