import { describe, it, expect, vi } from "vitest";
import type { ModelProvider, ModelStatus, Completion } from "@project/contracts";
import {
  createOllamaDecisionLayer,
  ladderStep,
  DEFAULT_ACT_THRESHOLD,
  DEFAULT_ASK_THRESHOLD,
} from "../src/decisions.js";

function mockProvider(op: (call: number) => unknown | Promise<unknown>): ModelProvider & { calls: () => number } {
  let calls = 0;
  return {
    id: "mock",
    calls() {
      return calls;
    },
    async isInstalled() {
      return true;
    },
    async complete(_s: string, user: string): Promise<Completion> {
      calls++;
      return { text: JSON.stringify(await op(calls)), latencyMs: 5, model: "mock" };
    },
    async structuredComplete<T>(_s: string, _u: string): Promise<T> {
      calls++;
      return (await op(calls)) as T;
    },
    async status(): Promise<ModelStatus> {
      return { model: "mock", loaded: true };
    },
  };
}

describe("ladderStep", () => {
  it("escalates to fallback below the ask threshold", () => {
    expect(ladderStep(0.5)).toBe("fallback");
  });
  it("escalates to ask between ask and act thresholds", () => {
    expect(ladderStep(DEFAULT_ASK_THRESHOLD)).toBe("ask");
    expect(ladderStep(0.8)).toBe("ask");
  });
  it("acts at or above the act threshold", () => {
    expect(ladderStep(DEFAULT_ACT_THRESHOLD)).toBe("act");
    expect(ladderStep(0.95)).toBe("act");
  });
  it("uses configured thresholds", () => {
    expect(ladderStep(0.7, 0.8, 0.6)).toBe("ask");
    expect(ladderStep(0.85, 0.8, 0.6)).toBe("act");
  });
});

describe("createOllamaDecisionLayer", () => {
  const req = {
    task: "route" as const,
    state: { mode: "code", input: "make the hero red" },
    choices: [{ id: "propose_patch", description: "propose an edit" }, { id: "review" }],
  };

  it("returns a valid decision for a schema-conforming response", async () => {
    const provider = mockProvider(() => ({ choice: "propose_patch", probability: 0.94, reason: "edit request" }));
    const layer = createOllamaDecisionLayer(provider);
    const r = await layer.decide(req);
    expect(r.valid).toBe(true);
    expect(r.choice).toBe("propose_patch");
    expect(r.probability).toBe(0.94);
    expect(r.reason).toBe("edit request");
    expect(r.provider).toBe("local");
  });

  it("clamps probability into 0..1", async () => {
    const provider = mockProvider(() => ({ choice: "review", probability: 1.7 }));
    const r = await createOllamaDecisionLayer(provider).decide(req);
    expect(r.valid).toBe(true);
    expect(r.probability).toBe(1);
  });

  it("marks a decision invalid when the choice is not in the schema", async () => {
    const provider = mockProvider(() => ({ choice: "delete_database", probability: 0.9 }));
    const r = await createOllamaDecisionLayer(provider).decide(req);
    expect(r.valid).toBe(false);
    expect(r.choice).toBe("delete_database");
  });

  it("retries once on a broken first response, then succeeds on repair", async () => {
    const provider = mockProvider((call) =>
      call === 1 ? { choice: 42 } : { choice: "review", probability: 0.7 },
    );
    const r = await createOllamaDecisionLayer(provider).decide(req);
    expect(r.valid).toBe(true);
    expect(r.choice).toBe("review");
    expect(provider.calls()).toBe(2);
  });

  it("gives up after two bad responses and falls back to invalid", async () => {
    const bad = mockProvider(() => { throw new Error("ollama down"); });
    const r = await createOllamaDecisionLayer(bad).decide(req);
    expect(r.valid).toBe(false);
    expect(r.provider).toBe("local");
    expect(r.choice).toBe(req.choices[0].id);
  });

  it("keeps the heuristic hint as the fallback choice on failure", async () => {
    const bad = mockProvider(() => { throw new Error("offline"); });
    const r = await createOllamaDecisionLayer(bad).decide({ ...req, hint: "propose_patch" });
    expect(r.valid).toBe(false);
    expect(r.choice).toBe("propose_patch");
  });

  it("never throws to the caller", async () => {
    const explode = mockProvider(() => { throw new Error("boom"); });
    const layer = createOllamaDecisionLayer(explode as never as ModelProvider);
    await expect(layer.decide(req)).resolves.toBeDefined();
  });

  it("truncates long reasons", async () => {
    const provider = mockProvider(() => ({ choice: "review", probability: 0.8, reason: "x".repeat(500) }));
    const r = await createOllamaDecisionLayer(provider).decide(req);
    expect(r.reason!.length).toBeLessThanOrEqual(160);
  });

  it("accepts a cast provider that returns reject (guardrail shape)", async () => {
    const provider = mockProvider(() => ({ choice: "reject", probability: 0.97 }));
    const layer = createOllamaDecisionLayer(provider);
    const r = await layer.decide({
      task: "guardrail",
      state: { patch: "remove_element main.nav" },
      choices: [{ id: "approve" }, { id: "reject" }],
    });
    expect(r.valid).toBe(true);
    expect(r.choice).toBe("reject");
  });
});