/**
 * Watcher Module Exports
 *
 * File watching and incremental update functionality for DevAC v2.0
 */

// File watcher
export {
  createFileWatcher,
  FileWatcher,
  FileWatcherOptions,
  FileChangeEvent,
  FileEventType,
  WatcherStats,
  FileEventHandler,
  BatchEventHandler,
} from "./file-watcher.js";

// Rename detector
export {
  createRenameDetector,
  RenameDetector,
  RenameDetectorOptions,
  RenameInfo,
  ProcessedEvents,
} from "./rename-detector.js";

// Update manager
export {
  createUpdateManager,
  UpdateManager,
  UpdateManagerConfig,
  UpdateManagerStatus,
  UpdateResult,
  BatchUpdateResult,
} from "./update-manager.js";
