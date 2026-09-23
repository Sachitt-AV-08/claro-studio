import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/**
 * TerminalPanel — Phase B1 renderer for the claro:term:* ConPTY bridge exposed
 * by preload.ts (claroTermSpawn/Write/Kill/OnData/OnExit -> claro:term:* IPC).
 * Renders live shell output into a lightweight <pre>-style feed and forwards
 * typed commands back over claroTermWrite.
 */

export type TermKind = "out" | "in" | "sys" | "err";

export interface TermLine {
  text: string;
  kind: TermKind;
}

export function TerminalPanel({
  cwd,
  feedRef,
}: {
  cwd?: string;
  feedRef?: { current: ((l: TermLine) => void) | null };
}) {
  const [lines, setLines] = useState<TermLine[]>([]);

  useEffect(() => {
    if (!feedRef) return;
    feedRef.current = (l: TermLine) => setLines((prev) => [...prev, l]);
  }, [feedRef]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const tailRef = useRef<HTMLDivElement | null>(null);
  const idRef = useRef<string | null>(null);


  useEffect(() => {
    let disposed = false;

    void window.electronAPI
      ?.claroTermSpawn?.({ cwd })
      .then((r) => {
        if (disposed) return;
        if (!r.ok || !r.id) {
          const text = r.error ?? "failed to spawn shell";
          setLines((l) => [...l, { text, kind: "err" }]);
          return;
        }
        idRef.current = r.id;
        setRunning(true);
        setLines((l) => [...l, { text: `claro:term › spawned (${r.cwd ?? cwd ?? "cwd"})`, kind: "sys" }]);
      });

    const offData = window.electronAPI?.claroTermOnData?.((p) => {
      if (p.id !== idRef.current) return;
      setLines((l) => {
        const rows = p.data.split(/\r?\n/).filter((s) => s.length > 0);
        if (rows.length === 0) return l;
        return [...l, ...rows.map((text) => ({ text, kind: "out" as TermKind }))];
      });
    });
    const offExit = window.electronAPI?.claroTermOnExit?.((p) => {
      if (p.id !== idRef.current) return;
      setRunning(false);
      setLines((l) => [...l, { text: `claro:term › exited (${p.code ?? "?"})`, kind: "sys" }]);
    });

    return () => {
      disposed = true;
      offData?.();
      offExit?.();
      if (idRef.current) void window.electronAPI?.claroTermKill?.(idRef.current);
    };
  }, [cwd]);

  useEffect(() => {
    tailRef.current?.scrollIntoView({ block: "end" });
  }, [lines.length]);

  const submit = () => {
    const data = input.trimEnd();
    if (!data || !idRef.current) return;
    void window.electronAPI?.claroTermWrite?.(idRef.current, data + "\r");
    setLines((l) => [...l, { text: data, kind: "in" }]);
    setInput("");
  };

  return (
    <div className="terminalpanel">
      <div className="terminalpanel__head">
        <span className="terminalpanel__title">
          <Icon name="terminal" size={14} /> Terminal
          <span className={`terminalpanel__dot${running ? " terminalpanel__dot--go" : ""}`} />
        </span>
        <span className="terminalpanel__cwd">{cwd ?? "cwd"}</span>
      </div>
      <div className="terminalpanel__body">
        {lines.map((l, i) => (
          <div key={i} className={`terminalpanel__ln terminalpanel__ln--${l.kind}`}>
            {l.text || "\u00a0"}
          </div>
        ))}
        <div ref={tailRef} />
      </div>
      <div className="terminalpanel__in">
        <span className="terminalpanel__prompt">_</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          disabled={!running}
          placeholder={running ? "type a command…" : "shell not running"}
          spellCheck={false}
          autoFocus
        />
      </div>
    </div>
  );
}

export default TerminalPanel;
