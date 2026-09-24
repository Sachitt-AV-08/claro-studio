// Vendor electron-builder (+ its whole module tree) into apps/ide/vendor so the
// packaged CLARO Workbench can build user EXE installers at runtime — WITHOUT
// declaring electron-builder as a runtime dependency (electron-builder forbids
// being a production dependency of an app it packages). The vendored copy is
// just files on disk; electron-builder's guard only checks package.json deps.
//
// npm refuses a clean `--prefix` install inside this monorepo (its workspace
// logic absords the folder), so we stage the install in the OS temp dir (far
// from any package.json) and copy the resulting node_modules into vendor/.
import { execSync } from "child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const EBN_VERSION = "24.13.3";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(root, "vendor");
const vendorModules = join(vendor, "node_modules");
const marker = join(vendorModules, "electron-builder", "package.json");

// Already vendored at the right version → nothing to do.
if (existsSync(marker)) {
  try {
    const installed = JSON.parse(readFileSync(marker, "utf8"));
    if (installed.version === EBN_VERSION) {
      console.log(`[vendor-builder] electron-builder ${EBN_VERSION} already vendored.`);
      process.exit(0);
    }
  } catch {
    // fall through and re-vendor
  }
}

const staging = mkdtempSync(join(tmpdir(), "claro-eb-vendor-"));
try {
  writeFileSync(
    join(staging, "package.json"),
    JSON.stringify({ name: "claro-eb-vendor", private: true, version: "0.0.0" }, null, 2),
  );
  console.log(`[vendor-builder] installing electron-builder ${EBN_VERSION} in staging…`);
  execSync(`npm install --no-save --no-audit --no-fund --no-package-lock electron-builder@${EBN_VERSION}`, {
    cwd: staging,
    stdio: "inherit",
    shell: true,
  });

  if (!existsSync(join(staging, "node_modules", "electron-builder"))) {
    throw new Error("electron-builder did not install in the staging folder.");
  }

  mkdirSync(vendorModules, { recursive: true });
  console.log("[vendor-builder] copying vendored electron-builder into apps/ide/vendor…");
  cpSync(join(staging, "node_modules"), vendorModules, { recursive: true, force: true });
  writeFileSync(
    join(vendor, "package.json"),
    JSON.stringify(
      { name: "claro-ide-vendor-builder", private: true, version: EBN_VERSION, description: "Vendored electron-builder used at runtime by the App Packaging feature." },
      null,
      2,
    ),
  );
  console.log(`[vendor-builder] done — electron-builder ${EBN_VERSION} vendored.`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}