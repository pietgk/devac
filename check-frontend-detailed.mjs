import neo4j from 'neo4j-driver';

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'test1234')
);

const session = driver.session({ database: 'neo4j' });

try {
  // Check what repositories actually exist
  const repoCheck = await session.run(`
    MATCH (n)
    WHERE n.repository IS NOT NULL
    RETURN DISTINCT n.repository AS repo, count(n) AS totalNodes
    ORDER BY repo
  `);
  
  console.log('=== REPOSITORIES IN DATABASE ===');
  repoCheck.records.forEach(rec => {
    console.log(`${rec.get('repo')}: ${rec.get('totalNodes').toNumber()} nodes`);
  });
  
  // Check for frontend-monorepo specifically
  const frontendCheck = await session.run(`
    MATCH (n)
    WHERE n.repository = 'frontend-monorepo'
    RETURN count(n) AS total
  `);
  
  const frontendCount = frontendCheck.records[0].get('total').toNumber();
  console.log(`\n=== FRONTEND-MONOREPO STATUS ===`);
  console.log(`Total nodes: ${frontendCount}`);
  
  if (frontendCount === 0) {
    console.log('❌ NO frontend-monorepo data found in database');
    console.log('\nThe sync process may have:');
    console.log('  1. Failed silently');
    console.log('  2. Not completed');
    console.log('  3. Saved to wrong database');
  } else {
    console.log('✅ frontend-monorepo data EXISTS');
    
    // Get details
    const details = await session.run(`
      MATCH (n)
      WHERE n.repository = 'frontend-monorepo'
      RETURN labels(n)[0] AS type, count(n) AS count
      ORDER BY count DESC
      LIMIT 10
    `);
    
    console.log('\nNode breakdown:');
    details.records.forEach(rec => {
      console.log(`  ${rec.get('type')}: ${rec.get('count').toNumber()}`);
    });
  }
  
  // Check total database size
  const totalCheck = await session.run(`
    MATCH (n)
    RETURN count(n) AS total
  `);
  
  console.log(`\n=== DATABASE TOTALS ===`);
  console.log(`Total nodes in database: ${totalCheck.records[0].get('total').toNumber()}`);
  
} finally {
  await session.close();
  await driver.close();
}
