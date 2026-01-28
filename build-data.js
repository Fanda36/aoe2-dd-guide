#!/usr/bin/env node
/**
 * Build script to bundle all civilization JSON files into a single JS file
 * Run: node build-data.js
 */

const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const OUTPUT_FILE = path.join(__dirname, 'civs-data.js');

async function buildCivsData() {
  console.log('Building civs-data.js...');
  
  // Read all JSON files from data directory
  const files = await fs.readdir(DATA_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json'));
  
  console.log(`Found ${jsonFiles.length} civilization files`);
  
  /** @type {Record<string, object>} */
  const civsData = {};
  
  for (const file of jsonFiles) {
    const filePath = path.join(DATA_DIR, file);
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    
    // Use civilization name as key (lowercase for consistency)
    const civKey = data.civilization.toLowerCase();
    civsData[civKey] = data;
    
    console.log(`  Loaded: ${data.civilization}`);
  }
  
  // Generate JS file with the data
  const output = `// Auto-generated file - DO NOT EDIT
// Generated at: ${new Date().toISOString()}
// Run 'node build-data.js' to regenerate

const CIVS_DATA = ${JSON.stringify(civsData, null, 2)};

// Export list of civilization names for dropdowns
const CIV_NAMES = ${JSON.stringify(
  Object.values(civsData)
    .map(c => c.civilization)
    .sort()
)};
`;

  await fs.writeFile(OUTPUT_FILE, output, 'utf-8');
  
  console.log(`\nGenerated ${OUTPUT_FILE} with ${Object.keys(civsData).length} civilizations`);
}

buildCivsData().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
