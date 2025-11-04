import neo4j from 'neo4j-driver';

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'test1234')
);

const session = driver.session({ database: 'neo4j' });

try {
  // Check for File nodes with repository metadata
  const fileResult = await session.run(`
    MATCH (n:File)
    WHERE n.filePath CONTAINS 'CodeGraph' AND n.repository IS NOT NULL
    RETURN n.name AS name, n.repository AS repo, n.repositoryPath AS repoPath, n.syncedAt AS syncTime
    LIMIT 5
  `);
  
  console.log('CodeGraph File nodes WITH repository metadata:', fileResult.records.length);
  fileResult.records.forEach(record => {
    console.log({
      name: record.get('name'),
      repo: record.get('repo'),
      repoPath: record.get('repoPath'),
      syncTime: record.get('syncTime')
    });
  });
  
  // Check total CodeGraph files
  const totalResult = await session.run(`
    MATCH (n:File)
    WHERE n.filePath CONTAINS 'CodeGraph'
    RETURN count(n) AS total
  `);
  console.log('\nTotal CodeGraph files:', totalResult.records[0].get('total').toNumber());
  
  // Check one sample
  const sample = await session.run(`
    MATCH (n:File)
    WHERE n.filePath CONTAINS 'CodeGraph'
    RETURN n.name, n.repository, n.repositoryPath, n.syncedAt
    LIMIT 1
  `);
  
  if (sample.records.length > 0) {
    const rec = sample.records[0];
    console.log('\nSample CodeGraph File:');
    console.log('  name:', rec.get('n.name'));
    console.log('  repository:', rec.get('n.repository'));
    console.log('  repositoryPath:', rec.get('n.repositoryPath'));
    console.log('  syncedAt:', rec.get('n.syncedAt'));
  }
} finally {
  await session.close();
  await driver.close();
}
