import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const deckValidator = fileURLToPath(new URL("./validate-deck.mjs", import.meta.url));

const steps = [
  { name: "typecheck", cmd: "npm", args: ["run", "typecheck", "--workspaces", "--if-present"] },
  { name: "test", cmd: "npm", args: ["run", "test", "--workspaces", "--if-present"] },
  { name: "deck", cmd: "node", args: [deckValidator] },
];

let failed = 0;
for (const s of steps) {
  try {
    execFileSync(s.cmd, s.args, { stdio: "inherit", shell: true });
    console.log(`\n[verify] ${s.name}: PASS`);
  } catch {
    failed++;
    console.error(`\n[verify] ${s.name}: FAIL`);
  }
}
if (failed > 0) {
  console.error(`[verify] ${failed} step(s) failed`);
  process.exit(1);
}
console.log("[verify] all green");