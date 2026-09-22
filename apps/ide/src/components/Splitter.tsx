import React from "react";

interface SplitterProps {
  axis?: "col" | "row";
  onDelta: (delta: number) => void;
  onReset?: () => void;
  className?: string;
  title?: string;
}

export const Splitter: React.FC<SplitterProps> = ({ axis = "col", onDelta, onReset, className, title }) => {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const start = axis === "col" ? e.clientX : e.clientY;
    let last = start;
    const onMove = (ev: PointerEvent) => {
      const cur = axis === "col" ? ev.clientX : ev.clientY;
      onDelta(cur - last);
      last = cur;
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", cleanup, { once: true });
    document.body.style.cursor = axis === "col" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };

  const cls = ["splitter", axis === "col" ? "splitter--col" : "splitter--row", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={cls}
      title={title ?? (axis === "col" ? "Drag to resize · double-click to reset" : "Drag to resize BHASM panel · double-click to reset")}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
    />
  );
};