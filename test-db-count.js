// Test database node count
import { Neo4jClient } from './dist/database/neo4j-client.js';

async function test() {
  const client = new Neo4jClient({
    uri: 'bolt://localhost:7687',
    username: 'neo4j',
    password: 'test1234',
    database: 'neo4j'
  });

  await client.initializeDriver();

  const result = await client.runTransaction(
    'MATCH (n) RETURN count(n) as count',
    {},
    'READ',
    'test'
  );

  console.log('Total nodes:', result.records[0].get('count').toNumber());

  const labelResult = await client.runTransaction(
    'MATCH (n) RETURN DISTINCT labels(n) as labels, count(*) as count ORDER BY count DESC LIMIT 10',
    {},
    'READ',
    'test'
  );

  console.log('\nNode distribution:');
  labelResult.records.forEach(record => {
    console.log(`  ${record.get('labels').join(',')} : ${record.get('count').toNumber()}`);
  });

  await client.close();
}

test().catch(console.error);
