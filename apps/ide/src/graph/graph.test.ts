import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  graphDiscoveryCandidates,
  dirnameOf,
  loadBhasmGraphSettings,
  saveBhasmGraphSettings,
} from "./graphSettings";
import { useMcpStore } from "./mcpStore";

type AnyApi = Record<string, unknown>;

function stubApi(api: Record<string, unknown>) {
  vi.stubGlobal("window", {
    electronAPI: api,
    dispatchEvent: (api.dispatchEvent as ((e: Event) => boolean) | undefined) ?? (() => true),
  });
}

/** Read the electron bridge back from the stubbed global (typed without Walking the lib Window). */
function testApi(): Record<string, unknown> {
  const w = globalThis as unknown as { window?: { electronAPI?: Record<string, unknown> } };
  return w.window?.electronAPI ?? {};
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("dirnameOf", () => {
  it("strips the trailing segment and normalizes backslashes", () => {
    expect(dirnameOf("C:\\proj\\src\\a.cl")).toBe("C:/proj/src");
    expect(dirnameOf("/root/a.cl")).toBe("/root");
    expect(dirnameOf("a.cl")).toBe(".");
  });
});

describe("graphDiscoveryCandidates", () => {
  it("returns the explicit path first, then file-relative candidates", () => {
    const c = graphDiscoveryCandidates({ explicit: "z/b.json", filePath: "D:/ide/app/layout.cl" });
    expect(c[0]).toBe("z/b.json");
    expect(c).toContain("D:/ide/app/graph.json");
    expect(c).toContain("D:/ide/app/graphify-out/graph.json");
    expect(c).toContain("D:/ide/app/.graphify/graph.json");
  });

  it("returns nothing when there is no explicit path and no file", () => {
    expect(graphDiscoveryCandidates({})).toEqual([]);
  });
});

describe("loadBhasmGraphSettings", () => {
  beforeEach(() => {
    stubApi({ claroSettingsGet: vi.fn(async () => undefined) });
  });

  it("falls back to defaults on empty storage", async () => {
    const s = await loadBhasmGraphSettings();
    expect(s.autoStart).toBe(true);
    expect(s.graphAssist).toBe(true);
    expect(s.graphJson).toBeUndefined();
  });

  it("merges stored booleans and drops empty paths", async () => {
    stubApi({
      claroSettingsGet: vi.fn(async () => ({ autoStart: false, graphJson: "", python: "" })),
    });
    const s = await loadBhasmGraphSettings();
    expect(s.autoStart).toBe(false);
    expect(s.graphAssist).toBe(true);
    expect(s.graphJson).toBeUndefined();
  });
});

describe("saveBhasmGraphSettings", () => {
  beforeEach(() => {
    stubApi({
      claroSettingsGet: vi.fn(async () => ({ autoStart: true, graphAssist: true })),
      claroSettingsSet: vi.fn(async () => ({ ok: true })),
    });
  });

  it("persists via claroSettingsSet and fires claro:settings-changed", async () => {
    const dispatchEvent = vi.fn();
    stubApi({
      claroSettingsGet: vi.fn(async () => ({ autoStart: true, graphAssist: true })),
      claroSettingsSet: vi.fn(async () => ({ ok: true })),
      dispatchEvent,
    });
    const res = await saveBhasmGraphSettings({ graphJson: "G/graph.json" });
    expect(res.ok).toBe(true);
    expect(testApi().claroSettingsSet as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalled();
  });

  it("surfaces save failures", async () => {
    stubApi({
      claroSettingsGet: vi.fn(async () => ({ autoStart: true, graphAssist: true })),
      claroSettingsSet: vi.fn(async () => ({ ok: false, error: "disk full" })),
    });
    const res = await saveBhasmGraphSettings({ graphAssist: false });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("disk full");
  });
});

describe("useMcpStore", () => {
  it("refresh() records the sidecar status", async () => {
    stubApi({
      claroMcpStatus: vi.fn(async () => ({ ok: true, running: true, tools: ["query_graph", "graph_stats", "get_node"] })),
    } as AnyApi);
    const status = await useMcpStore.getState().refresh();
    expect(status.running).toBe(true);
    expect(useMcpStore.getState().status?.tools).toContain("query_graph");
  });

  it("start() updates status and clears busy", async () => {
    stubApi({
      claroMcpStart: vi.fn(async () => ({ ok: true, running: true, tools: ["query_graph"] })),
      claroMcpStop: vi.fn(async () => ({ ok: true })),
      claroMcpStatus: vi.fn(async () => ({ ok: true, running: true, tools: ["query_graph"] })),
    } as AnyApi);
    const res = await useMcpStore.getState().start({ graphJson: "g.json", python: "venv/bin/python" });
    expect(res.ok).toBe(true);
    expect(useMcpStore.getState().status?.running).toBe(true);
    expect(useMcpStore.getState().busy).toBe(false);
  });

  it("start() degrades to {ok:false} without an electron bridge", async () => {
    const res = await useMcpStore.getState().start({ graphJson: "g.json" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("unavailable");
  });

  it("toggle() stops a running sidecar and starts a stopped one", async () => {
    const stopMock = vi.fn(async () => ({ ok: true }));
    stubApi({
      claroMcpStatus: vi.fn(async () => ({ ok: true, running: false, error: undefined })),
      claroMcpStart: vi.fn(async () => ({ ok: true, running: true, tools: ["query_graph"] })),
      claroMcpStop: stopMock,
    } as AnyApi);

    await useMcpStore.getState().toggle({ graphJson: "g.json" });
    expect((testApi().claroMcpStart as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({ graphJson: "g.json", python: undefined });

    stubApi({
      claroMcpStatus: vi.fn(async () => ({ ok: true, running: true, tools: ["query_graph"] })),
      claroMcpStart: vi.fn(async () => ({ ok: true, running: true })),
      claroMcpStop: stopMock,
      dispatchEvent: () => true,
    } as AnyApi);
    await useMcpStore.getState().toggle();
    expect(stopMock).toHaveBeenCalled();
  });
});