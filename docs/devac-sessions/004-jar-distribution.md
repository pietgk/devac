# Test Harness JAR Distribution Guide

## Problem

The Neo4j Test Harness JAR is ~140MB, which is too large for regular Git commits and causes issues in restricted environments.

## Solution: GitHub Releases

We distribute the JAR via **GitHub Releases** with automatic download fallback.

---

## For Users (Running Tests)

**No action needed!** The JAR will be automatically downloaded from GitHub releases on first test run.

```bash
npm run test:integration
# → Detects missing JAR
# → Downloads from latest GitHub release
# → Caches locally
# → Runs tests
```

**Manual download (if automatic fails):**
```bash
# Download from:
https://github.com/pietgk/devac/releases/latest/download/test-harness-wrapper.jar

# Place at:
test-harness-wrapper/target/test-harness-wrapper.jar
```

---

## For Maintainers (Creating Releases)

### Step 1: Build the JAR Locally

```bash
cd test-harness-wrapper
mvn clean package

# Verify JAR was created:
ls -lh target/test-harness-wrapper.jar
# Should show ~140MB
```

### Step 2: Create GitHub Release

**Via GitHub CLI:**
```bash
# Tag and create release
git tag v1.0.0
git push origin v1.0.0

# Create release with JAR attachment
gh release create v1.0.0 \
  --title "v1.0.0 - Universal Database Testing" \
  --notes "Release includes Neo4j Test Harness JAR (140MB)" \
  test-harness-wrapper/target/test-harness-wrapper.jar
```

**Via GitHub Web UI:**
1. Go to: https://github.com/pietgk/devac/releases/new
2. Tag: `v1.0.0` (or next version)
3. Title: `v1.0.0 - Universal Database Testing`
4. Description:
   ```markdown
   ## What's New
   - Universal database testing framework
   - Auto-downloading JAR from releases

   ## Assets
   - `test-harness-wrapper.jar` (140MB) - Neo4j Test Harness for native strategy
   ```
5. Upload: `test-harness-wrapper/target/test-harness-wrapper.jar`
6. Click "Publish release"

### Step 3: Test Auto-Download

```bash
# Remove local JAR
rm test-harness-wrapper/target/test-harness-wrapper.jar

# Run tests - should auto-download
DEBUG_DB_STRATEGY=true npm run test:integration

# Expected output:
# ⚠️  Test harness JAR not found or is Git LFS pointer
# Downloading test harness JAR from GitHub releases...
# URL: https://github.com/pietgk/devac/releases/latest/download/test-harness-wrapper.jar
#    Downloading: 140.0/140.0 MB (100.0%)
# ✅ JAR downloaded successfully
```

---

## How It Works

### Automatic Download Flow

```typescript
// When native strategy starts:
1. Check if JAR exists locally
   ├─ Exists & valid (>1KB) → Use it ✅
   └─ Missing or Git LFS pointer → Download from GitHub

2. Download from latest release:
   GET https://github.com/pietgk/devac/releases/latest/download/test-harness-wrapper.jar
   ├─ Success → Save to test-harness-wrapper/target/
   └─ Fail → Show helpful error with alternatives

3. Verify downloaded JAR
   ├─ Valid size (>1KB) → Proceed ✅
   └─ Still pointer/invalid → Error
```

### Fallback Options

If automatic download fails, users see:

```
Failed to download test harness JAR: <error>

Alternatives:
1. Build locally: cd test-harness-wrapper && mvn clean package
2. Install Git LFS: git lfs install && git lfs pull
3. Download manually from: https://github.com/pietgk/devac/releases/latest/download/test-harness-wrapper.jar
   and place at: test-harness-wrapper/target/test-harness-wrapper.jar
```

---

## Configuration

### Custom Release URL

Override the default release URL via environment variable:

```bash
export TEST_HARNESS_JAR_URL="https://your-custom-host.com/test-harness-wrapper.jar"
npm run test:integration
```

Or in code:
```typescript
const downloader = new JarDownloader(
  'test-harness-wrapper/target/test-harness-wrapper.jar',
  'https://your-custom-host.com/test-harness-wrapper.jar'
);
```

---

## Git Configuration

### .gitignore

The JAR is **not committed** to the repository:

```gitignore
# test-harness-wrapper/.gitignore
target/*.jar
```

### Git LFS (Optional)

If you prefer Git LFS over GitHub releases:

```bash
# Install Git LFS
git lfs install

# Track JAR files
git lfs track "test-harness-wrapper/target/*.jar"

# Commit and push
git add .gitattributes test-harness-wrapper/target/test-harness-wrapper.jar
git commit -m "Add JAR via Git LFS"
git push
```

**Trade-offs:**
- ✅ LFS: Versioned with code, automatic sync
- ❌ LFS: Requires LFS client installed, counts against storage quota
- ✅ Releases: Standard HTTP download, works everywhere
- ❌ Releases: Manual upload per release

**Recommendation:** Use **GitHub Releases** for simplicity.

---

## Troubleshooting

### "Download failed with status 404"

**Cause:** No GitHub release exists yet.

**Fix:** Create a release (see Step 2 above)

### "Failed to download: ENOTFOUND github.com"

**Cause:** No network access or GitHub blocked.

**Fix:**
1. Build JAR locally: `cd test-harness-wrapper && mvn clean package`
2. Or install Git LFS: `git lfs install && git lfs pull`

### "JAR exists but tests fail"

**Cause:** JAR is a Git LFS pointer (text file), not actual JAR.

**Check:**
```bash
file test-harness-wrapper/target/test-harness-wrapper.jar
# Should say: "Java archive data (JAR)"
# NOT: "ASCII text"
```

**Fix:**
```bash
# Either install LFS and pull:
git lfs install && git lfs pull

# Or force re-download:
rm test-harness-wrapper/target/test-harness-wrapper.jar
npm run test:integration
```

---

## CI/CD Configuration

### GitHub Actions

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Setup Java
        uses: actions/setup-java@v3
        with:
          distribution: 'temurin'
          java-version: '21'

      - name: Install dependencies
        run: npm install

      - name: Run integration tests
        run: npm run test:integration
        # JAR downloads automatically on first run
```

**No special configuration needed** - JAR downloads automatically.

---

## Summary

**Distribution Method:** GitHub Releases (recommended)

**User Experience:**
- First run: Auto-downloads JAR (~140MB, one-time)
- Subsequent runs: Uses cached JAR (instant)

**Maintainer Workflow:**
1. Build JAR locally with Maven
2. Create GitHub release
3. Upload JAR as release asset
4. Tests auto-download from latest release

**Benefits:**
- ✅ Works everywhere (no Git LFS required)
- ✅ Simple HTTP download
- ✅ Standard practice for large binaries
- ✅ Doesn't bloat Git repository

**Fallbacks:**
- Local Maven build
- Git LFS
- Manual download
