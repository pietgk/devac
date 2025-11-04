#!/usr/bin/env node
import neo4j from 'neo4j-driver';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'test1234')
);

async function runValidation() {
  const session = driver.session({ database: 'codegraph' });
  
  try {
    console.log('\n' + '='.repeat(100));
    console.log('📊 CODEGRAPH VALIDATION REPORT - Frontend Monorepo Analysis');
    console.log('='.repeat(100));
    
    // 1. Packages
    console.log('\n1. PACKAGES DETECTED:');
    console.log('-'.repeat(100));
    const pkgResult = await session.run('MATCH (p:Package) RETURN p.name as name, p.path as path ORDER BY p.name');
    pkgResult.records.forEach(r => {
      console.log(`   ${r.get('name').padEnd(50)} ${r.get('path')}`);
    });
    console.log(`   Total: ${pkgResult.records.length} packages`);
    
    // 2. Package Dependencies
    console.log('\n2. PACKAGE DEPENDENCIES:');
    console.log('-'.repeat(100));
    const depResult = await session.run('MATCH (p1:Package)-[r:DEPENDS_ON]->(p2:Package) RETURN p1.name as from, p2.name as to ORDER BY from, to');
    depResult.records.forEach(r => {
      console.log(`   ${r.get('from').padEnd(50)} --> ${r.get('to')}`);
    });
    console.log(`   Total: ${depResult.records.length} dependencies`);
    
    // 3. Node Type Distribution
    console.log('\n3. NODE TYPE DISTRIBUTION:');
    console.log('-'.repeat(100));
    const nodeResult = await session.run('MATCH (n) WITH labels(n) as lbls UNWIND lbls as label RETURN label, count(*) as count ORDER BY count DESC');
    nodeResult.records.forEach(r => {
      console.log(`   ${r.get('label').padEnd(30)} ${r.get('count').toString().padStart(10)}`);
    });
    
    // 4. Relationship Type Distribution
    console.log('\n4. RELATIONSHIP TYPE DISTRIBUTION:');
    console.log('-'.repeat(100));
    const relResult = await session.run('MATCH ()-[r]->() RETURN type(r) as type, count(r) as count ORDER BY count DESC');
    relResult.records.forEach(r => {
      console.log(`   ${r.get('type').padEnd(30)} ${r.get('count').toString().padStart(10)}`);
    });
    
    // 5. Sample Cross-File Imports
    console.log('\n5. SAMPLE CROSS-FILE IMPORTS (showing import resolution):');
    console.log('-'.repeat(100));
    const importResult = await session.run(`
      MATCH (f1:File)-[i:IMPORTS]->(f2:File) 
      WHERE f1.filePath <> f2.filePath
      RETURN f1.name as fromFile, f2.name as toFile, i.source as importSource
      LIMIT 10
    `);
    importResult.records.forEach(r => {
      console.log(`   ${r.get('fromFile').padEnd(40)} imports ${r.get('toFile').padEnd(40)} (${r.get('importSource') || 'N/A'})`);
    });
    
    // 6. Sample Function Calls
    console.log('\n6. SAMPLE FUNCTION CALLS (showing call graph):');
    console.log('-'.repeat(100));
    const callResult = await session.run(`
      MATCH (caller)-[c:CALLS]->(callee)
      WHERE caller.name IS NOT NULL AND callee.name IS NOT NULL
      RETURN caller.name as caller, callee.name as callee, caller.filePath as callerFile
      LIMIT 15
    `);
    callResult.records.forEach(r => {
      const file = r.get('callerFile') || '';
      const fileName = file.split('/').pop() || 'unknown';
      console.log(`   ${r.get('caller').padEnd(40)} calls ${r.get('callee').padEnd(40)} [${fileName}]`);
    });
    
    // 7. React Components (JSX)
    console.log('\n7. REACT COMPONENT ANALYSIS:');
    console.log('-'.repeat(100));
    const jsxResult = await session.run(`
      MATCH (f:File)-[:CONTAINS]->(jsx:JSXElement)
      WITH f, count(jsx) as jsxCount
      ORDER BY jsxCount DESC
      LIMIT 10
      RETURN f.name as file, jsxCount
    `);
    console.log('   Files with most JSX elements:');
    jsxResult.records.forEach(r => {
      console.log(`   ${r.get('file').padEnd(50)} ${r.get('jsxCount').toString().padStart(5)} elements`);
    });
    
    // 8. Class Inheritance
    console.log('\n8. CLASS INHERITANCE:');
    console.log('-'.repeat(100));
    const inheritResult = await session.run(`
      MATCH (c1:Class)-[e:EXTENDS]->(c2:Class)
      RETURN c1.name as child, c2.name as parent
    `);
    if (inheritResult.records.length > 0) {
      inheritResult.records.forEach(r => {
        console.log(`   ${r.get('child').padEnd(40)} extends ${r.get('parent')}`);
      });
    } else {
      console.log('   No class inheritance found (common for React/functional codebases)');
    }
    
    // 9. Files by Package
    console.log('\n9. FILES PER PACKAGE:');
    console.log('-'.repeat(100));
    const filesByPkg = await session.run(`
      MATCH (f:File)-[:BELONGS_TO]->(p:Package)
      WITH p, count(f) as fileCount
      ORDER BY fileCount DESC
      RETURN p.name as package, fileCount
    `);
    filesByPkg.records.forEach(r => {
      console.log(`   ${r.get('package').padEnd(50)} ${r.get('fileCount').toString().padStart(5)} files`);
    });
    
    // 10. Quality Metrics
    console.log('\n10. QUALITY METRICS:');
    console.log('-'.repeat(100));
    
    const totalNodes = await session.run('MATCH (n) RETURN count(n) as count');
    const totalRels = await session.run('MATCH ()-[r]->() RETURN count(r) as count');
    const totalFiles = await session.run('MATCH (f:File) RETURN count(f) as count');
    const avgFileSize = await session.run('MATCH (f:File) WHERE f.loc IS NOT NULL RETURN avg(f.loc) as avg');
    
    console.log(`   Total Nodes:              ${totalNodes.records[0].get('count').toString().padStart(10)}`);
    console.log(`   Total Relationships:      ${totalRels.records[0].get('count').toString().padStart(10)}`);
    console.log(`   Total Files Analyzed:     ${totalFiles.records[0].get('count').toString().padStart(10)}`);
    console.log(`   Avg Lines per File:       ${Math.round(avgFileSize.records[0].get('avg')).toString().padStart(10)}`);
    
    console.log('\n' + '='.repeat(100));
    console.log('✅ VALIDATION COMPLETE');
    console.log('='.repeat(100) + '\n');
    
  } catch (error) {
    console.error('Error during validation:', error);
  } finally {
    await session.close();
    await driver.close();
  }
}

runValidation().catch(console.error);
