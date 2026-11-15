import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ['node_modules/gifenc/dist/gifenc.esm.js', 'vendor/gifenc.esm.js'],
  ['node_modules/jspdf/dist/jspdf.umd.min.js', 'vendor/jspdf.umd.min.js'],
];
const check = process.argv.includes('--check');

for (const [from, to] of files) {
  const src = join(root, from);
  const dest = join(root, to);
  if (!check) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    continue;
  }
  const hash = buf => createHash('sha256').update(buf).digest('hex');
  const left = hash(readFileSync(src));
  const right = hash(readFileSync(dest));
  if (left !== right) {
    console.error(`${to} does not match ${from}. Run npm run vendor.`);
    process.exit(1);
  }
}
console.log(check ? 'vendor matches node_modules' : 'vendor updated');
