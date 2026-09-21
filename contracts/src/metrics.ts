/** System / edge-AI status surface — the offline-proof widget. */
export interface MetricsSnapshot {
  network: "online" | "offline";
  model: string | null;
  modelLoaded: boolean;
  latencyMs: number | null;
  cpuPercent: number;
  ramUsedGb: number;
  ramTotalGb: number;
  gpuPercent: number | null;
  vramUsedMiB: number | null;
  vramTotalMiB: number | null;
  ts: number;
}