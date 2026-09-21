import type { Project, DslNode, PropValue } from "@project/contracts";

/**
 * Export the current project to a single-file offline HTML.
 * Self-contained: every style is inline (no CSS variables), so the artifact can
 * be opened anywhere, even with no CLARO Studio running.
 */

function num(p: Record<string, PropValue>, k: string): number | null {
  const v = p[k];
  return v && v.t === "num" ? v.v : null;
}
function en(p: Record<string, PropValue>, k: string): string | null {
  const v = p[k];
  return v && v.t === "enum" ? v.v : null;
}
function col(p: Record<string, PropValue>, k: string): string | null {
  const v = p[k];
  return v && (v.t === "color" || v.t === "str") ? v.v : null;
}

function mapAlign(v: string): string {
  switch (v) {
    case "start": return "flex-start";
    case "center": return "center";
    case "end": return "flex-end";
    default: return "stretch";
  }
}
function mapJustify(v: string): string {
  switch (v) {
    case "center": return "center";
    case "end": return "flex-end";
    case "between": return "space-between";
    case "around": return "space-around";
    default: return "flex-start";
  }
}

function nodeCss(node: DslNode): string {
  const props = node.props;
  const layout = en(props, "layout");
  const gap = num(props, "gap") ?? 0;
  const padding = num(props, "padding") ?? 0;
  const width = num(props, "width");
  const height = num(props, "height");

  const parts: string[] = [
    `display:flex`,
    `flex-direction:${layout === "row" ? "row" : "column"}`,
    `gap:${gap}px`,
    `padding:${padding}px`,
  ];
  const align = en(props, "align");
  const justify = en(props, "justify");
  if (align) parts.push(`align-items:${mapAlign(align)}`);
  if (justify) parts.push(`justify-content:${mapJustify(justify)}`);
  if (width) parts.push(`width:${width}px`);
  if (height) parts.push(`height:${height}px`);

  const background = col(props, "background");
  const color = col(props, "color");
  const size = num(props, "size");
  if (background) parts.push(`background:${background}`);
  if (color) parts.push(`color:${color}`);
  if (size) parts.push(`font-size:${size}px`);
  const radius = num(props, "radius");
  if (radius) parts.push(`border-radius:${radius}px`);

  const effect = en(props, "effect");
  if (effect === "glow" || effect === "aurora" || effect === "particles") {
    parts.push(`box-shadow:0 0 ${effect === "glow" ? 16 : 32}px rgba(124,92,255,.45)`);
  }

  switch (node.type) {
    case "heading": parts.push("font-weight:600"); break;
    case "button":
      parts.push("cursor:pointer", "background:#7c5cff", "color:#fff");
      parts.push("border-radius:8px", "border:none", "padding:10px 16px");
      break;
    case "card":
      parts.push("border:1px solid rgba(255,255,255,.1)", "border-radius:12px");
      parts.push(`background:${background ?? "rgba(255,255,255,.04)"}`, "min-width:140px");
      break;
    case "badge":
      parts.push("display:inline-flex", "font-size:12px", "padding:2px 8px");
      parts.push(`border-radius:999px`, `background:${background ?? "rgba(124,92,255,.18)"}`);
      parts.push(`color:${color ?? "#a08cff"}`);
      break;
    case "navbar": parts.push("justify-content:space-between", "align-items:center"); break;
  }

  return parts.join(";");
}

function renderNode(node: DslNode, indent: string): string {
  const text = node.textRef ? `@${node.textRef}` : node.text;
  const style = nodeCss(node);
  const childHtml = node.children.map((c) => renderNode(c, indent + "    ")).join("\n");
  const inner =
    (text ? `${indent}      ${escapeHtml(text)}\n` : "") + childHtml;
  return `${indent}  <div data-node-id="${node.nodeId}" style="${style}">\n${inner}${indent}  </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderProjectHtml(project: Project): string {
  const pagesHtml = project.pages
    .map((page) => renderNode(page, ""))
    .join("\n");
  const body = pageBody(pagesHtml);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${project.pages[0]?.name ?? "CLARO export"}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background: #15131c;
    color: #e8e6f0;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    display: flex;
    justify-content: center;
  }
  .clr-page {
    width: min(720px, 100vw);
    min-height: 100vh;
    padding: 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function pageBody(pagesHtml: string): string {
  return `<div class="clr-page">\n${pagesHtml}\n</div>`;
}

/** Download the export in the renderer (returns the blob/url for the UI). */
export async function downloadProject(project: Project): Promise<string> {
  const html = renderProjectHtml(project);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${project.pages[0]?.name ?? "claro"}.export.html`;
  a.click();
  return url;
}