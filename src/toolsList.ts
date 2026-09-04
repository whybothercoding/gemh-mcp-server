import { TOOLS } from './server.js';

const names = TOOLS.map((t) => t.name);
const duplicates = names.filter((name, i) => names.indexOf(name) !== i);

console.log(`${TOOLS.length} tools:`);
for (const tool of TOOLS) {
  console.log(`  - ${tool.name}`);
}

if (duplicates.length > 0) {
  console.error(`Duplicate tool names: ${[...new Set(duplicates)].join(', ')}`);
  process.exit(1);
}
