// Quick test of package extraction
import { PackageExtractor } from './dist/analyzer/parsers/package-extractor.js';

async function test() {
  console.log('Testing PackageExtractor on frontend-monorepo...\n');

  const extractor = new PackageExtractor('/Users/grop/ws/frontend-monorepo');
  const packages = await extractor.discoverPackages();

  console.log(`Found ${packages.length} packages:\n`);
  packages.forEach(pkg => {
    console.log(`  - ${pkg.name} (${pkg.type})`);
    console.log(`    Path: ${pkg.path}`);
    console.log(`    Entry: ${pkg.entryPoint || 'none'}`);
    console.log('');
  });

  // Test file mapping
  console.log('\nTesting file mapping:');
  const testFile = '/Users/grop/ws/frontend-monorepo/packages/mindler-ui-web/src/lib/button.tsx';
  const pkg = extractor.getPackageForFile(testFile);
  console.log(`File: ${testFile}`);
  console.log(`Package: ${pkg ? pkg.name : 'NOT FOUND'}`);
}

test().catch(console.error);
