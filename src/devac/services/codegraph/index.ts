// src/devac/services/codegraph/index.ts

export { CodeGraphService, type CodeGraphServiceConfig } from './codegraph-service.js';
export { RoundRobinLogger, type LogEntry, type RoundRobinLoggerOptions, type LineRange } from './round-robin-logger.js';
export { ResourceManager, type ResourceType, type ResourceMetadata, type StoreResourceOptions, type Resource, type ResourceStatistics, type ResourceManagerOptions } from './resource-manager.js';
export { FileWatcher, type FileChangeType, type FileChangeEvent, type FileWatcherOptions, type WatcherStatistics } from './file-watcher.js';
export { ErrorManager, type ErrorManagerOptions, type ErrorSeverity, type ErrorContext, type ErrorEntry, type ErrorStatistics } from './error-manager.js';
