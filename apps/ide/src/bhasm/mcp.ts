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

export interface McpRetryOptions {
  /** attempts (including the first call), default 3 */
  attempts?: number;
  /** base backoff ms, doubled per retry, default 150 */
  baseDelayMs?: number;
}

const DEFAULTS: Required<McpRetryOptions> = { attempts: 3, baseDelayMs: 150 };

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
export async function mcpCallTool(
  name: string,
  args: Record<string, unknown> = {},
  opts: McpRetryOptions = {},
): Promise<McpCallResult> {
  const api = bridge();
  if (!api?.claroMcpCall) return { ok: false, error: "graphify MCP bridge unavailable (run inside the IDE)" };

  const { attempts, baseDelayMs } = { ...DEFAULTS, ...opts };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const r = await api.claroMcpCall(name, args);
      if (r.ok || attempt === attempts) {
        return r.ok ? { ok: true, text: r.text } : { ok: false, error: r.error };
      }
    } catch (e) {
      if (attempt === attempts) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    await sleep(baseDelayMs * 2 ** (attempt - 1));
  }
  return { ok: false, error: `graphify MCP call "${name}" failed` };
}

/** Best-effort one-line summary of the project graph (for prompt grounding). */
export async function graphifyGraphSummary(): Promise<string | null> {
  const running = await mcpSidecarRunning();
  if (!running) return null;
  const stats = await mcpCallTool("graph_stats", {}, { attempts: 2, baseDelayMs: 100 });
  if (!stats.ok || !stats.text) return null;
  const first = stats.text.split("\n")[0] ?? "";
  return first.trim() || null;
}