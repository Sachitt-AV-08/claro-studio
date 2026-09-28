import { describe, it, expect, vi, afterEach } from "vitest";
import {
  mcpSidecarRunning,
  mcpCallTool,
  graphifyGraphSummary,
} from "./mcp.ts";

/** Stub window.electronAPI the same way graph.test.ts does. */
function stubApi(api: Record<string, unknown>) {
  vi.stubGlobal("window", {
    electronAPI: api,
    dispatchEvent: () => true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const bad = (msg: string) => ({ ok: false, error: msg });
const good = (text: string) => ({ ok: true, text });

describe("mcp bridge — graceful degradation", () => {
  it("reports not-running when the bridge is absent", async () => {
    expect(await mcpSidecarRunning()).toBe(false);
  });

  it("returns a clear error when claroMcpCall is missing", async () => {
    stubApi({ claroMcpStatus: async () => ({ ok: true, running: true }) });
    const r = await mcpCallTool("graph_stats");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("unavailable");
  });

  it("calls the tool and returns text on ok", async () => {
    const call = vi.fn(async () => good("pages=2 edges=9"));
    stubApi({ claroMcpCall: call });
    const r = await mcpCallTool("graph_stats");
    expect(r).toEqual({ ok: true, text: "pages=2 edges=9" });
    expect(call).toHaveBeenCalledWith("graph_stats", {});
  });
});

describe("mcp retry/backoff", () => {
  it("retries a transient failure once and succeeds before the limit", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(bad("sidecar starting"))
      .mockResolvedValueOnce(good("pages=1"));
    stubApi({ claroMcpCall: call });
    const r = await mcpCallTool("graph_stats", {}, { attempts: 3, baseDelayMs: 5 });
    expect(r.ok).toBe(true);
    expect(r.text).toBe("pages=1");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("gives up after attempts and reports the last error", async () => {
    const call = vi.fn(async () => bad("boom"));
    stubApi({ claroMcpCall: call });
    const r = await mcpCallTool("graph_stats", {}, { attempts: 2, baseDelayMs: 1 });
    expect(call).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("boom");
  });

  it("recovers from a thrown rejection", async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error("ipc lost"))
      .mockResolvedValueOnce(good("pages=3"));
    stubApi({ claroMcpCall: call });
    const r = await mcpCallTool("graph_stats", {}, { attempts: 2, baseDelayMs: 1 });
    expect(r.ok).toBe(true);
    expect(r.text).toBe("pages=3");
  });
});

describe("graphifyGraphSummary", () => {
  it("returns null when the sidecar is down", async () => {
    stubApi({ claroMcpStatus: async () => ({ ok: false, running: false }) });
    expect(await graphifyGraphSummary()).toBeNull();
  });

  it("returns the first line of graph_stats", async () => {
    stubApi({
      claroMcpStatus: async () => ({ ok: true, running: true }),
      claroMcpCall: async (name: string) =>
        name === "graph_stats" ? good("pages=2 edges=9\nmore") : bad("unknown"),
    });
    expect(await graphifyGraphSummary()).toBe("pages=2 edges=9");
  });
});