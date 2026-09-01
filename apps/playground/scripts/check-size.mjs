import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Size budget for the progressive-mount architecture. Eager JS is what the
// entry html loads before any interaction; everything editor-shaped must
// stay in lazy chunks.
const EAGER_BUDGET = 100 * 1024; // gzip bytes, react vendor chunk excluded
const LAZY_CHUNKS = ["parse", "live-editor", "code-languages", "katex"];

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const html = readFileSync(path.join(dist, "index.html"), "utf-8");

const eager = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
const gz = (file) => gzipSync(readFileSync(path.join(dist, file))).length;

let eagerTotal = 0;
let reactTotal = 0;
for (const file of eager) {
  const size = gz(file);
  if (path.basename(file).startsWith("react-")) reactTotal += size;
  else eagerTotal += size;
  console.log(`eager  ${(size / 1024).toFixed(1).padStart(7)} kB gz  ${file}`);
}

const all = readdirSync(path.join(dist, "assets")).filter((f) => f.endsWith(".js"));
const failures = [];

for (const name of LAZY_CHUNKS) {
  const chunk = all.find((f) => f.startsWith(`${name}-`));
  if (!chunk) failures.push(`expected a lazy "${name}" chunk; splitting has regressed`);
  else if (eager.includes(`assets/${chunk}`)) failures.push(`"${name}" chunk is loaded eagerly`);
  else
    console.log(
      `lazy   ${(gz(`assets/${chunk}`) / 1024).toFixed(1).padStart(7)} kB gz  assets/${chunk}`,
    );
}

console.log(
  `\neager total ${(eagerTotal / 1024).toFixed(1)} kB gz (+ react ${(reactTotal / 1024).toFixed(1)} kB) — budget ${EAGER_BUDGET / 1024} kB`,
);
if (eagerTotal > EAGER_BUDGET) {
  failures.push(
    `eager JS ${(eagerTotal / 1024).toFixed(1)} kB gz exceeds the ${EAGER_BUDGET / 1024} kB budget`,
  );
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}
console.log("✓ size budget ok");
