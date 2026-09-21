import { describe, it, expect, vi } from "vitest";
import type { Project, DslNode, ModelProvider, Completion, ModelStatus, PatchProposal } from "@project/contracts";
import { validateOps } from "@project/contracts";
import { health, createOllamaProvider } from "../src/ollama.js";
import { applyOps, prop } from "../src/patches.js";
import { buildContext, proposeIntent } from "../src/intent.js";
import { describeToPatch } from "../src/toPatch.js";
import { reviewProject } from "../src/review.js";

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
        return [k, v];
      }),
    ),
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
  // assign nodeIds
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

function brokenProject(): Project {
  return {
    meta: { version: "1.0", fileType: ".cl" },
    pages: [
      makePage("Home", [
        makeNode("section", "hero", {}, [
          makeNode("heading", "title", { text: "Welcome" }),
          makeNode("button", "cta", {}), // no text — should trigger accessibility rule
        ]),
      ]),
    ],
    components: [],
    diagnostics: [],
  };
}

// ---------- mock provider ----------

function mockProvider(response: unknown): ModelProvider {
  return {
    id: "mock",
    async isInstalled() {
      return true;
    },
    async complete(_sys: string, user: string): Promise<Completion> {
      return { text: JSON.stringify(response), latencyMs: 10, model: "mock" };
    },
    async structuredComplete<T>(_sys: string, _user: string, _shape: Record<string, unknown>): Promise<T> {
      return response as T;
    },
    async status(): Promise<ModelStatus> {
      return { model: "mock", loaded: true };
    },
  };
}

// ---------- tests ----------

describe("health", () => {
  it("returns ok: true when Ollama is reachable", async () => {
    const result = await health();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.models.length).toBeGreaterThan(0);
      expect(result.models[0].name).toContain("qwen2.5");
    }
  });
});

describe("applyOps (stub)", () => {
  it("applies set_property and returns inverse", () => {
    const project = sampleProject();
    const titleId = project.pages[0].children[0].children[0].nodeId; // hero.title
    const result = applyOps(project.pages, [
      { op: "set_property", target: titleId, property: "color", value: { t: "color", v: "#ff0000" } },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.inverse.length).toBe(1);
      expect(result.inverse[0].op).toBe("set_property");
    }
  });

  it("applies set_text and returns inverse", () => {
    const project = sampleProject();
    const titleId = project.pages[0].children[0].children[0].nodeId;
    const result = applyOps(project.pages, [
      { op: "set_text", target: titleId, value: "New Title" },
    ]);
    expect(result.ok).toBe(true);
  });

  it("applies remove_element", () => {
    const project = sampleProject();
    const titleId = project.pages[0].children[0].children[0].nodeId;
    const result = applyOps(project.pages, [
      { op: "remove_element", target: titleId },
    ]);
    expect(result.ok).toBe(true);
  });

  it("returns error for missing target", () => {
    const project = sampleProject();
    const result = applyOps(project.pages, [
      { op: "set_property", target: "nonexistent", property: "color", value: { t: "color", v: "#000" } },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
    }
  });
});

describe("validateOps", () => {
  it("accepts valid ops", () => {
    const result = validateOps([
      { op: "set_property", target: "a.b", property: "color", value: { t: "color", v: "#000" } },
    ]);
    expect(result.ok).toBe(true);
  });

  it("rejects missing target", () => {
    const result = validateOps([
      { op: "set_property", target: "", property: "color", value: { t: "color", v: "#000" } },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe("buildContext", () => {
  it("flattens project into context", () => {
    const project = sampleProject();
    const ctx = buildContext(project);
    expect(ctx.file).toBe("current.cl");
    expect(Object.keys(ctx.idMap).length).toBeGreaterThan(0);
    expect(ctx.astJson).toContain("heading");
  });
});

describe("proposeIntent", () => {
  it("generates valid PatchOps from a canned sentence", async () => {
    const project = sampleProject();
    const titleId = project.pages[0].children[0].children[0].nodeId;

    const mockResponse = {
      summary: "Make hero title bigger and red",
      ops: [
        { op: "set_property", target: titleId, property: "size", value: { t: "num", v: 48 } },
        { op: "set_property", target: titleId, property: "color", value: { t: "color", v: "#ff0000" } },
      ],
    };

    const proposal = await proposeIntent(
      "make the hero title bigger and red",
      project,
      mockProvider(mockResponse),
    );

    expect(proposal.patch.ops.length).toBe(2);
    const validation = validateOps(proposal.patch.ops);
    expect(validation.ok).toBe(true);
  });
});

describe("describeToPatch", () => {
  it("generates valid PatchOps from intended source", async () => {
    const project = sampleProject();
    const titleId = project.pages[0].children[0].children[0].nodeId;

    const mockResponse = {
      summary: "Change title to blue",
      ops: [
        { op: "set_property", target: titleId, property: "color", value: { t: "color", v: "#0000ff" } },
      ],
    };

    const proposal = await describeToPatch(
      'heading title "Welcome to Claro" { color: #0000ff }',
      'heading title "Welcome to Claro" { color: #000000 }',
      project,
      mockProvider(mockResponse),
    );

    expect(proposal.patch.ops.length).toBe(1);
    const validation = validateOps(proposal.patch.ops);
    expect(validation.ok).toBe(true);
  });
});

describe("reviewProject", () => {
  it("flags button with no text via rules engine", async () => {
    const project = brokenProject();
    const result = await reviewProject(project);
    expect(result.issues.length).toBeGreaterThan(0);
    const buttonIssue = result.issues.find(
      (i) => i.rule === "accessibility" && i.nodeId?.includes("cta"),
    );
    expect(buttonIssue).toBeDefined();
    expect(buttonIssue!.severity).toBe("error");
    expect(buttonIssue!.fix).toBeDefined();
    expect(buttonIssue!.fix!.ops.length).toBeGreaterThan(0);
  });

  it("includes LLM feedback when provider is given", async () => {
    const project = sampleProject();
    const mockResponse = {
      feedback: "The layout looks good. Consider adding more spacing.",
      suggestions: ["Add padding to sections", "Use consistent colors"],
    };
    const result = await reviewProject(project, mockProvider(mockResponse));
    expect(result.modelSourced).toBe(true);
    const llmIssue = result.issues.find((i) => i.id === "llm-feedback");
    expect(llmIssue).toBeDefined();
    expect(llmIssue!.message).toContain("spacing");
  });

  it("returns clean result for well-formed project", async () => {
    const project = sampleProject();
    const result = await reviewProject(project);
    // sampleProject has no buttons (which need text), so expect 0 errors
    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors.length).toBe(0);
  });
});
