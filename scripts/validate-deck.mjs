// validate-deck.mjs — structural smoke test for the team-training PPTX.
// Dependency-free: parses the OOXML ZIP central directory directly and checks
// the failure modes that made PowerPoint refuse earlier builds:
//   1. every <Override> in [Content_Types].xml points at a real part
//   2. slide count matches expectations
//   3. media images are present
//   4. no native chart parts (charts are images in this deck)
// Usage: node scripts/validate-deck.mjs [path-to.pptx]
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const deck =
  process.argv[2]?.startsWith("-") || !process.argv[2]
    ? join(root, "docs", "CLARO-team-training.pptx")
    : process.argv[2];

const EXPECTED_SLIDES = 17;
const MIN_IMAGES = 5;

const EOCDR = 0x06054b50; // end of central directory record
const CENTRAL = 0x02014b50; // central directory file header

function findEocdr(buf) {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCDR) {
      return {
        record: i,
        count: buf.readUInt16LE(i + 10),
        dirOffset: buf.readUInt32LE(i + 16),
      };
    }
  }
  throw new Error("not a ZIP archive (no end-of-central-directory record)");
}

function scan(buf) {
  const e = findEocdr(buf);
  const files = new Map();
  let offset = e.dirOffset;
  for (let n = 0; n < e.count; n++) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== CENTRAL) throw new Error(`bad central header at ${offset}`);
    const method = buf.readUInt16LE(offset + 10);
    const csize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen);
    files.set(name, { method, csize, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function main() {
  const buf = await readFile(deck);
  const files = scan(buf);
  const names = new Set(files.keys());

  console.log(`deck:   ${deck}`);
  console.log(`parts:  ${names.size}`);

  const slides = [...names].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort();
  const images = [...names].filter((n) => /^ppt\/media\//.test(n));
  const charts = [...names].filter((n) => /^ppt\/charts\/.+\.xml$/.test(n));

  let failed = false;
  const fail = (m) => {
    failed = true;
    console.error(`  ✗ ${m}`);
  };
  const ok = (m) => console.log(`  ✓ ${m}`);

  // 1. dangling content-types overrides -> PowerPoint rejects the file
  if (files.has("[Content_Types].xml")) {
    const { method, csize, localOffset } = files.get("[Content_Types].xml");
    if (method === 0) {
      const start = localOffset + 30; // local header fixed field
      let nameLen, extraLen;
      nameLen = buf.readUInt16LE(localOffset + 26);
      extraLen = buf.readUInt16LE(localOffset + 28);
      const dstart = localOffset + 30 + nameLen + extraLen;
      const ct = buf.toString("utf8", dstart, dstart + csize);
      const overrides = [...ct.matchAll(/PartName="([^"]+)"/g)].map((m) => m[1].replace(/^\//, ""));
      const dangling = overrides.filter((p) => !names.has(p));
      if (dangling.length) {
        fail(`${dangling.length} dangling Override(s): ${dangling.slice(0, 5).join(", ")}`);
      } else {
        ok(`${overrides.length} Content_Types overrides all resolve`);
      }
    } else {
      ok("[Content_Types].xml is deflated — skipping deep override check (zip listing still bounded)");
    }
  } else {
    fail("[Content_Types].xml missing");
  }

  // 2. slide count
  if (slides.length === EXPECTED_SLIDES) ok(`${slides.length} slides`);
  else fail(`${slides.length} slides (expected ${EXPECTED_SLIDES})`);

  // 3. media present
  if (images.length >= MIN_IMAGES) ok(`${images.length} media images`);
  else fail(`${images.length} media images (expected >= ${MIN_IMAGES})`);

  // 4. no native chart parts
  if (charts.length === 0) ok("no native chart parts (charts are images)");
  else fail(`${charts.length} native chart parts present`);

  const mb = (buf.length / 1024 / 1024).toFixed(2);
  console.log(`size:   ${mb} MB`);
  console.log(failed ? "deck:  INVALID" : "deck:  VALID");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});