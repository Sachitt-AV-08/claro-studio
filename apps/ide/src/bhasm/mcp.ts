/**
 * Graphify MCP bridge from the renderer's BHASM runtime.
 *
 * The main process owns the GraphifyMcpClient sidecar (claro:mcp:* IPC); the
 * renderer treats it as best-effort: every function resolves to { ok:false, … }
 * when the sidecar is not running or the electron bridge is absent (e.g. plain
 * vite dev in a browser), so BHASM always degrades gracefully.
 */

export interface McpCallResult {
  ok: boolean;
  text?: string;
  error?: string;
}

function bridge(): Window["electronAPI"] | undefined {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

/** Is the graphify sidecar reachable right now? */
export async function mcpSidecarRunning(): Promise<boolean> {
  const api = bridge();
  if (!api?.claroMcpStatus) return false;
  try {
    const s = await api.claroMcpStatus();
    return s.ok && s.running;
  } catch {
    return false;
  }
}

/** Call a graphify MCP tool (query_graph / graph_stats / get_node / …). */
export async function mcpCallTool(name: string, args: Record<string, unknown> = {}): Promise<McpCallResult> {
  const api = bridge();
  if (!api?.claroMcpCall) return { ok: false, error: "graphify MCP bridge unavailable (run inside the IDE)" };
  try {
    const r = await api.claroMcpCall(name, args);
    return r.ok ? { ok: true, text: r.text } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Best-effort one-line summary of the project graph (for prompt grounding). */
export async function graphifyGraphSummary(): Promise<string | null> {
  const running = await mcpSidecarRunning();
  if (!running) return null;
  const stats = await mcpCallTool("graph_stats");
  if (!stats.ok || !stats.text) return null;
  const first = stats.text.split("\n")[0] ?? "";
  return first.trim() || null;
}