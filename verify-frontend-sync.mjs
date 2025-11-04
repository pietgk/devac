import neo4j from 'neo4j-driver';

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'test1234')
);

const session = driver.session({ database: 'neo4j' });

try {
  // Check for frontend-monorepo files
  const result = await session.run(`
    MATCH (f:File)
    WHERE f.repository = 'frontend-monorepo'
    RETURN count(f) AS totalFiles
  `);
  
  console.log('Frontend-monorepo files:', result.records[0].get('totalFiles').toNumber());
  
  // Get sample
  const sample = await session.run(`
    MATCH (f:File)
    WHERE f.repository = 'frontend-monorepo'
    RETURN f.name, f.syncedAt
    LIMIT 3
  `);
  
  console.log('\nSample files:');
  sample.records.forEach(rec => {
    console.log('  -', rec.get('f.name'), 'synced at', rec.get('f.syncedAt'));
  });
  
  // Check all repositories
  const repos = await session.run(`
    MATCH (n)
    WHERE n.repository IS NOT NULL
    RETURN DISTINCT n.repository AS repo, count(n) AS nodes
    ORDER BY repo
  `);
  
  console.log('\nAll repositories in database:');
  repos.records.forEach(rec => {
    console.log('  -', rec.get('repo'), ':', rec.get('nodes').toNumber(), 'nodes');
  });
} finally {
  await session.close();
  await driver.close();
}
