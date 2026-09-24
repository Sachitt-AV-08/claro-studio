import {
  type Project,
  type DslNode,
  type PropValue,
} from "@project/contracts";

/**
 * Canonical, idempotent, deterministic Claro formatter.
 * Guarantee: format(format(x)) === format(x). Runs on save (see docs/tolerance.md).
 * Rules: 4-space indentation, optional `;` never emitted, case already
 * canonicalized by the parser (lowercase), synonyms resolved, single quotes
 * normalized to double. Comments are emitted as `# text` trivia with the
 * canonical form: marker + single space, trailing space stripped, first letter
 * uppercased, content otherwise byte-true. Comments are never dropped.
 */

const INDENT = "    ";

export function format(project: Project): string {
  const lines: string[] = [];
  for (const c of project.comments ?? []) emitComment(c, 0, lines);
  if ((project.comments?.length ?? 0) > 0 && project.pages.length) lines.push("");
  for (const p of project.pages) emitNode(p, 0, lines);
  if (project.pages.length && project.components.length) lines.push("");
  for (const c of project.components) emitNode(c, 0, lines);
  return lines.join("\n").replace(/\n+$/, "") + "\n";
}

function emitComment(c: { text: string }, depth: number, lines: string[]): void {
  lines.push(INDENT.repeat(depth) + `# ${canonicalComment(c.text)}`);
}

/** `# idea text   ` -> `# Idea text`. Trailing space stripped, first letter uppercased, else byte-true. */
export function canonicalComment(text: string): string {
  let s = text.replace(/\s+$/, "");
  if (s.length > 0) s = s[0].toUpperCase() + s.slice(1);
  return s;
}

function emitNode(node: DslNode, depth: number, lines: string[]): void {
  for (const c of node.comments ?? []) emitComment(c, depth, lines);
  const pad = INDENT.repeat(depth);
  const head = nodeHead(node);
  const hasBody = node.children.length > 0 || Object.keys(node.props).length > 0 || (node.params?.length ?? 0) > 0;

  if (!hasBody) {
    lines.push(pad + head);
    return;
  }
  lines.push(pad + head + " {");
  if (node.params?.length) {
    // params already rendered in head for components
  }
  for (const [key, value] of Object.entries(node.props)) {
    lines.push(pad + INDENT + `${key}: ${formatValue(value)}`);
  }
  for (const c of node.children) emitNode(c, depth + 1, lines);
  for (const tc of node.tailComments ?? []) emitComment(tc, depth + 1, lines);
  lines.push(pad + "}");
}

function nodeHead(node: DslNode): string {
  const parts: string[] = [];
  if (node.type === "page") {
    parts.push("page");
    if (node.name) parts.push(node.name);
  } else if (node.kind === "component") {
    parts.push("component");
    // params attach directly: `Hero(title: string)` — no space, matches input form
    parts.push((node.name ?? "") + formatParams(node.params ?? []));
  } else {
    parts.push(canonicalHead(node.type, node.name));
  }
  if (node.text !== undefined) parts.push(formatString(node.text));
  else if (node.textRef !== undefined) parts.push(`@${node.textRef}`);
  return parts.join(" ");
}

/** Element header keeps type + name; canonical name casing preserved. */
function canonicalHead(type: string, name?: string): string {
  if (name) return `${type} ${name}`;
  return type;
}

function formatParams(params: { name: string; type: string }[]): string {
  if (params.length === 0) return "()";
  return `(${params.map((p) => `${p.name}: ${p.type}`).join(", ")})`;
}

export function formatValue(value: PropValue): string {
  switch (value.t) {
    case "num": {
      const u = value.unit ? `${value.unit}` : "";
      return `${value.v}${u}`;
    }
    case "str": return formatString(value.v);
    case "color": return value.v;
    case "bool": return value.v ? "true" : "false";
    case "enum": return value.v;
    case "ref": return `@${value.v}`;
    case "tuple": return value.v.map(formatValue).join(" ");
    case "list": return `[${value.v.map(formatValue).join(" ")}]`;
  }
}

function formatString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`;
}

/** Convenience: format a raw .cl string — parses, ignoring diagnostics, then formats. */
import { parse } from "./parser.js";
export function formatSource(source: string): string {
  return format(parse(source));
}