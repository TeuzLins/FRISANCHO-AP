import { mkdirSync, writeFileSync } from 'node:fs';
import { openapi } from '../apps/api/dist/openapi.js';
mkdirSync('docs', { recursive: true });
writeFileSync('docs/openapi.json', JSON.stringify(openapi, null, 2) + '\n');
