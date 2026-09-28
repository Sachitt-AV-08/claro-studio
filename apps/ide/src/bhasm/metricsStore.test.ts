import { describe, it, expect, beforeEach } from "vitest";
import { useMetricsStore, edgeMetrics } from "./metricsStore";

describe("metricsStore", () => {
  beforeEach(() => useMetricsStore.getState().reset());

  it("starts empty", () => {
    expect(edgeMetrics().total).toBe(0);
    expect(edgeMetrics().skippedRate).toBe(0);
  });

  it("counts on-device (skippedModel) decisions separately from model wakes", () => {
    const record = useMetricsStore.getState().record;
    record({ task: "route", provider: "gate", skippedModel: true, latencyMs: 3, probability: 0.9 });
    record({ task: "route", provider: "embed", skippedModel: true, latencyMs: 8, probability: 0.72 });
    record({ task: "classify", provider: "local", skippedModel: false, latencyMs: 210, probability: 0.95 });

    const m = edgeMetrics();
    expect(m.total).toBe(3);
    expect(m.onDevice).toBe(2);
    expect(m.wokeModel).toBe(1);
    expect(m.fallback).toBe(0);
    expect(m.skippedRate).toBeCloseTo(2 / 3);
    expect(m.avgLatencyMs).toBeCloseTo((3 + 8 + 210) / 3);
  });

  it("counts fallback and keeps last sample", () => {
    const record = useMetricsStore.getState().record;
    record({ task: "guardrail", provider: "fallback", skippedModel: true, latencyMs: 0, probability: 0 });
    const m = edgeMetrics();
    expect(m.fallback).toBe(1);
    expect(m.last?.provider).toBe("fallback");
    expect(m.last?.task).toBe("guardrail");
  });

  it("windows the sample array", () => {
    const record = useMetricsStore.getState().record;
    for (let i = 0; i < 250; i++) {
      record({ task: "route", provider: "gate", skippedModel: true, latencyMs: 1, probability: 0.5 });
    }
    expect(useMetricsStore.getState().samples.length).toBe(200);
    expect(edgeMetrics().total).toBe(200);
  });
});