// Child runner executed by CLARO Workbench's main process with
// ELECTRON_RUN_AS_NODE=1 so electron-builder runs as a pure Node process
// (never as a GUI Electron app). Expects two argv values:
//   argv[2] = path to a JSON build-config file
//   argv[3] = path to a JSON result file (written before exit)
// Progress lines are printed to stdout; the parent streams them to the UI.
const fs = require("fs");

function log(line) {
  process.stdout.write(String(line).replace(/\r?\n/g, "\n") + "\n");
}

const [, , configPath, resultPath] = process.argv;

async function main() {
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const { build } = require("electron-builder");
  log("electron-builder ready (vendored).");
  const artifacts = await build({
    projectDir: cfg.projectDir,
    config: cfg.config,
    publish: undefined,
  });
  fs.writeFileSync(resultPath, JSON.stringify({ ok: true, artifacts }));
  log("DONE");
}

main().catch((e) => {
  const error = e && e.stack ? e.stack : String(e);
  fs.writeFileSync(resultPath, JSON.stringify({ ok: false, error }));
  log(`ERROR: ${error}`);
  process.exit(1);
});