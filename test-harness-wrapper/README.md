# Neo4j Test Harness Wrapper

Java wrapper for [Neo4j Test Harness](https://neo4j.com/docs/java-reference/current/extending-neo4j/testing/) that enables embedded Neo4j testing via Node.js subprocess.

## Purpose

This wrapper allows the universal database testing framework to use Neo4j Test Harness as a "native" strategy - meaning tests can run with an embedded Neo4j instance **without requiring**:
- Pre-existing Neo4j installation
- Docker/Testcontainers
- Network access

Perfect for:
- Claude Code web environment
- CI/CD with restricted environments
- Offline development
- Lightweight testing

## Architecture

```
Node.js Test
    ↓
Native Strategy (test-setup/strategies/native-strategy.ts)
    ↓
Spawn Java Process
    ↓
TestHarnessWrapper.java (this project)
    ↓
Neo4j Test Harness (embedded Neo4j)
```

## Requirements

- **Java 21+** (required by Neo4j 5.x)
- **Maven 3.6+** (for building only)

## Building the JAR

⚠️ **Important**: This JAR needs to be built in an environment with **network access** to download Maven dependencies.

### One-Time Build

```bash
cd test-harness-wrapper
mvn clean package
```

This creates:
```
target/test-harness-wrapper.jar  (~50-80MB with all dependencies)
```

### What Gets Built

The Maven Shade plugin creates an "uber JAR" (fat JAR) containing:
- `TestHarnessWrapper.class` (our code)
- Neo4j Test Harness (~40MB)
- Neo4j Java Driver (~5MB)
- All transitive dependencies

Result: **Single self-contained JAR** that can run anywhere Java 21+ is available.

## Usage

### Standalone (Manual Testing)

```bash
# Auto-assign port
java -jar test-harness-wrapper.jar

# Specific port
java -jar test-harness-wrapper.jar --port 7687

# Output:
# READY: bolt://localhost:7687
# USERNAME: neo4j
# PASSWORD: password
# DATABASE: neo4j
```

Keep the process running - Neo4j is available until Ctrl+C.

### From Node.js (Production Usage)

The Native Strategy automatically spawns and manages the Java process:

```typescript
import { NativeStrategy } from './test-setup/strategies/native-strategy.js';

const strategy = new NativeStrategy();
const connection = await strategy.start(config, logger);

// Use connection.uri, connection.username, etc.
// ...

await strategy.stop(); // Terminates Java process
```

## Output Format

The wrapper outputs connection details in a parseable format:

```
READY: bolt://localhost:12345
USERNAME: neo4j
PASSWORD: password
DATABASE: neo4j
```

- **Line 1**: Signals ready state + Bolt URI
- **Line 2-4**: Authentication details
- **stderr**: Debug logs (startup messages, errors)
- **stdout**: Only connection details (for parsing)

The Node.js strategy waits for all 4 lines before considering the database ready.

## Performance

| Metric | Value |
|--------|-------|
| **Startup Time** | ~3-7 seconds |
| **Memory Usage** | ~200-300MB (Java heap) |
| **JAR Size** | ~50-80MB |
| **Port Assignment** | Auto (random available port) |

## Troubleshooting

### Build Fails: "Could not resolve dependencies"

**Cause**: No network access to download Maven Central dependencies
**Solution**: Build in an environment with network access, then commit the JAR

### Runtime Error: "UnsupportedClassVersionError"

**Cause**: Java version < 21
**Solution**: Install Java 21+ (required by Neo4j 5.x)

### Timeout: "Timeout waiting for Neo4j Test Harness"

**Cause**: Java process not outputting expected format
**Solution**:
1. Run JAR manually to see full output: `java -jar test-harness-wrapper.jar`
2. Enable debug logging: `DEBUG_DB_STRATEGY=true npm run test:integration`
3. Check stderr logs for Neo4j startup errors

### "JAR file not found"

**Cause**: JAR hasn't been built yet
**Solution**:
```bash
cd test-harness-wrapper
mvn clean package
# Creates target/test-harness-wrapper.jar
```

## Development

### Project Structure

```
test-harness-wrapper/
├── pom.xml                                  # Maven configuration
├── src/main/java/com/codegraph/testharness/
│   └── TestHarnessWrapper.java             # Main class
├── target/
│   ├── test-harness-wrapper.jar            # Built artifact (gitignored)
│   └── ...                                  # Other Maven outputs
└── README.md                                # This file
```

### Modifying the Code

1. Edit `TestHarnessWrapper.java`
2. Rebuild: `mvn clean package`
3. Test manually: `java -jar target/test-harness-wrapper.jar`
4. Test via Node.js: `DEBUG_DB_STRATEGY=true npm run test:integration`

### Adding Features

Common modifications:

**Custom Configuration**:
```java
Neo4j neo4j = Neo4jBuilders.newInProcessBuilder()
    .withDisabledServer()
    .withConfig(GraphDatabaseSettings.auth_enabled, false) // Disable auth
    .build();
```

**Pre-load Data**:
```java
// In startNeo4j()
try (var tx = neo4j.defaultDatabaseService().beginTx()) {
    tx.execute("CREATE (n:Test {name: 'test'})");
    tx.commit();
}
```

## Why Not Use testcontainers-neo4j?

The `@testcontainers/neo4j` Node.js package is excellent, but requires Docker. Our use case:

| Requirement | Testcontainers | Test Harness |
|-------------|----------------|--------------|
| No Docker | ❌ | ✅ |
| Claude Code Web | ❌ | ✅ |
| Offline | ❌ | ✅ |
| Fast Startup | ❌ (5-10s) | ✅ (3-7s) |
| Strong Isolation | ✅ | ⚠️ (process-level) |

**We use both** via the universal framework's graceful degradation:
1. Service (pre-existing) - fastest
2. Native (Test Harness) - most portable
3. Container (Docker) - strongest isolation

## References

- [Neo4j Test Harness Docs](https://neo4j.com/docs/java-reference/current/extending-neo4j/testing/)
- [Neo4j Java Driver](https://neo4j.com/docs/java-manual/current/)
- [Maven Shade Plugin](https://maven.apache.org/plugins/maven-shade-plugin/)

## License

Same as parent project (MIT)
