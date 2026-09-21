import React from "react";
import type { Project, DslNode, PropValue } from "@project/contracts";

/**
 * Render a Claro project as a live preview.
 * Every node gets data-node-id; clicking selects the node.
 * Layout + style derived from node type + props (honest subset).
 */

interface RenderTreeProps {
  project: Project;
  selection: string | null;
  onSelect: (nodeId: string | null) => void;
}

export const RenderTree: React.FC<RenderTreeProps> = ({
  project,
  selection,
  onSelect,
}) => {
  const handleClick = (e: React.MouseEvent, nodeId: string | null) => {
    e.stopPropagation();
    onSelect(nodeId);
  };

  const walk = (nodes: DslNode[], depth: number): React.ReactElement[] =>
    nodes.map((node) => {
      const isSelected = selection === node.nodeId;
      const key = node.nodeId;
      const style = nodeStyle(node, depth);
      const className = [
        "clr-node",
        `clr-${node.type}`,
        isSelected ? "clr-node--selected" : "",
      ]
        .filter(Boolean)
        .join(" ");

      const children = node.children.length > 0 ? walk(node.children, depth + 1) : null;
      const text = node.text ?? node.textRef ? `@${node.textRef}` : null;

      return (
        <div
          key={key}
          data-node-id={node.nodeId}
          className={className}
          style={style}
          onClick={(e) => handleClick(e, node.nodeId)}
        >
          {text && <span className="clr-node__text">{text}</span>}
          {children}
        </div>
      );
    });

  const pages = project.pages.map((page) => (
    <div
      key={page.nodeId}
      data-node-id={page.nodeId}
      className={`clr-node clr-page ${selection === page.nodeId ? "clr-node--selected" : ""}`}
      style={pageStyle()}
      onClick={(e) => handleClick(e, page.nodeId)}
    >
      {walk(page.children, 0)}
    </div>
  ));

  return <div className="preview__canvas">{pages}</div>;
};

function nodeStyle(node: DslNode, _depth: number): React.CSSProperties {
  const props = node.props;
  const layout = getEnumProp(props, "layout");
  const gap = getNumProp(props, "gap") ?? 0;
  const padding = getNumProp(props, "padding") ?? 0;
  const align = getEnumProp(props, "align");
  const justify = getEnumProp(props, "justify");
  const background = getColorProp(props, "background");
  const color = getColorProp(props, "color");
  const size = getNumProp(props, "size");
  const effect = getEnumProp(props, "effect");
  const accent = getBoolProp(props, "accent");

  const flexDirection = layout === "row" ? "row" : "column";
  const style: React.CSSProperties = {
    display: "flex",
    flexDirection,
    gap: `${gap}px`,
    padding: `${padding}px`,
    alignItems: align ? mapAlign(align) : "stretch",
    justifyContent: justify ? mapJustify(justify) : "flex-start",
  };

  if (background) style.background = background;
  if (color) style.color = color;
  if (size) style.fontSize = `${size}px`;
  if (accent) style.border = "1px solid var(--color-accent)";
  if (effect) {
    switch (effect) {
      case "glow":
        style.boxShadow = "0 0 16px var(--color-accent-glow)";
        break;
      case "aurora":
        style.boxShadow = "0 0 32px var(--color-accent-glow)";
        break;
      case "particles":
        style.boxShadow = "0 0 24px var(--color-accent-glow)";
        break;
    }
  }

  // type-specific tweaks
  if (node.type === "heading") style.fontWeight = "600";
  if (node.type === "button") {
    style.cursor = "pointer";
    style.background = "var(--color-accent)";
    style.color = "var(--color-fg-inverse)";
    style.borderRadius = "var(--radius-md)";
  }
  if (node.type === "card") {
    style.border = "1px solid var(--color-border)";
    style.borderRadius = "var(--radius-lg)";
    style.background = background ?? "var(--color-bg-elevated)";
    style.minWidth = "140px";
  }
  if (node.type === "badge") {
    style.display = "inline-flex";
    style.fontSize = "var(--font-size-xs)";
    style.padding = "2px 8px";
    style.borderRadius = "var(--radius-full)";
    style.background = background ?? "var(--color-accent-muted)";
    style.color = color ?? "var(--color-accent)";
  }

  return style;
}

function pageStyle(): React.CSSProperties {
  return {
    minHeight: "100%",
    border: "1px solid var(--color-border-subtle)",
    borderRadius: "var(--radius-lg)",
    background: "var(--color-bg-base)",
    padding: "32px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  };
}

function getNumProp(props: Record<string, PropValue>, key: string): number | null {
  const v = props[key];
  if (v && v.t === "num") return v.v;
  return null;
}

function getEnumProp(props: Record<string, PropValue>, key: string): string | null {
  const v = props[key];
  if (v && v.t === "enum") return v.v;
  return null;
}

function getBoolProp(props: Record<string, PropValue>, key: string): boolean {
  const v = props[key];
  return v?.t === "bool" && v.v === true;
}

function getColorProp(props: Record<string, PropValue>, key: string): string | null {
  const v = props[key];
  if (v && (v.t === "color" || v.t === "str")) return v.v;
  return null;
}

function mapAlign(v: string): React.CSSProperties["alignItems"] {
  switch (v) {
    case "start": return "flex-start";
    case "center": return "center";
    case "end": return "flex-end";
    case "stretch": return "stretch";
    default: return "stretch";
  }
}

function mapJustify(v: string): React.CSSProperties["justifyContent"] {
  switch (v) {
    case "start": return "flex-start";
    case "center": return "center";
    case "end": return "flex-end";
    case "space-between": return "space-between";
    case "space-around": return "space-around";
    default: return "flex-start";
  }
}