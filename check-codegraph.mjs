import neo4j from 'neo4j-driver';

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'password')
);

const session = driver.session({ database: 'codegraph' });

try {
  // Check total nodes
  const result = await session.run('MATCH (n) RETURN count(n) AS total');
  console.log('Total nodes in codegraph:', result.records[0].get('total').toNumber());
  
  // Check for File nodes with repository metadata
  const fileResult = await session.run(`
    MATCH (n:File)
    WHERE n.filePath CONTAINS 'CodeGraph'
    RETURN n.name AS name, n.repository AS repo, n.repositoryPath AS repoPath, n.syncedAt AS syncTime
    LIMIT 5
  `);
  
  console.log('\nCodeGraph File nodes with metadata:');
  fileResult.records.forEach(record => {
    console.log({
      name: record.get('name'),
      repo: record.get('repo'),
      repoPath: record.get('repoPath'),
      syncTime: record.get('syncTime')
    });
  });
  
  // Check ANY File node for properties
  const anyFile = await session.run(`
    MATCH (n:File)
    RETURN n LIMIT 1
  `);
  
  if (anyFile.records.length > 0) {
    console.log('\nSample File node properties:');
    console.log(anyFile.records[0].get('n').properties);
  }
} finally {
  await session.close();
  await driver.close();
}
