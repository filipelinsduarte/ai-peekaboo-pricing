/* Inlines src/pricing.js into index.html between the build markers, so the
   deliverable stays a single self-contained file while the pricing math lives
   in one testable module.

   Run:  npm run build     (after every edit to src/pricing.js)
*/
import { readFileSync, writeFileSync } from 'node:fs';

const START = '/* build:pricing */';
const END = '/* /build:pricing */';

const logic = readFileSync('src/pricing.js', 'utf8').trim();
const html = readFileSync('index.html', 'utf8');

const startAt = html.indexOf(START);
const endAt = html.indexOf(END);

if (startAt === -1 || endAt === -1) {
  console.error('Build markers not found in index.html. Expected:\n  ' + START + '\n  ' + END);
  process.exit(1);
}
if (endAt < startAt) {
  console.error('Build markers are in the wrong order in index.html.');
  process.exit(1);
}

const before = html.slice(0, startAt + START.length);
const after = html.slice(endAt);

// A plain string replace would eat backslashes in the source ($&, $1 etc are
// only special in replace(), which is exactly why this uses slice instead.
const next = before + '\n' + logic + '\n' + after;

writeFileSync('index.html', next);
console.log('Inlined src/pricing.js into index.html (' + logic.length + ' chars).');
