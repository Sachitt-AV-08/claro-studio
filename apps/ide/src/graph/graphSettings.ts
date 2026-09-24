/**
 * Bhasm graph settings (persisted to <app>/settings/bhasm.json) plus
 * graph.json discovery helpers for the renderer.
 *
 * There is no central settings store — consumers read/write JSON namespaces
 * via claroSettingsGet/Set IPC (same pattern as settings.json). Saving fires
 * `claro:settings-changed` so the MCP sidecar wiring re-reads it.
 */

export interface DecisionConfig {
  /** Ollama model used for routing/guardrail decisions */
  model: string;
  /** confidence ≥ act → caller should act autonomously */
  act: number;
  /** confidence ≥ ask → caller should escalate (else fallback path) */
  ask: number;
}

export interface BhasmGraphSettings {
  /** absolute path to a graphify graph.json (preferred source) */
  graphJson?: string;
  /** python executable that can run `python -m graphify.serve` */
  python?: string;
  /** auto-start the sidecar when a graph is available */
  autoStart: boolean;
  /** inject query_graph results into BHASM user prompts */
  graphAssist: boolean;
  /** JEV-style decision layer tuning */
  decision: DecisionConfig;
}

export const DEFAULT_BHASM_GRAPH: BhasmGraphSettings = {
  autoStart: true,
  graphAssist: true,
  decision: { model: "qwen2.5:3b", act: 0.9, ask: 0.6 },
};

const api = () => (typeof window !== "undefined" ? window.electronAPI : undefined);

const readNum = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

function mergeDecision(saved: Record<string, unknown> | undefined): DecisionConfig {
  const d = (saved?.decision ?? {}) as Record<string, unknown>;
  let act = readNum(d.act, DEFAULT_BHASM_GRAPH.decision.act);
  let ask = readNum(d.ask, DEFAULT_BHASM_GRAPH.decision.ask);
  if (act < ask) {
    const tmp = act;
    act = ask;
    ask = tmp;
  }
  return {
    model: typeof d.model === "string" && d.model ? d.model : DEFAULT_BHASM_GRAPH.decision.model,
    act,
    ask,
  };
}

function merge(saved: Record<string, unknown> | undefined): BhasmGraphSettings {
  return {
    graphJson: typeof saved?.graphJson === "string" && saved.graphJson ? saved.graphJson : undefined,
    python: typeof saved?.python === "string" && saved.python ? saved.python : undefined,
    autoStart: typeof saved?.autoStart === "boolean" ? saved.autoStart : DEFAULT_BHASM_GRAPH.autoStart,
    graphAssist: typeof saved?.graphAssist === "boolean" ? saved.graphAssist : DEFAULT_BHASM_GRAPH.graphAssist,
    decision: mergeDecision(saved),
  };
}

export async function loadBhasmGraphSettings(): Promise<BhasmGraphSettings> {
  try {
    const saved = await api()?.claroSettingsGet("bhasm.json");
    return merge(saved as Record<string, unknown> | undefined);
  } catch {
    return { ...DEFAULT_BHASM_GRAPH };
  }
}

export async function saveBhasmGraphSettings(patch: Partial<BhasmGraphSettings>): Promise<{ ok: boolean; error?: string }> {
  const current = await loadBhasmGraphSettings();
  const next = { ...current, ...patch };
  try {
    const res = await api()?.claroSettingsSet("bhasm.json", {
      ...(next.graphJson ? { graphJson: next.graphJson } : {}),
      ...(next.python ? { python: next.python } : {}),
      autoStart: next.autoStart,
      graphAssist: next.graphAssist,
      decision: next.decision,
    });
    if (res?.ok === false) return { ok: false, error: res.error };
    window.dispatchEvent(new Event("claro:settings-changed"));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Naive dirname (no `path` in the renderer): strips the last path segment. */
export function dirnameOf(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  const dir = idx >= 0 ? norm.slice(0, idx) : ".";
  return dir || "/";
}

/**
 * Where to look for a graphify graph.json, in priority order:
 *   1. explicitly-configured settings.graphJson
 *   2. next to an opened Claro file: ./graph.json, ./graphify-out/graph.json, ./ .graphify/graph.json
 * Existence checks happen in the main process (claro:mcp:discover / start).
 */
export function graphDiscoveryCandidates(opts: { explicit?: string; filePath?: string }): string[] {
  const out: string[] = [];
  if (opts.explicit) out.push(opts.explicit);
  if (opts.filePath) {
    const dir = dirnameOf(opts.filePath);
    out.push(`${dir}/graph.json`, `${dir}/graphify-out/graph.json`, `${dir}/.graphify/graph.json`);
  }
  return out;
}

/**
 * Resolve the best graph.json to connect to: settings explicit path, else ask
 * the main process which candidate exists on disk next to the opened file.
 */
export async function discoverGraphJson(filePath?: string): Promise<string | null> {
  const settings = await loadBhasmGraphSettings();
  if (settings.graphJson) return settings.graphJson;
  if (!filePath) return null;
  const dir = dirnameOf(filePath);
  const found = await api()?.claroMcpDiscover(dir);
  return found ?? null;
}