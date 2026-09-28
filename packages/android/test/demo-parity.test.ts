// Judge-demo parity: the exact .cl behind the live tour screens must round-trip
// through the Kotlin Compose exporter without throwing, deterministically, and
// keep the element order/text the HTML preview shows.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@project/dsl";
import { buildAndroid, androidSignature } from "../src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "apps", "ide", "src", "tour", "demoScreen.ts");
const demo = readFileSync(root, "utf8");
const DEMO_SOURCE = demo.match(/export const DEMO_SOURCE = `([\s\S]*?)`;/)?.[1] ?? "";

describe("buildAndroid — judge demo parity", () => {
  const project = parse(DEMO_SOURCE);

  it("parses the live demo screen cleanly", () => {
    expect(project.pages.length).toBeGreaterThan(0);
    expect(project.pages[0].name).toBe("Aurora");
  });

  it("emits a deterministic, compilable-looking Screen fn without throwing", () => {
    const out = buildAndroid(project);
    expect(out).toContain("fun AuroraScreen() {");
    expect(out).toContain("import androidx.compose.material3.*");
    expect(out).toContain("@Composable");
    expect(() => buildAndroid(project)).not.toThrow();
    expect(buildAndroid(project)).toBe(out);
  });

  it("keeps the hero headline and the real artifact line", () => {
    const out = buildAndroid(project);
    expect(out).toContain("Ship the screen you can already see");
    expect(out).toContain("Export a single-file web app or Kotlin Compose");
    expect(out).toContain("REAL ARTIFACTS");
  });

  it("preserves DFS element order (html preview parity subset)", () => {
    const sig = androidSignature(project);
    expect(sig).toMatch(/^Column\(Row\(Text:Aurora,Button:Docs,Button:Sign in,Button:Get Aurora\),/);
    expect(sig).toContain("Button:Get Aurora");
    expect(sig).toContain("Button:Start building");
    expect(sig).toContain("Button:Subscribe");
  });
});