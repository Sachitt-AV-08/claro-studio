import type { Project, DslNode } from "@project/contracts";
import {
  COMPOSE_ELEMENT,
  TEXT_CONTENT,
  COLUMN_LAYOUTS,
  ROW_LAYOUTS,
  colorLiteral,
  numOf,
  enumOf,
  strOf,
  firstNum,
  type ComposeNode,
} from "./contract.js";

const INDENT = "    ";

/**
 * Build a Kotlin Compose file (single-file renderer) from a Claro Project.
 * Deterministic and idempotent for the same AST: the page + every component
 * become top-level `@Composable fun`s; component instances render through a
 * generated ComponentRegistry so names resolve.
 *
 * Elements -> Compose (see contract.ts):
 *   page/section/container/stack/row/grid/form  -> Column/Row/Box containers
 *   text/heading/badge                           -> Text
 *   button                                       -> Button { Text(..) }
 *   image                                        -> Image
 *   spacer                                       -> Spacer
 *   divider                                      -> Divider
 *   any unknown element                          -> Box (pass-through surface)
 */

const W: Record<string, string> = { regular: "Normal", medium: "Medium", semibold: "SemiBold", bold: "Bold" };
const A: Record<string, string> = { left: "Start", center: "Center", right: "End", justify: "Justify" };

function unitLen(v: number, unit?: string): string {
  switch (unit) {
    case "%": return `doubleToDp(${v})`;
    case "em":
    case "rem": return `${v}.sp`;
    default: return `${v}.dp`;
  }
}

function nodeText(node: DslNode): string {
  return node.textRef ? `@${node.textRef}` : (node.text ?? "");
}

function escapeKt(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

/** Build the ComposeNode tree mirroring the Claro AST (1 element -> 1 composable). */
function emitNode(node: DslNode): ComposeNode {
  const kind = COMPOSE_ELEMENT[node.type] ?? "Box";
  const p = node.props;

  // text-bearing elements
  if (TEXT_CONTENT.has(node.type)) {
    const args: string[] = [];
    const color = strOf(p, "color");
    const size = numOf(p, "size");
    const weight = enumOf(p, "weight");
    const align = enumOf(p, "align");
    if (node.type === "heading" && !weight) args.push("fontWeight = FontWeight.SemiBold");
    if (color) args.push(`color = ${colorLiteral(color)}`);
    if (align) args.push(`textAlign = TextAlign.${A[align] ?? "Start"}`);
    if (size) args.push(`fontSize = ${size.unit === "%" ? "" : `${size.v}.sp`}`);
    if (weight) args.push(`fontWeight = FontWeight.${W[weight] ?? "Normal"}`);

    if (kind === "Button") {
      const label = nodeText(node);
      const child: ComposeNode = { kind: "Text", text: label, args: [], children: [] };
      return { kind, text: "", args: ["onClick = { }", ...args], children: [child] };
    }
    return { kind, text: nodeText(node), args, children: [] };
  }

  // containers & surfaces
  const mods: string[] = [];
  const pad = firstNum(p, "padding");
  if (pad != null) mods.push(`padding(${pad}.dp)`);
  const wid = numOf(p, "width");
  const hei = numOf(p, "height");
  if (wid && wid.unit !== "fr") mods.push(`width(${unitLen(wid.v, wid.unit)})`);
  if (hei && hei.unit !== "fr") mods.push(`height(${unitLen(hei.v, hei.unit)})`);
  const bg = strOf(p, "background");
  if (bg) mods.push(`background(${colorLiteral(bg)})`);
  const radius = numOf(p, "radius");
  if (radius) mods.push(`clip(RoundedCornerShape(${radius}.dp))`);

  const args: string[] = [];
  if (mods.length) args.push(`modifier = Modifier.${mods.join(".")}`);
  const gap = firstNum(p, "gap");
  if (gap != null && (COLUMN_LAYOUTS.has(node.type) || ROW_LAYOUTS.has(node.type))) {
    args.push(`verticalArrangement = Arrangement.spacedBy(${gap}.dp)`);
  }

  return { kind, text: "", args, children: node.children.map((c) => emitNode(c)) };
}

function emitSource(node: ComposeNode, depth: number): string {
  const pad = INDENT.repeat(depth);
  const argStr = node.args.length ? `(${node.args.join(", ")})` : "";
  const head = `${pad}${node.kind}${argStr} {`;
  const lines: string[] = [];

  for (const c of node.children) {
    if (!c.children.length && !c.args.length && !c.text) {
      lines.push(`${pad}${INDENT}${c.kind}()`);
    } else {
      lines.push(emitSource(c, depth + 1));
    }
  }
  if (lines.length === 0) {
    // leaf: inline — `Text("hi", fontSize = 18.sp)` or `Spacer()`
    const inlineText = node.text ? `Text("${escapeKt(node.text)}"${node.args.length ? `, ${node.args.join(", ")}` : ""})` : "";
    if (inlineText) return `${pad}${inlineText}`;
    return node.args.length ? `${pad}${node.kind}(${node.args.join(", ")})` : `${pad}${node.kind}()`;
  }
  // leaf with text but also children impossible; text-bearing elements have no children
  lines.push(`${pad}}`);
  return [head, ...lines].join("\n");
}

function cap(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function ktType(claro: string): string {
  switch (claro.toLowerCase()) {
    case "number":
    case "int":
      return "Int";
    case "boolean":
    case "bool":
      return "Boolean";
    default:
      return "String";
  }
}
function defaultFor(claro: string): string {
  switch (ktType(claro)) {
    case "Int": return "0";
    case "Boolean": return "false";
    default: return "\"\"";
  }
}

function flatten(n: DslNode): DslNode[] {
  return [n, ...n.children.flatMap(flatten)];
}

function componentTree(comp: DslNode): ComposeNode {
  return { kind: "Box", text: "", args: [], children: comp.children.map((c) => emitNode(c)) };
}

const HEADER = `import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Generated by CLARO Workbench — reversible counterpart to the .cl source.
// Edit the .cl file to regenerate; this file is a build artifact.`;

/** Deterministic, idempotent-for-same-AST Kotlin Compose for a Claro project. */
export function buildAndroid(project: Project): string {
  const blocks: string[] = [HEADER];

  for (const comp of project.components) {
    const params = (comp.params ?? [])
      .map((p) => `${p.name}: ${ktType(p.type)} = ${defaultFor(p.type)}`)
      .join(", ");
    const tree = componentTree(comp);
    blocks.push(`@Composable
fun ${cap(comp.name ?? "Component")}(${params}) {
${emitSource(tree, 1)}
}`);

    const used = project.pages
      .flatMap((pg) => flatten(pg))
      .filter((n) => n.type === (comp.name ?? "").toLowerCase()).length;
    if (used > 0) {
      blocks.push(
        `private val componentRegistry: Map<String, @Composable () -> Unit> = mapOf(
    "${cap(comp.name ?? "Component")}" to { ${cap(comp.name ?? "Component")}() }
)`,
      );
    }
  }

  for (const page of project.pages) {
    const tree = emitNode(page);
    blocks.push(`@Composable
fun ${cap(page.name ?? "Home")}Screen() {
${emitSource(tree, 1)}
}`);
  }

  return blocks.join("\n\n") + "\n";
}

function compositeSignature(node: ComposeNode): string {
  if (node.kind === "Button") {
    const label = node.children.find((c) => c.kind === "Text" && c.text)?.text ?? node.text;
    return `Button:${label}`;
  }
  const kinds = node.children.map(compositeSignature);
  const text = node.text;
  return `${node.kind}${text ? `:${text}` : ""}${kinds.length ? `(${kinds.join(",")})` : ""}`;
}

/** Stable structural fingerprint of the generated Kotlin (used by parity tests). */
export function androidSignature(project: Project): string {
  return project.pages.map((p) => compositeSignature(emitNode(p))).join("|");
}