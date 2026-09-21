import React, { useState, useMemo } from "react";
import { createClaroAi } from "./localAi";
import { useClaroStore } from "../store/claroStore";

export const AiPanel: React.FC = () => {
  const ai = useMemo(() => createClaroAi(), []);

  const [instruction, setInstruction] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "error" | "offline">("idle");
  const [proposal, setProposal] = useState<{ summary: string; ops: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!instruction.trim()) return;
    setBusy(true);
    setError(null);
    setProposal(null);
    setStatus("idle");

    try {
      const health = await ai.health();
      if (!health.ok) {
        setStatus("offline");
        setError(health.error ?? "AI offline");
        return;
      }
      setStatus("idle");

      const project = useClaroStore.getState().project;
      const result = await ai.proposePatch(instruction, project);

      if (!result.patch.ops.length) {
        setError("AI returned no ops.");
        setStatus("error");
        return;
      }

      const opStrings = result.patch.ops.map((op: import("@project/contracts").PatchOp) =>
        JSON.stringify(op).slice(0, 120),
      );
      setProposal({ summary: result.summary, ops: opStrings });
      setStatus("ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!proposal) return;
    const project = useClaroStore.getState().project;
    const aiResult = await ai.proposePatch(instruction, project);
    if (!aiResult.patch.ops.length) return;
    const res = await ai.applyPatch(project, aiResult.patch.ops);
    if (!res.ok) setError(res.error ?? "apply failed");
    else {
      setProposal(null);
      setInstruction("");
      setStatus("idle");
    }
  };

  return (
    <div className="ai">
      <div className="pane__header">
        AI Assistant
        <span
          className={`status-dot ${
            status === "ok"
              ? "online"
              : status === "offline"
              ? "offline"
              : status === "error"
              ? "error"
              : "idle"
          }`}
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background:
              status === "ok"
                ? "var(--color-success)"
                : status === "offline"
                ? "var(--color-warning)"
                : status === "error"
                ? "var(--color-error)"
                : "var(--color-fg-muted)",
          }}
        />
      </div>
      <div className="ai__body">
        <div className="ai__input">
          <input
            className="ai__text"
            placeholder="e.g. make the hero title red and bigger"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && run()}
            disabled={busy}
          />
          <button className="ai__run" onClick={run} disabled={busy || !instruction.trim()}>
            {busy ? "Thinking…" : "Run"}
          </button>
        </div>

        {error && <div className="ai__error">{error}</div>}

        {proposal && (
          <>
            <div className="ai__result">Summary: {proposal.summary}</div>
            <div className="ai__chips">
              {proposal.ops.map((op, i) => (
                <span key={i} className="ai__chip">
                  {op}
                </span>
              ))}
            </div>
            <button className="ai__apply" onClick={apply} disabled={busy}>
              Apply
            </button>
          </>
        )}
      </div>
    </div>
  );
};