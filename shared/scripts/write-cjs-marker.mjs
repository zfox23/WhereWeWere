// Marks dist/cjs as CommonJS so Node treats the compiled .js files as CJS
// even though the shared package root is "type": "module".
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cjsDir = join(here, '..', 'dist', 'cjs');
mkdirSync(cjsDir, { recursive: true });
writeFileSync(join(cjsDir, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
