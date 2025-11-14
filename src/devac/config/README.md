# DevAC Configuration

Configuration utilities for tuning DevAC performance based on codebase size and requirements.

## Batch Size Configuration

The `batch-size-config` module provides presets and utilities for configuring the SemanticResolver batch processing behavior.

### Quick Start

```typescript
import { getConfigForCodebaseSize } from "./config/batch-size-config.js";
import { ValidationCoordinatorService } from "./actors/validation-coordinator.actor.js";

// Automatic configuration based on codebase size
const fileCount = 2500; // Your codebase has 2500 files
const config = getConfigForCodebaseSize(fileCount);

// Use with ValidationCoordinator (which passes to SemanticResolver)
const coordinator = new ValidationCoordinatorService(
  neo4jClient,
  structuralParser,
  importResolver,
  packages,
);
// Config is passed when creating the semantic resolver
```

### Configuration Presets

#### By Codebase Size

Use `CODEBASE_SIZE_PRESETS` for automatic tuning based on total file count:

| Size Category | File Count | Batch Size | Max Queue | Delay |
|---------------|------------|------------|-----------|-------|
| **small** | < 100 | 5 | 50 | 50ms |
| **medium** | 100-1000 | 10 | 100 | 100ms |
| **large** | 1000-5000 | 15 | 200 | 200ms |
| **huge** | > 5000 | 20 | 500 | 500ms |

```typescript
import { CODEBASE_SIZE_PRESETS } from "./config/batch-size-config.js";

// Use preset directly
const config = CODEBASE_SIZE_PRESETS.large;

// Or get preset for file count
const config = getConfigForCodebaseSize(3000); // Returns 'large' preset
```

#### By Performance Profile

Use `PERFORMANCE_PRESETS` for specific optimization goals:

```typescript
import { PERFORMANCE_PRESETS } from "./config/batch-size-config.js";

// Low latency - optimize for fast response times
const lowLatencyConfig = PERFORMANCE_PRESETS["low-latency"];
// { batchSize: 5, maxQueueSize: 50, processingDelay: 50 }

// High throughput - optimize for batch processing efficiency
const throughputConfig = PERFORMANCE_PRESETS["high-throughput"];
// { batchSize: 20, maxQueueSize: 300, processingDelay: 300 }

// CI/CD - optimized for continuous integration pipelines
const cicdConfig = PERFORMANCE_PRESETS["ci-cd"];
// { batchSize: 20, maxQueueSize: 500, processingDelay: 500 }
```

### Custom Configuration

Create custom configurations with validation:

```typescript
import { createConfig } from "./config/batch-size-config.js";

// Use defaults for missing values
const config = createConfig({
  batchSize: 12,
  // maxQueueSize and processingDelay will use defaults
});

// Full custom configuration
const customConfig = createConfig({
  batchSize: 15,
  maxQueueSize: 150,
  processingDelay: 150,
});
```

**Validation Rules:**
- `batchSize` must be at least 1
- `maxQueueSize` must be at least `batchSize`
- `processingDelay` must be non-negative

### Performance Estimation

Estimate memory usage and latency before applying configuration:

```typescript
import { 
  getConfigEstimates,
  printConfigSummary 
} from "./config/batch-size-config.js";

const config = { batchSize: 15, maxQueueSize: 200, processingDelay: 200 };

// Get numeric estimates
const estimates = getConfigEstimates(config);
console.log(`Memory: ${estimates.estimatedMemoryMB} MB`);
console.log(`Latency: ${estimates.estimatedLatencySeconds}s`);
console.log(`Max Concurrency: ${estimates.recommendedMaxConcurrency}`);

// Or print a formatted summary
console.log(printConfigSummary(config));
// Output:
// Batch Size Configuration:
//   Batch Size: 15 files
//   Max Queue Size: 200 files
//   Processing Delay: 200ms
//
// Estimated Performance:
//   Memory Usage: ~105.8 MB per batch
//   Processing Latency: ~3.5s per batch
//   Recommended Concurrency: 10 batches
```

### Advanced: File Size Adjustment

If your files are larger than average (50KB), adjust memory estimates:

```typescript
import { estimateMemoryUsage } from "./config/batch-size-config.js";

const config = { batchSize: 10, maxQueueSize: 100, processingDelay: 100 };

// Default assumes 50KB files (0.05 MB)
const defaultMemory = estimateMemoryUsage(config);
console.log(defaultMemory); // ~80.5 MB

// For larger files (e.g., 200KB)
const largeFileMemory = estimateMemoryUsage(config, 0.2);
console.log(largeFileMemory); // ~82.0 MB
```

## Memory and Latency Formulas

### Memory Formula

```
estimated_memory_mb = 30 + (batch_size × 5) + (file_size_avg_mb × batch_size)
```

Where:
- **30 MB**: ts-morph Project base memory
- **batch_size × 5**: Per-file overhead in ts-morph
- **file_size_avg_mb × batch_size**: Actual file content

**Examples:**

```typescript
// Small batch (5 files, 50KB each)
// 30 + (5 × 5) + (0.05 × 5) = 55.25 MB ✅

// Default batch (10 files, 50KB each)
// 30 + (10 × 5) + (0.05 × 10) = 80.5 MB ✅

// Large batch (20 files, 50KB each)
// 30 + (20 × 5) + (0.05 × 20) = 131 MB ✅

// Too large (50 files, 50KB each)
// 30 + (50 × 5) + (0.05 × 50) = 282.5 MB ⚠️
```

### Latency Formula

```
estimated_time_s = 0.5 + (batch_size × 0.2)
```

Where:
- **0.5s**: Neo4j dependency discovery query
- **batch_size × 0.2s**: 200ms per file for ts-morph analysis

**Examples:**

```typescript
// Small batch (5 files)
// 0.5 + (5 × 0.2) = 1.5s ✅ Fast

// Default batch (10 files)
// 0.5 + (10 × 0.2) = 2.5s ✅ Acceptable

// Large batch (20 files)
// 0.5 + (20 × 0.2) = 4.5s ⚠️ Slower but OK for CI/CD
```

## Configuration Parameters

### batchSize

**Description:** Number of files to process together in a single batch.

**Default:** 10

**Trade-offs:**
- **Higher values:** Better throughput, more memory, higher latency
- **Lower values:** Lower latency, less memory, more overhead

**Recommended range:** 5-20

### maxQueueSize

**Description:** Maximum number of files that can be queued for processing.

**Default:** 100

**Trade-offs:**
- **Higher values:** Can handle larger bursts of changes
- **Lower values:** Provides backpressure sooner, prevents memory issues

**Recommended range:** 50-500

**Rule of thumb:** `maxQueueSize ≥ batchSize × 5`

### processingDelay

**Description:** Debounce delay in milliseconds before processing a batch.

**Default:** 100ms

**Trade-offs:**
- **Higher values:** More time to batch related files together
- **Lower values:** More responsive to individual file changes

**Recommended range:** 50-500ms

## Use Cases

### Development Environment

**Goal:** Fast feedback for individual file changes

```typescript
const config = PERFORMANCE_PRESETS["low-latency"];
// { batchSize: 5, maxQueueSize: 50, processingDelay: 50 }
```

### CI/CD Pipeline

**Goal:** Maximum throughput for full codebase analysis

```typescript
const config = PERFORMANCE_PRESETS["ci-cd"];
// { batchSize: 20, maxQueueSize: 500, processingDelay: 500 }
```

### Large Monorepo

**Goal:** Balance between latency and memory for 3000+ files

```typescript
const config = getConfigForCodebaseSize(3500);
// Returns CODEBASE_SIZE_PRESETS.large
// { batchSize: 15, maxQueueSize: 200, processingDelay: 200 }
```

### Memory-Constrained Environment

**Goal:** Minimize memory usage (e.g., Docker with 512MB limit)

```typescript
const config = createConfig({
  batchSize: 5,     // Small batches
  maxQueueSize: 25, // Limited queue
  processingDelay: 100,
});

// Verify memory usage
const estimates = getConfigEstimates(config);
console.log(`Memory: ${estimates.estimatedMemoryMB} MB`); // ~55 MB ✅
```

## Troubleshooting

### High Memory Usage

**Symptom:** Process running out of memory

**Solutions:**
1. Reduce batch size:
   ```typescript
   const config = createConfig({ batchSize: 5 });
   ```

2. Check file sizes:
   ```typescript
   // If files are large (>100KB), account for it
   const avgFileSizeMB = 0.15; // 150KB
   const memory = estimateMemoryUsage(config, avgFileSizeMB);
   ```

### Slow Processing

**Symptom:** Changes taking too long to process

**Solutions:**
1. Increase batch size (if memory allows):
   ```typescript
   const config = createConfig({ batchSize: 15 });
   ```

2. Reduce processing delay:
   ```typescript
   const config = createConfig({ processingDelay: 50 });
   ```

### Queue Overflow

**Symptom:** "Queue full" warnings

**Solutions:**
1. Increase max queue size:
   ```typescript
   const config = createConfig({ maxQueueSize: 200 });
   ```

2. Increase batch size to process faster:
   ```typescript
   const config = createConfig({ batchSize: 15 });
   ```

## API Reference

See [batch-size-config.ts](./batch-size-config.ts) for full API documentation.

### Key Functions

- `getConfigForCodebaseSize(fileCount)` - Get preset for codebase size
- `getConfigForProfile(profile)` - Get preset for performance profile
- `createConfig(partial)` - Create custom configuration with validation
- `getConfigEstimates(config, avgFileSizeMB?)` - Get performance estimates
- `printConfigSummary(config, avgFileSizeMB?)` - Print formatted summary
- `estimateMemoryUsage(config, avgFileSizeMB?)` - Estimate memory usage
- `estimateLatency(config)` - Estimate processing latency
- `getRecommendedConcurrency(config)` - Get recommended max concurrency

### Constants

- `DEFAULT_CONFIG` - Default configuration (medium codebase)
- `CODEBASE_SIZE_PRESETS` - Presets by codebase size
- `PERFORMANCE_PRESETS` - Presets by performance profile
