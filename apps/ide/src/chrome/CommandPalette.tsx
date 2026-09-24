import React, { useEffect, useMemo, useRef, useState } from "react";
import { useStitchStore } from "../stitch/stitchStore";
import { Icon, type IconName } from "../components/Icon";
import { renderProjectHtml, downloadProject } from "../export/renderHtml";

export interface PaletteCommand {
  id: string;
  label: string;
  group: string;
  icon: IconName;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  makeCommands: () => PaletteCommand[];
}

export const CommandPalette: React.FC<Props> = ({ open, onClose, makeCommands }) => {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const commands = useMemo(() => makeCommands(), [makeCommands, open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q),
    );
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="palette" onClick={onClose}>
      <div className="palette__box" onClick={(e) => e.stopPropagation()}>
        <div className="palette__input-row">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            className="palette__input"
            placeholder="Type a command…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter" && filtered[0]) {
                filtered[0].run();
                onClose();
              }
            }}
          />
          <span className="palette__kbd">esc</span>
        </div>
        <div className="palette__list">
          {filtered.length === 0 && <div className="palette__empty">No commands match.</div>}
          {filtered.map((c) => (
            <button
              key={c.id}
              className="palette__item"
              onClick={() => {
                c.run();
                onClose();
              }}
            >
              <Icon name={c.icon} size={15} />
              <span className="palette__item-label">{c.label}</span>
              <span className="palette__item-group">{c.group}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

/** Shared command factories used by App to populate the palette. */
export function makeExportCommands(project: Parameters<typeof renderProjectHtml>[0]): PaletteCommand[] {
  return [
    {
      id: "export.html",
      label: "Export: single-file HTML",
      group: "export",
      icon: "cloud-download",
      run: () => {
        void downloadProject(project);
      },
    },
    {
      id: "export.package",
      label: "Export: Package app (.json)",
      group: "export",
      icon: "package",
      run: () => {
        const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${project.pages[0]?.name ?? "claro"}.package.json`;
        a.click();
      },
    },
  ];
}

export function seamlessCommand(go: (view: "stitch" | "tasks") => void): PaletteCommand {
  return {
    id: "stitch.open",
    label: "Stitch: open the seam",
    group: "stitch",
    icon: "diff",
    run: () => {
      const p = useStitchStore.getState().proposal;
      if (!p) return;
      go("stitch");
    },
  };
}