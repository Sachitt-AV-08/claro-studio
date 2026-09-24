import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ModelProvider, ModelStatus, Completion, PatchOp } from "@project/contracts";
import {
  heuristicHint,
  routeTool,
  guardrailOps,
  classifySeed,
  isConfidentReject,
  isConversational,
  shouldPropose,
  setDecisionProviderFactory,
  resetLayerCache,
} from "./decisions";
import { useDecisionStore } from "./decisionStore";
import type { BhasmGraphSettings } from "../graph/graphSettings";

function mockProvider(response: unknown): ModelProvider {
  return {
    id: "mock",
    async isInstalled() {
      return true;
    },
    async complete(_s: string, _u: string): Promise<Completion> {
      return { text: JSON.stringify(response), latencyMs: 5, model: "mock" };
    },
    async structuredComplete<T>(_s: string, _u: string): Promise<T> {
      if (response instanceof Error) throw response;
      return response as T;
    },
    async status(): Promise<ModelStatus> {
      return { model: "mock", loaded: true };
    },
  };
}

const cfg: BhasmGraphSettings = {
  autoStart: false,
  graphAssist: false,
  decision: { model: "qwen2.5:3b", act: 0.9, ask: 0.6 },
};

describe("heuristicHint", () => {
  it("sniffs review", () => {
    expect(heuristicHint("review", "Review the project for problems")).toBe("review");
  });
  it("sniffs propose patterns", () => {
    expect(heuristicHint("code", "add a hero section")).toBe("propose_patch");
  });
  it("sniffs graph queries", () => {
    expect(heuristicHint("ask", "where is the button used")).toBe("query_graph");
  });
  it("returns undefined for open-ended asks", () => {
    expect(heuristicHint("ask", "what does this codebase do")).toBeUndefined();
  });
});

describe("routeTool", () => {
  beforeEach(() => setDecisionProviderFactory(null));
  afterEach(() => {
    setDecisionProviderFactory(null);
    resetLayerCache();
    useDecisionStore.getState().clear();
  });

  const tools = ["propose_patch", "review"];

  it("falls back to the heuristic when no decision model is available", async () => {
    setDecisionProviderFactory(() => mockProvider(new Error("model unavailable")));
    const out = await routeTool("code", "review the project for risks", tools);
    expect(out.step).toBe("fallback");
    expect(out.choice).toBe("review");
    expect(out.result.provider).toBe("fallback");
  });

  it("acts on a confident local decision and publishes to the store", async () => {
    setDecisionProviderFactory(() => mockProvider({ choice: "propose_patch", probability: 0.93 }));
    const out = await routeTool("code", "add a hero section", tools);
    expect(out.choice).toBe("propose_patch");
    expect(out.step).toBe("act");
    expect(out.result.valid).toBe(true);
    expect(useDecisionStore.getState().lastRoute?.choice).toBe("propose_patch");
    expect(useDecisionStore.getState().lastRoute?.provider).toBe("local");
  });

  it("falls back when the routed choice is not available", async () => {
    setDecisionProviderFactory(() => mockProvider({ choice: "export_project", probability: 0.99 }));
    const out = await routeTool("code", "make it red", tools);
    // export_project isn't in the mode's tool list → deterministic pick wins
    expect(["propose_patch", "review"]).toContain(out.choice);
  });

  it("swallows provider errors", async () => {
    setDecisionProviderFactory(() => mockProvider(new Error("ollama down")));
    const out = await routeTool("code", "add a hero section", tools);
    expect(out.step).toBe("fallback");
  });
});

describe("guardrailOps", () => {
  beforeEach(() => setDecisionProviderFactory(null));
  afterEach(() => {
    setDecisionProviderFactory(null);
    resetLayerCache();
    useDecisionStore.getState().clear();
  });

  const ops = [{ op: "remove_element", target: "home.nav" }] as PatchOp[];

  it("approves by default without a model (no regression)", async () => {
    setDecisionProviderFactory(() => mockProvider(new Error("model unavailable")));
    const r = await guardrailOps(ops);
    expect(r.choice).toBe("approve");
    expect(r.valid).toBe(false);
  });

  it("rejects with high confidence when the model says so", async () => {
    setDecisionProviderFactory(() => mockProvider({ choice: "reject", probability: 0.97, reason: "removing the nav is risky" }));
    const r = await guardrailOps(ops);
    expect(r.valid).toBe(true);
    expect(r.choice).toBe("reject");
    expect(r.reason).toContain("nav");
    expect(isConfidentReject(r, cfg)).toBe(true);
    expect(useDecisionStore.getState().lastGuardrail?.choice).toBe("reject");
  });

  it("does not block a low-confidence reject", async () => {
    setDecisionProviderFactory(() => mockProvider({ choice: "reject", probability: 0.5 }));
    const r = await guardrailOps(ops);
    expect(r.valid).toBe(true);
    expect(r.choice).toBe("reject");
    expect(isConfidentReject(r, cfg)).toBe(false);
  });
});

describe("classifySeed", () => {
  beforeEach(() => setDecisionProviderFactory(null));
  afterEach(() => {
    setDecisionProviderFactory(null);
    resetLayerCache();
  });

  it("defaults to explain-comment when the model is unavailable", async () => {
    setDecisionProviderFactory(() => mockProvider(new Error("model unavailable")));
    const out = await classifySeed("make the hero pop");
    expect(out.mode).toBe("explain-comment");
  });

  it("switches to the classified mode on a confident act", async () => {
    setDecisionProviderFactory(() => mockProvider({ choice: "code", probability: 0.95 }));
    const out = await classifySeed("add a hero component");
    expect(out.mode).toBe("code");
  });

  it("keeps explain-comment on a mid-confidence classification", async () => {
    setDecisionProviderFactory(() => mockProvider({ choice: "code", probability: 0.7 }));
    const out = await classifySeed("add a hero component");
    expect(out.mode).toBe("explain-comment");
  });
});

describe("isConversational", () => {
  it.each(["hi", "hello", "Hey!", "thanks", "thank you", "ok", "what can you do?", "nice"])(
    "treats %s as chat",
    (input) => expect(isConversational(input)).toBe(true),
  );

  it.each([
    "hi, add a hero button",
    "hello, make the nav red",
    "thanks, now review the project",
    "hey, change the header",
    "update the hero",
  ])("rejects %s because it also carries work intent", (input) => {
    expect(isConversational(input)).toBe(false);
  });

  it("rejects blank or long input", () => {
    expect(isConversational("")).toBe(false);
    expect(isConversational(" ".repeat(80))).toBe(false);
    expect(isConversational("hi ".repeat(30))).toBe(false);
  });
});

describe("shouldPropose", () => {
  beforeEach(() => setDecisionProviderFactory(null));
  afterEach(() => {
    setDecisionProviderFactory(null);
    resetLayerCache();
  });

  it("is false without a model", async () => {
    setDecisionProviderFactory(() => mockProvider(new Error("model unavailable")));
    expect(await shouldPropose("make the hero pop")).toBe(false);
  });

  it("proposes when the model is confidently actionable", async () => {
    setDecisionProviderFactory(() => mockProvider({ choice: "propose", probability: 0.95 }));
    expect(await shouldPropose("add a submit handler to the form")).toBe(true);
  });

  it("explains (no ops) on mid-confidence or ask-classified ideas", async () => {
    setDecisionProviderFactory(() => mockProvider({ choice: "explain", probability: 0.95 }));
    expect(await shouldPropose("what does the hero do")).toBe(false);
  });
});