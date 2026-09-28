/**
 * Edge-AI metrics — live telemetry for Claro Decisions.
 *
 * Every decision outcome (route / guardrail / classify) publishes one sample.
 * The BHASM panel renders the aggregates so the Edge-AI story is provable:
 * "X of Y decisions were answered on-device without waking the 3B model."
 *
 * Windowed ring (default 200) so memory stays flat; no persistence.
 */

import { create } from "zustand";

export type MetricProvider = "gate" | "embed" | "local" | "fallback";

export interface DecisionMetric {
  id: number;
  task: "route" | "guardrail" | "classify";
  provider: MetricProvider;
  /** true when the Claro Gate / embedding prior answered WITHOUT the 3B model */
  skippedModel: boolean;
  latencyMs: number;
  probability: number;
  ts: number;
}

export interface MetricAggregate {
  total: number;
  /** decisions answered without the LLM (gate + embed) */
  onDevice: number;
  /** decisions that woke the 3B model */
  wokeModel: number;
  fallback: number;
  skippedRate: number; // 0..1
  avgLatencyMs: number;
  p50LatencyMs: number;
  last?: DecisionMetric;
  samples: DecisionMetric[];
}

interface MetricsState {
  id: number;
  epoch: number;
  samples: DecisionMetric[];
  record: (s: Omit<DecisionMetric, "id" | "ts">) => void;
  reset: () => void;
}

const WINDOW = 200;

function p50(latencies: number[]): number {
  if (!latencies.length) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export const useMetricsStore = create<MetricsState>((set, get) => ({
  id: 0,
  epoch: 1,
  samples: [],
  record(s) {
    const id = get().id + 1;
    const sample: DecisionMetric = { ...s, id, ts: Date.now() };
    const samples = [...get().samples, sample].slice(-WINDOW);
    set({ id, samples });
  },
  reset() {
    set({ id: 0, samples: [], epoch: get().epoch + 1 });
  },
}));

/** Aggregates over the current window. */
export function edgeMetrics(): MetricAggregate {
  const samples = useMetricsStore.getState().samples;
  const total = samples.length;
  if (!total) {
    return {
      total: 0,
      onDevice: 0,
      wokeModel: 0,
      fallback: 0,
      skippedRate: 0,
      avgLatencyMs: 0,
      p50LatencyMs: 0,
      samples,
    };
  }
  const onDevice = samples.filter((s) => s.skippedModel).length;
  const wokeModel = samples.filter((s) => s.provider === "local").length;
  const fallback = samples.filter((s) => s.provider === "fallback").length;
  const latencies = samples.map((s) => s.latencyMs);
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  return {
    total,
    onDevice,
    wokeModel,
    fallback,
    skippedRate: onDevice / total,
    avgLatencyMs: avg,
    p50LatencyMs: p50(latencies),
    last: samples[samples.length - 1],
    samples,
  };
}