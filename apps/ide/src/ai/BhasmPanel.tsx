import React, { useEffect, useMemo, useRef, useState } from "react";
import { useClaroStore } from "../store/claroStore";
import { useStitchStore, makeProposal } from "../stitch/stitchStore";
import { runtime, type BhasmMessage } from "../bhasm/runtime";
import { type BhasmMode } from "../bhasm/agent";
import { skills } from "../bhasm/skills";
import { Icon, type IconName } from "../components/Icon";
import { useMcpStore } from "../graph/mcpStore";
import { useDecisionStore } from "../bhasm/decisionStore";
import { useMetricsStore, edgeMetrics } from "../bhasm/metricsStore";
import { classifySeed } from "../bhasm/decisions";

interface PanelProps {
  onToggle: () => void;
  height?: number;
}

interface ThreadEntry {
  id: number;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  toolChips?: { tool: string; ok: boolean }[];
  error?: string;
}

export interface ChatTodo {
  id: number;
  /** human label shown in the checklist */
  label: string;
  /** op index into the proposal ops batch (-1 = whole batch) */
  opIdx: number;
  done: boolean;
  committed: boolean;
}

const MODES: { id: BhasmMode; label: string; icon: IconName }[] = [
  { id: "ask", label: "Ask", icon: "lightbulb" },
  { id: "code", label: "Code", icon: "code" },
  { id: "review", label: "Review", icon: "checklist" },
  { id: "explain-comment", label: "Explain-comment", icon: "comment" },
];

const TOOL_CHIP: Record<string, { label: string }> = {
  propose_patch: { label: "propose_patch" },
  apply_patch: { label: "apply_patch" },
  review: { label: "review" },
  inspect_node: { label: "inspect_node" },
  comment_to_idea: { label: "comment_to_idea" },
  describe_patch: { label: "describe_patch" },
  export_project: { label: "export_project" },
  query_graph: { label: "query_graph" },
  graph_stats: { label: "graph_stats" },
};

let idCounter = 0;
const nextId = () => ++idCounter;

function describeOp(op: import("@project/contracts").PatchOp): string {
  switch (op.op) {
    case "set_property":
      return `set ${op.property} = ${JSON.stringify((op as { value?: unknown }).value)} on ${op.target}`;
    case "set_text":
      return `set text of ${op.target} → ${(op as { value?: string }).value}`;
    case "add_element":
      return `add ${(op as { element?: { type?: string } }).element?.type ?? "node"} in ${op.parent}`;
    case "remove_element":
      return `remove ${op.target}`;
    case "move_element":
      return `move ${op.target} ${op.position}`;
    case "set_layout":
      return `lay out ${op.target} as ${op.layout}`;
    case "set_effects":
      return `apply ${op.effect} to ${op.target}`;
    default:
      return `${(op as { op: string }).op} on ${(op as { target?: string }).target ?? (op as { parent?: string }).parent ?? "?"}`;
  }
}

const STATUS_COPY: Record<string, string> = {
  "⚡": "BHASM running",
  "Sleeping": "Sleeping",
  "Installing": "Installing",
  "Error": "Error",
};

export const BhasmPanel: React.FC<PanelProps> = ({ onToggle, height }) => {
  const [mode, setMode] = useState<BhasmMode>("code");
  const [input, setInput] = useState("");
  const [thread, setThread] = useState<ThreadEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [todos, setTodos] = useState<ChatTodo[]>([]);
  const [todayOps, setTodayOps] = useState<import("@project/contracts").PatchOp[]>([]);
  const [healthState, setHealthState] = useState<"checking" | "ok" | "offline" | "error">("checking");
  const [graphAssist, setGraphAssist] = useState(true);
  const mcpStatus = useMcpStore((s) => s.status);
  const lastRoute = useDecisionStore((s) => s.lastRoute);
  const lastGuardrail = useDecisionStore((s) => s.lastGuardrail);
  const metricsVersion = useMetricsStore((s) => s.id);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    runtime.health().then((h) => {
      setHealthState(h.ok ? "ok" : h.error ? "error" : "offline");
    });
  }, []);

  // Consume a "#" idea seed from the editor (double-click) → BHASM classifies
  // the intent (Claro Decisions) and prefills the best mode.
  useEffect(() => {
    const onSeed = (e: Event) => {
      const detail = (e as CustomEvent).detail as { idea: string };
      if (!detail?.idea) return;
      void (async () => {
        const { mode: seedMode } = await classifySeed(detail.idea);
        setMode(seedMode);
        setInput(`Explain and improve: ${detail.idea}`);
        append({ id: nextId(), role: "user", text: `Explain the idea: ${detail.idea}` });
      })();
    };
    window.addEventListener("claro:bhasm-prompt", onSeed);
    return () => window.removeEventListener("claro:bhasm-prompt", onSeed);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread]);

  const append = (e: ThreadEntry) => setThread((t) => [...t, e]);
  const patchLast = (pred: (e: ThreadEntry) => boolean, patch: (e: ThreadEntry) => ThreadEntry) =>
    setThread((t) => {
      const idx = t.length - 1;
      if (idx < 0 || !pred(t[idx])) return t;
      const copy = [...t];
      copy[idx] = patch(t[idx]);
      return copy;
    });

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    append({ id: nextId(), role: "user", text });
    append({ id: nextId(), role: "assistant", text: "", streaming: true });

    const { project, source } = useClaroStore.getState();

    const message: BhasmMessage = await runtime.run(
      {
        mode,
        input: text,
        project,
        source,
        store: {
          applyOps: (ops) => useClaroStore.getState().applyOps(ops),
        },
        graphAssist,
      },
      {
        onEvent(ev) {
          if (ev.type === "tool") {
            patchLast((e) => e.role === "assistant", (e) => ({
              ...e,
              toolChips: [...(e.toolChips ?? []), { tool: ev.id, ok: ev.ok }],
            }));
          }
          if (ev.type === "proposal") {
            const { project } = useClaroStore.getState();
            useStitchStore.getState().setProposal(
              makeProposal(ev.summary, ev.ops, project, "bhasm"),
            );
            if (ev.ops.length > 1) {
              setTodos(
                ev.ops.map((op, i) => ({
                  id: nextId(),
                  label: describeOp(op),
                  opIdx: i,
                  done: false,
                  committed: false,
                })),
              );
              setTodayOps(ev.ops);
            } else {
              setTodos([]);
              setTodayOps([]);
            }
          }
          if (ev.type === "delta") {
            patchLast((e) => e.role === "assistant", (e) => ({ ...e, text: ev.text }));
          }
          if (ev.type === "error") {
            patchLast((e) => e.role === "assistant", (e) => ({
              ...e,
              error: ev.reason,
              streaming: false,
            }));
          }
        },
      },
    );

    if (message.final && !message.text) {
      // ensure the streaming bubble resolves (error series already patched)
      patchLast((e) => !!e.streaming, (e) => ({ ...e, streaming: false, text: message.text }));
    }
    setBusy(false);
  };

  const modeColors: Record<BhasmMode, string> = {
    ask: "var(--color-accent)",
    code: "var(--color-success)",
    review: "var(--color-warning)",
    "explain-comment": "var(--color-accent)",
  };

  /** Toggle a single chat todo → commits that op reversibly into the undo stack. */
  const toggleTodo = (todo: ChatTodo) => {
    if (todo.committed) return;
    const op = todayOps[todo.opIdx];
    if (!op) return;
    const res = useClaroStore.getState().applyOps([op]);
    if (res.ok) {
      setTodos((ts) => ts.map((t) => (t.id === todo.id ? { ...t, done: true, committed: true } : t)));
    }
  };

  /** Apply the whole proposal batch in one click. */
  const applyAll = () => {
    if (!todayOps.length) {
      // fall back to the stitched proposal (single-op case earlier)
      const p = useStitchStore.getState().proposal;
      if (!p) return;
      useClaroStore.getState().applyOps(p.ops);
      useStitchStore.getState().clear();
      return;
    }
    const res = useClaroStore.getState().applyOps(todayOps);
    if (res.ok) {
      setTodos((ts) => ts.map((t) => ({ ...t, done: true, committed: true })));
    }
  };

  const openStitch = () => {
    // the stitch view reads its proposal from the stitch store; just switch view
    window.dispatchEvent(new CustomEvent("claro:view", { detail: "stitch" }));
  };

  return (
    <section className="ai" data-testid="bhasm-panel" style={height ? { height, maxHeight: "none" } : undefined}>
      <header className="ai__bar">
        <span className="ai__brand">
          <Icon name="sparkle" size={13} /> BHASM <span className="ai__local">· local</span>
        </span>

        <nav className="ai__modes">
          {MODES.map((m) => (
            <button
              key={m.id}
              className={`ai__mode${mode === m.id ? " ai__mode--active" : ""}`}
              onClick={() => setMode(m.id)}
              title={m.label}
            >
              <Icon name={m.icon} size={12} />
              <span>{m.label.replace("-comment", "")}</span>
            </button>
          ))}
        </nav>

        <div className="ai__spacer" />

        <button
          className={`ai__graph${graphAssist ? " ai__graph--on" : ""}`}
          onClick={() => setGraphAssist((v) => !v)}
          title={
            mcpStatus?.running
              ? `${graphAssist ? "Graph assist ON — query_graph grounds answers\n" : "Graph assist off\n"}sidecar: ${mcpStatus.graphJson ?? ""} · ${mcpStatus.tools?.length ?? 0} graph tools`
              : "Graph assist needs the graphify sidecar (status bar shows graph state)"
          }
        >
          <Icon name="graph" size={13} />
          <span className="ai__graph-dot" data-on={!!mcpStatus?.running} />
        </button>

        {lastRoute && (
          <span
            className="ai__decide"
            title={`decision layer · ${lastRoute.provider}${lastRoute.task === "classify" ? " · intent classify" : " · router"}`}
          >
            <Icon name="zap" size={11} />
            <span className="ai__decide-tool">{lastRoute.choice.replace(/_/g, " ")}</span>
            <span className="ai__decide-prob">{(lastRoute.probability * 100).toFixed(0)}%</span>
            <span className={`ai__decide-step ai__decide-step--${lastRoute.step}`}>{lastRoute.step}</span>
          </span>
        )}

        <span
          className={`ai__status ai__status--${healthState}`}
          title={
            healthState === "ok"
              ? "Ollama ready — qwen2.5:3b"
              : healthState === "error"
              ? "Ollama not running on :11434"
              : "model loading"
          }
        >
          {healthState === "ok" ? "⚡ ready" : healthState === "checking" ? "…" : "offline"}
        </span>
        <button className="ai__toggle" onClick={onToggle} title="Collapse BHASM">
          <Icon name="chevron-down" size={14} />
        </button>
      </header>

      <EdgeAIMetrics key={metricsVersion} />     

      <div className="ai__body" ref={scrollerRef}>
        {thread.length === 0 && (
          <div className="ai__empty">
            <div className="ai__empty-hero">
              <Icon name="sparkle" size={17} />
            </div>
            <p className="ai__empty-title">BHASM — local-first AI</p>
            <p className="ai__empty-sub">
              Ask, code, or review the project. Every change is a reversible PatchOp —{" "}
              <code>#</code> comments are the brain.
            </p>
            <div className="ai__empty-suggestions">
              <button onClick={() => setInput("Make the hero title bigger and accent-colored")}>
                Make the hero title red
              </button>
              <button onClick={() => setInput("Add a call-to-action button to the hero")}>
                Add a CTA button
              </button>
              <button onClick={() => setInput("Review the project")}>Review the project</button>
            </div>
          </div>
        )}

        {lastGuardrail?.choice === "reject" && lastGuardrail.step === "act" && (
          <div className="ai__guard" role="status">
            <Icon name="shield" size={12} />
            <span>
              Guardrail blocked this patch (
              {(lastGuardrail.probability * 100).toFixed(0)}% reject confidence).
              {lastGuardrail.reason ? ` ${lastGuardrail.reason}` : ""}
            </span>
          </div>
        )}

        {todos.length > 0 && (
            <div className="ai__todos">
              <div className="ai__todos-head">
                <span>
                  <Icon name="checklist" size={13} /> {todos.filter((t) => t.done).length}/{todos.length} executed
                </span>
                <div className="ai__todos-actions">
                  <button className="ai__todos-stitch" onClick={openStitch} title="Open the seam in Stitch">
                    <Icon name="diff" size={12} /> Stitch
                  </button>
                  <button className="ai__todos-apply" onClick={applyAll} title="Apply the whole batch once">
                    <Icon name="check" size={12} /> Apply all
                  </button>
                </div>
              </div>
              {todos.map((todo) => (
                <button
                  key={todo.id}
                  className={`ai__todo${todo.done ? " ai__todo--done" : ""}`}
                  onClick={() => toggleTodo(todo)}
                  disabled={todo.committed}
                  title={todo.committed ? "applied — undo with Ctrl+Z" : "apply this op (reversible)"}
                >
                  <Icon name={todo.done ? "check" : "circle-outline"} size={12} />
                  <span>{todo.label}</span>
                </button>
              ))}
            </div>
          )}

        {thread.map((entry) => (
          <div key={entry.id} className={`tmsg tmsg--${entry.role}`}>
            <div className="tmsg__role">
              {entry.role === "user" ? (
                <Icon name="person" size={12} />
              ) : (
                <Icon name="sparkle" size={12} />
              )}
              <span>{entry.role === "user" ? "you" : "bhasm"}</span>
            </div>

            {entry.toolChips && entry.toolChips.length > 0 && (
              <div className="tmsg__chips">
                {entry.toolChips.map((c, i) => (
                  <span key={i} className={`tchip tchip--${c.ok ? "ok" : "fail"}`}>
                    {(TOOL_CHIP[c.tool]?.label ?? c.tool).replace(/_/g, " ")} {c.ok ? "✓" : "✗"}
                  </span>
                ))}
              </div>
            )}

            {entry.error ? (
              <div className="tmsg__body tmsg__body--error">{entry.error}</div>
            ) : (
              <div className={`tmsg__body${entry.streaming ? " tmsg__body--streaming" : ""}`}>
                {entry.text}
                {entry.streaming && <span className="tmsg__cursor">▊</span>}
              </div>
            )}
          </div>
        ))}
      </div>

      <footer className="ai__footer">
        <div className="ai__input">
          <KbdIcon mode={mode} color={modeColors[mode]} />
          <input
            className="ai__text"
            placeholder={
              mode === "ask"
                ? "Ask about the project or the Claro language…"
                : mode === "review"
                ? "Review target: whole project or a node…"
                : "Describe the change… e.g. make the hero button ghost variant"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={busy}
          />
          <button className="ai__run" onClick={send} disabled={busy || !input.trim()}>
            {busy ? "Thinking…" : "Run"}
          </button>
        </div>
        <div className="ai__hint">Enter to run · Shift+Enter for newline · reversibility is sacred</div>
      </footer>
    </section>
  );
};

/** Live Edge-AI strip: how many decisions never woke the 3B model. */
const EdgeAIMetrics: React.FC = () => {
  const m = edgeMetrics();
  if (m.total === 0) return null;
  const pct = Math.round(m.skippedRate * 100);
  const latency = m.avgLatencyMs < 100 ? `${Math.round(m.avgLatencyMs)}ms` : `${(m.avgLatencyMs / 1000).toFixed(1)}s`;
  return (
    <div className="ai__edge" title="Claro Decisions — every input is gated by the local embedding prior before the 3B model wakes">
      <span className="ai__edge-cell">
        <Icon name="shield" size={11} /> <b>{pct}%</b> on-device
      </span>
      <span className="ai__edge-cell">
        {m.onDevice}/{m.total} decisions skipped 3B
      </span>
      <span className="ai__edge-cell">
        <Icon name="history" size={11} /> avg {latency}
      </span>
      {m.last && (
        <span className="ai__edge-last" title={`last decision: ${m.last.task} · ${m.last.provider}`}>
          {m.last.provider}
        </span>
      )}
    </div>
  );
};

const KbdIcon: React.FC<{ mode: BhasmMode; color: string }> = ({ mode, color }) => (
  <span className="ai__kbd" style={{ background: color }}>
    <Icon name={MODES.find((m) => m.id === mode)?.icon ?? "code"} size={11} />
  </span>
);

/** Export used by the Extensions view to list the loaded skills. */
export function useLoadedSkills(source: string) {
  return useMemo(() => skills.list(source), [source]);
}

export { STATUS_COPY };