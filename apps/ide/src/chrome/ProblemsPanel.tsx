import React from "react";
import type { Diagnostic } from "@project/contracts";
import { Icon } from "../components/Icon";

/**
 * Problems panel — the editor's error/warning list, with jump-to-line.
 */

interface Props {
  errors: Diagnostic[];
  warnings: Diagnostic[];
  onJump: (line: number) => void;
  onClose: () => void;
}

export const ProblemsPanel: React.FC<Props> = ({ errors, warnings, onJump, onClose }) => {
  const all: { d: Diagnostic; kind: "error" | "warning"; line: number }[] = [
    ...errors.map((d) => ({
      d,
      kind: "error" as const,
      line: d.range?.start.line ?? 1,
    })),
    ...warnings.map((d) => ({
      d,
      kind: "warning" as const,
      line: d.range?.start.line ?? 1,
    })),
  ];

  return (
    <div className="problems">
      <div className="pane__header problems__head">
        <span>Problems</span>
        <button className="pane__action" onClick={onClose} title="Close panel">
          <Icon name="close" size={13} />
        </button>
      </div>
      {all.length === 0 ? (
        <div className="problems__empty">
          <Icon name="check" size={15} /> No problems detected
        </div>
      ) : (
        <table className="problems__table">
          <tbody>
            {all.map(({ d, kind, line }, i) => (
              <tr key={i} className={`problems__row problems__row--${kind}`} onClick={() => onJump(line)} title={`jump to line ${line}`}>
                <td className="problems__cell">
                  <Icon name={kind === "error" ? "error" : "warning"} size={13} />
                </td>
                <td className="problems__cell problems__line">{line}</td>
                <td className="problems__cell problems__msg">{d.message}</td>
                <td className="problems__cell problems__code">{d.code ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};