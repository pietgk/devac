#!/usr/bin/env node

import neo4j from 'neo4j-driver';

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USERNAME = process.env.NEO4J_USERNAME || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'test1234';

console.log('🔍 Verifying Neo4j connection...\n');
console.log(`URI: ${NEO4J_URI}`);
console.log(`Username: ${NEO4J_USERNAME}`);
console.log(`Password: ${'*'.repeat(NEO4J_PASSWORD.length)}\n`);

const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD)
);

try {
  // Test connectivity
  console.log('⏳ Testing connectivity...');
  await driver.verifyConnectivity();
  console.log('✅ Successfully connected to Neo4j!\n');

  // Get server info
  const session = driver.session({ database: 'system' });
  try {
    const result = await session.run('CALL dbms.components() YIELD versions RETURN versions[0] AS version');
    const version = result.records[0]?.get('version');
    console.log(`📦 Neo4j Version: ${version}\n`);

    // List databases
    const dbResult = await session.run('SHOW DATABASES');
    console.log('📚 Available Databases:');
    dbResult.records.forEach(record => {
      const name = record.get('name');
      const currentStatus = record.get('currentStatus');
      const defaultDb = record.get('default');
      console.log(`  - ${name} (${currentStatus})${defaultDb ? ' [default]' : ''}`);
    });

    console.log('\n✨ Neo4j is ready for testing!');
  } finally {
    await session.close();
  }
} catch (error) {
  console.error('❌ Failed to connect to Neo4j:');
  console.error(`   ${error.message}\n`);
  console.error('💡 Troubleshooting:');
  console.error('   1. Ensure Neo4j is running');
  console.error('   2. Check URI is correct (bolt://localhost:7687)');
  console.error('   3. Verify credentials (neo4j / test1234)');
  console.error('   4. Check firewall/network settings\n');
  process.exit(1);
} finally {
  await driver.close();
}
