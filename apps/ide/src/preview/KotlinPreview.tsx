import React, { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";

/**
 * KotlinPreview — renders a tiny Compose-like UI for a Kotlin source file.
 *
 * Supports a documented subset of Compose so the preview works with Kotlin:
 *   @Composable fun Screen() { ... }
 *   Column { Row { } Box { } ... }
 *   Text("...", Modifier.padding(8).width(120))
 *   Button(onClick = { ... }) { Text("Tap me") }
 *   Spacer(modifier = Modifier.height(24))
 *   Modifier.width(n) / .height(n) / .padding(n)
 * Unknown composables are treated as pass-through containers.
 */

export interface KModifier {
  width?: number;
  height?: number;
  padding?: number;
}

export interface KNode {
  kind: string;
  text: string;
  mod: KModifier;
  onClick: boolean;
  children: KNode[];
}

function matchBrace(src: string, openIndex: number): number {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = openIndex; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") {
        i++;
      } else if (c === inStr) {
        inStr = null;
      }
      continue;
    }
    if (c === '"' || c === "'") inStr = c;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return src.length - 1;
}

function matchParen(src: string, openIndex: number): number {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = openIndex; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") inStr = c;
    else if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return src.length - 1;
}

function firstString(params: string): string {
  const m = params.match(/["']([^"']*)["']/);
  return m ? m[1] : "";
}

function parseModifier(params: string): KModifier {
  const mod: KModifier = {};
  const pad = params.match(/\.padding\((\d+)/);
  if (pad) mod.padding = Number(pad[1]);
  const w = params.match(/\.width\((\d+)/);
  if (w) mod.width = Number(w[1]);
  const h = params.match(/\.height\((\d+)/);
  if (h) mod.height = Number(h[1]);
  return mod;
}

const CONTAINERS = new Set(["Column", "Row", "Box", "BoxScope"]);
const IGNORED = new Set([
  "val",
  "var",
  "fun",
  "import",
  "package",
  "onClick",
  "Modifier",
  "fillMaxWidth",
  "fillMaxHeight",
  "wrapContentHeight",
  "wrapContentWidth",
]);

function parseNodeBlock(body: string, nodes: KNode[] = []): KNode[] {
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "," || c === ";") {
      i++;
      continue;
    }
    // identifier
    const idMatch = body.slice(i).match(/^[A-Za-z_][\w]*/);
    if (!idMatch) {
      // skip an unrecognised token (usually part of a qualified call) up to next non-ident
      i++;
      continue;
    }
    const name = idMatch[0];
    i += idMatch[0].length;
    if (IGNORED.has(name)) continue;

    let params = "";
    let block: string | null = null;

    // optional params ( ... )
    if (body[i] === "(") {
      const close = matchParen(body, i);
      params = body.slice(i + 1, close);
      i = close + 1;
    }
    // optional block { ... }
    if (body[i] === "{") {
      const close = matchBrace(body, i);
      block = body.slice(i + 1, close);
      i = close + 1;
    }

    const node: KNode = {
      kind: name,
      text: "",
      mod: parseModifier(params),
      onClick: params.includes("onClick"),
      children: block ? parseNodeBlock(block) : [],
    };
    if (name === "Button") {
      const childText = node.children.find((ch) => ch.kind === "Text" && ch.text);
      node.text = childText?.text ?? firstString(params);
    } else {
      node.text = firstString(params);
    }
    nodes.push(node);
  }
  return nodes;
}

function findComposableBody(src: string): string {
  const funMatch = src.match(/@Composable[\s\S]*?\bfun\s+\w+\s*\([^)]*\)\s*\{/);
  const idx = funMatch ? (funMatch.index ?? 0) + funMatch[0].lastIndexOf("{") : src.indexOf(`{`);
  if (idx < 0) return "";
  const close = matchBrace(src, idx);
  return src.slice(idx + 1, close);
}

function parseKotlin(src: string): KNode[] {
  try {
    return parseNodeBlock(findComposableBody(src));
  } catch {
    return [];
  }
}

const containerDir = (kind: string): "column" | "row" | "none" =>
  kind === "Column" ? "column" : kind === "Row" ? "row" : "none";

export function KotlinPreview({ source }: { source: string }) {
  const [tapped, setTapped] = useState<string | null>(null);

  const tree = useMemo(() => parseKotlin(source), [source]);

  useEffect(() => {
    setTapped(null);
  }, [tree]);

  const renderNode = (node: KNode, key: number): React.ReactNode => {
    const style: React.CSSProperties = {
      padding: node.mod.padding ?? 0,
      width: node.mod.width,
      height: node.mod.height,
      flexShrink: 0,
    };

    if (node.kind === "Spacer") {
      return <div key={key} style={{ height: node.mod.height ?? 12, width: "100%" }} />;
    }

    if (node.kind === "Text") {
      return (
        <span key={key} style={style} className="kptv__text">
          {node.text}
        </span>
      );
    }

    if (node.kind === "Button") {
      return (
        <button
          key={key}
          className="kptv__btn"
          style={{ padding: node.mod.padding != null ? node.mod.padding + 4 : 10 }}
          onClick={() => {
            setTapped(node.text || "button");
            setTimeout(() => setTapped(null), 900);
          }}
        >
          {node.text || (node.children.length ? node.children.map((ch, i) => renderNode(ch, i)) : "Button")}
        </button>
      );
    }

    if (node.kind === "Image") {
      return <div key={key} style={{ ...style, background: "linear-gradient(135deg,#2a2a3a,#1a1a24)", borderRadius: 8 }} />;
    }

    if (node.kind === "Divider") {
      return <div key={key} style={{ height: 1, width: "100%", background: "#262633", margin: 8 }} />;
    }

    const dir = containerDir(node.kind);
    if (dir !== "none") {
      return (
        <div
          key={key}
          style={{
            ...style,
            display: "flex",
            flexDirection: dir,
            alignItems: dir === "column" ? "stretch" : "center",
            justifyContent: dir === "column" ? "flex-start" : "flex-start",
            gap: 8,
            minWidth: 0,
            minHeight: 0,
          }}
        >
          {node.children.map((ch, i) => renderNode(ch, i))}
        </div>
      );
    }

    // Unknown composable → pass-through container
    return (
      <div key={key} style={{ ...style, display: "flex", flexDirection: "column", gap: 8, minWidth: 0, minHeight: 0 }}>
        {node.children.map((ch, i) => renderNode(ch, i))}
        {!node.children.length && node.text && (
          <span className="kptv__text">{node.text}</span>
        )}
      </div>
    );
  };

  const count = tree.length;
  const foundApp = tree.some((n) => CONTAINERS.has(n.kind) || n.kind === "Text");

  return (
    <div className="preview__source">
      <div className="preview__source__frame">
        <div className="preview__source__top">
          <Icon name="layers" size={12} /> Kotlin · Compose subset
          {tapped && <span className="preview__source__tapped">onClick → {tapped}</span>}
        </div>
        <div className="kptv">
          {tree.length === 0 ? (
            <div className="preview__source__empty">
              {foundApp
                ? "Nothing renders — add a @Composable function."
                : "No UI yet. Write a @Composable { Column { Text(\"…\") } } to preview."}
            </div>
          ) : (
            tree.map((n, i) => renderNode(n, i))
          )}
        </div>
      </div>
      <div className="preview__source__hint">
        {count > 0 ? `${count} composable${count === 1 ? "" : "s"} · Text/Button/Column/Row/Box/Spacer` : "Column · Row · Text · Button · Spacer"}
      </div>
    </div>
  );
}