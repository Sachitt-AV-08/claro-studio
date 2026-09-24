/**
 * Renderer-side graphify MCP sidecar state.
 *
 * The main process owns the GraphifyMcpClient; this store is the renderer's
 * single source of truth for {running, python, graphJson, tools}. The App and
 * BhasmPanel read it; every action degrades to { ok:false } when the electron
 * bridge (or python/graphify) isn't available, so the IDE works offline.
 */
import { create } from "zustand";

export interface McpStatus {
  ok: boolean;
  running: boolean;
  python?: string;
  graphJson?: string;
  tools?: string[];
  error?: string;
}

export interface McpStartOptions {
  graphJson: string;
  python?: string;
}

const api = () => (typeof window !== "undefined" ? window.electronAPI : undefined);

interface McpState {
  status: McpStatus | null;
  busy: boolean;
  refresh: () => Promise<McpStatus>;
  start: (opts: McpStartOptions) => Promise<{ ok: boolean; error?: string }>;
  stop: () => Promise<void>;
  toggle: (opts?: McpStartOptions) => Promise<void>;
}

export const useMcpStore = create<McpState>((set, get) => ({
  status: null,
  busy: false,

  async refresh() {
    let status: McpStatus;
    try {
      status = (await api()?.claroMcpStatus()) ?? { ok: false, running: false, error: "MCP bridge unavailable" };
    } catch (e) {
      status = { ok: false, running: false, error: e instanceof Error ? e.message : String(e) };
    }
    set({ status });
    return status;
  },

  async start(opts) {
    if (!api()?.claroMcpStart) {
      const status = { ok: false, running: false, error: "graphify MCP bridge unavailable (run inside the IDE)" };
      set({ status });
      return { ok: false, error: status.error };
    }
    set({ busy: true });
    try {
      const res = await api()!.claroMcpStart!(opts);
      set({ status: res, busy: false });
      return res.ok ? { ok: true } : { ok: false, error: res.error ?? "graphify serve failed to start" };
    } catch (e) {
      set({ status: { ok: false, running: false, error: e instanceof Error ? e.message : String(e) }, busy: false });
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  async stop() {
    try {
      await api()?.claroMcpStop();
    } catch {
      /* ignore */
    }
    await get().refresh();
  },

  async toggle(opts) {
    const current = get().status ?? (await get().refresh());
    if (current.running) {
      await get().stop();
    } else if (opts?.graphJson) {
      await get().start(opts);
    }
  },
}));