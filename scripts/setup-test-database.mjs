#!/usr/bin/env node

import neo4j from 'neo4j-driver';

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USERNAME = process.env.NEO4J_USERNAME || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'test1234';
const TEST_DATABASE = 'codegraph_test';

console.log('🔧 Setting up Neo4j test database...\n');

const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD)
);

try {
  await driver.verifyConnectivity();
  console.log('✅ Connected to Neo4j\n');

  // Create test database
  const systemSession = driver.session({ database: 'system' });
  try {
    console.log(`⏳ Creating database: ${TEST_DATABASE}...`);

    // Check if database already exists
    const checkResult = await systemSession.run(
      'SHOW DATABASES WHERE name = $name',
      { name: TEST_DATABASE }
    );

    if (checkResult.records.length > 0) {
      console.log(`⚠️  Database ${TEST_DATABASE} already exists`);
      console.log('   Dropping existing database...');
      await systemSession.run(`DROP DATABASE ${TEST_DATABASE} IF EXISTS`);
      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Create the database
    await systemSession.run(`CREATE DATABASE ${TEST_DATABASE}`);
    console.log(`✅ Created database: ${TEST_DATABASE}`);

    // Wait for database to be online
    console.log('⏳ Waiting for database to come online...');
    let attempts = 0;
    while (attempts < 10) {
      const statusResult = await systemSession.run(
        'SHOW DATABASES WHERE name = $name',
        { name: TEST_DATABASE }
      );
      const status = statusResult.records[0]?.get('currentStatus');
      if (status === 'online') {
        console.log('✅ Database is online\n');
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    // Verify test database is accessible
    const testSession = driver.session({ database: TEST_DATABASE });
    try {
      await testSession.run('RETURN 1 AS test');
      console.log('✅ Test database is accessible');
      console.log('\n🎉 Test database setup complete!');
      console.log(`\n📝 Connection details:`);
      console.log(`   Database: ${TEST_DATABASE}`);
      console.log(`   URI: ${NEO4J_URI}`);
      console.log(`   Username: ${NEO4J_USERNAME}`);
    } finally {
      await testSession.close();
    }
  } finally {
    await systemSession.close();
  }
} catch (error) {
  console.error('❌ Failed to setup test database:');
  console.error(`   ${error.message}\n`);

  if (error.message.includes('ECONNREFUSED')) {
    console.error('💡 Neo4j is not running. Start Neo4j first:');
    console.error('   - Neo4j Desktop: Start your database');
    console.error('   - Docker: docker run -d -p 7687:7687 -p 7474:7474 neo4j:5-community');
    console.error('   - System service: sudo systemctl start neo4j\n');
  } else if (error.message.includes('authentication')) {
    console.error('💡 Check your credentials:');
    console.error(`   Current: ${NEO4J_USERNAME} / ${'*'.repeat(NEO4J_PASSWORD.length)}`);
    console.error('   Update with environment variables if needed\n');
  }

  process.exit(1);
} finally {
  await driver.close();
}
