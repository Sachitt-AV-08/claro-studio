/**
 * End-to-end integration tests against real Ollama.
 *
 * These tests call qwen2.5:3b for real and take ~1-3s each.
 * Skip in CI if Ollama is not running.
 *
 * Run: npx vitest run test/e2e.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import type { Project, DslNode, PropValue } from "@project/contracts";
import { validateOps } from "@project/contracts";
import { createOllamaProvider, health } from "../src/ollama.js";
import { proposeIntent } from "../src/intent.js";
import { describeToPatch } from "../src/toPatch.js";
import { reviewProject } from "../src/review.js";
import { createBhasm } from "../src/integration.js";

// ---------- fixtures ----------

function makeNode(
  type: string,
  name: string | undefined,
  props: Record<string, unknown> = {},
  children: DslNode[] = [],
): DslNode {
  return {
    kind: "element",
    nodeId: "",
    type,
    name,
    props: Object.fromEntries(
      Object.entries(props).map(([k, v]) => {
        if (typeof v === "string" && (v.startsWith("#") || v.startsWith("rgb")))
          return [k, { t: "color", v }];
        if (typeof v === "string") return [k, { t: "str", v }];
        if (typeof v === "number") return [k, { t: "num", v }];
        if (typeof v === "boolean") return [k, { t: "bool", v }];
        return [k, v as PropValue];
      }),
    ) as Record<string, PropValue>,
    children,
    source: { start: { line: 1, col: 1 }, end: { line: 1, col: 10 }, text: "" },
  };
}

function makePage(name: string, children: DslNode[]): DslNode {
  const page = {
    kind: "page" as const,
    nodeId: name.toLowerCase(),
    type: "page",
    name,
    props: {},
    children,
    source: { start: { line: 1, col: 1 }, end: { line: 1, col: 10 }, text: "" },
  };
  assignIds(page.children, page.nodeId);
  return page;
}

function assignIds(nodes: DslNode[], prefix: string): void {
  const seen = new Map<string, number>();
  for (const n of nodes) {
    const base = (n.name ?? n.type).toLowerCase();
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const seg = count > 1 ? `${base}:${count}` : base;
    n.nodeId = prefix ? `${prefix}.${seg}` : seg;
    if (n.children.length > 0) assignIds(n.children, n.nodeId);
  }
}

function sampleProject(): Project {
  return {
    meta: { version: "1.0", fileType: ".cl" },
    pages: [
      makePage("Home", [
        makeNode("section", "hero", {}, [
          makeNode("heading", "title", { size: 32, color: "#000000" }),
          makeNode("text", "subtitle", { color: "#333333" }),
        ]),
        makeNode("section", "features", {}, [
          makeNode("card", "feature1", { background: "#f5f5f5" }),
          makeNode("card", "feature2", { background: "#f5f5f5" }),
        ]),
      ]),
    ],
    components: [],
    diagnostics: [],
  };
}

// ---------- skip if Ollama unavailable ----------

let ollamaAvailable = false;

beforeAll(async () => {
  const result = await health();
  ollamaAvailable = result.ok;
  if (!ollamaAvailable) {
    console.warn("⚠ Ollama not running or qwen2.5:3b not installed — skipping E2E tests");
  }
});

// ---------- E2E tests ----------

describe("E2E: health", () => {
  it("detects running Ollama and qwen2.5:3b", async () => {
    if (!ollamaAvailable) return;
    const result = await health();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.models.some((m) => m.name.includes("qwen2.5"))).toBe(true);
    }
  });
});

describe("E2E: proposeIntent", () => {
  it("generates valid PatchOps from 'make the hero title blue'", async () => {
    if (!ollamaAvailable) return;

    const project = sampleProject();
    const provider = createOllamaProvider("qwen2.5:3b");

    const proposal = await proposeIntent(
      "make the hero title blue",
      project,
      provider,
    );

    expect(proposal.patch.ops.length).toBeGreaterThan(0);
    const validation = validateOps(proposal.patch.ops);
    expect(validation.ok).toBe(true);

    // Should target the title node
    const ops = proposal.patch.ops;
    const hasTitleTarget = ops.some(
      (op) => "target" in op && op.target.includes("title"),
    );
    expect(hasTitleTarget).toBe(true);
  }, 60000);

  it("generates valid PatchOps from 'make the subtitle bigger'", async () => {
    if (!ollamaAvailable) return;

    const project = sampleProject();
    const provider = createOllamaProvider("qwen2.5:3b");

    const proposal = await proposeIntent(
      "make the subtitle bigger",
      project,
      provider,
    );

    expect(proposal.patch.ops.length).toBeGreaterThan(0);
    const validation = validateOps(proposal.patch.ops);
    expect(validation.ok).toBe(true);
  }, 60000);
});

describe("E2E: describeToPatch", () => {
  it("generates PatchOps from DSL diff", async () => {
    if (!ollamaAvailable) return;

    const project = sampleProject();
    const provider = createOllamaProvider("qwen2.5:3b");

    const proposal = await describeToPatch(
      'heading title { size: 48, color: #ff0000 }',
      'heading title { size: 32, color: #000000 }',
      project,
      provider,
    );

    expect(proposal.patch.ops.length).toBeGreaterThan(0);
    const validation = validateOps(proposal.patch.ops);
    expect(validation.ok).toBe(true);
  }, 60000);
});

describe("E2E: reviewProject", () => {
  it("returns feedback for a sample project", async () => {
    if (!ollamaAvailable) return;

    const project = sampleProject();
    const provider = createOllamaProvider("qwen2.5:3b");

    const result = await reviewProject(project, provider);

    expect(result.issues.length).toBeGreaterThanOrEqual(0);
    expect(typeof result.modelSourced).toBe("boolean");
  }, 60000);
});

describe("E2E: Bhasm integration", () => {
  it("createBhasm() returns a working client", async () => {
    if (!ollamaAvailable) return;

    const bhasm = createBhasm();

    // Health check
    const healthResult = await bhasm.health();
    expect(healthResult.ok).toBe(true);

    // Status
    const status = await bhasm.status();
    expect(status.model).toContain("qwen2.5");

    // Propose patch
    const project = sampleProject();
    const proposal = await bhasm.proposePatch("make the hero title red", project);
    expect(proposal.patch.ops.length).toBeGreaterThan(0);
    const validation = validateOps(proposal.patch.ops);
    expect(validation.ok).toBe(true);
  }, 60000);
});
