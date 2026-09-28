import {
  type Project,
  type DslNode,
  type Diagnostic,
  type PropValue,
  type ComponentParam,
  type SourceRange,
  type CommentNode,
  schemaFor,
  canonicalType,
  SYNONYMS,
  ELEMENTS,
  assignIds,
} from "@project/contracts";
import { tokenize, type Token } from "./tokenizer.js";

/**
 * Error-tolerant, whitespace-insensitive recursive-descent parser for Claro.
 *
 * Full tolerance contract (see docs/tolerance.md):
 * - The parse ALWAYS succeeds; problems become diagnostics, never exceptions.
 * - Case-insensitive types/keys/enums (canonicalized lowercase).
 * - Duplicate props: last-wins + warning.
 * - Levenshtein "did you mean" suggestions for types/keys/enums.
 * - Articles (`the`, `a`, `an`) before elements and conjunctions
 *   (`and`, `then`) between values are accepted and ignored.
 * - Diagnostics are deduped and capped.
 */

const UNITS = new Set(["px", "em", "rem", "fr"]);
const ARTICLES = new Set(["a", "an", "the"]);
const CONJUNCTIONS = new Set(["and", "then"]);
/** element types that also double as layout values -> keep them in value runs */
const LAYOUT_ENUMS = new Set(["stack", "row", "grid", "overlay", "column", "flex"]);
const NAMED_COLORS = new Set([
  "black", "white", "red", "green", "blue", "yellow", "orange", "purple",
  "pink", "gray", "grey", "cyan", "magenta", "brown", "transparent",
  "teal", "navy", "gold", "silver", "maroon", "olive", "lime", "aqua",
]);

const MAX_DIAGS = 64;
type Unit = "px" | "%" | "fr" | "em" | "rem";

/** Levenshtein distance — used for "did you mean" suggestions. */
export function suggestions(word: string, candidates: string[], max = 3): string[] {
  const lo = word.toLowerCase();
  const scored = candidates
    .map((c) => ({ c, d: distance(lo, c.toLowerCase()) }))
    .filter((x) => x.d >= 0 && x.d <= max)
    .sort((a, b) => a.d - b.d || a.c.length - b.c.length)
    .slice(0, 3)
    .map((x) => x.c);
  // strip exact matches
  return scored.filter((s) => s.toLowerCase() !== lo);

  function distance(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j];
        dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return dp[n];
  }
}

interface TokIter {
  toks: Token[];
  i: number;
}
function iter(toks: Token[]): TokIter {
  return { toks, i: 0 };
}
function peek(p: TokIter, off = 0): Token {
  return p.toks[Math.min(p.i + off, p.toks.length - 1)];
}
function next(p: TokIter): Token {
  const t = p.toks[Math.min(p.i, p.toks.length - 1)];
  if (p.i < p.toks.length - 1) p.i++;
  return t;
}
function rangeOf(t: Token): SourceRange {
  return { start: { line: t.line, col: t.col }, end: { line: t.line, col: t.col + t.value.length }, text: t.value };
}

const ALL_PROPS = new Set<string>();
for (const e of Object.values(ELEMENTS)) for (const k of Object.keys(e.props)) ALL_PROPS.add(k);
const ALL_TYPES = new Set<string>([...Object.keys(ELEMENTS), ...Object.values(SYNONYMS)]);

export class Parser {
  private diags: Diagnostic[] = [];

  parse(source: string): Project {
    const { tokens, errors: tokErrors } = tokenize(source);
    for (const e of tokErrors) {
      this.diags.push({
        severity: "error",
        code: "unterminated-string",
        message: e.message,
        range: { start: { line: e.line, col: e.col }, end: { line: e.line, col: e.col + 1 }, text: "" },
      });
    }
    const comments: CommentNode[] = [];
    const code = tokens.filter((t) => {
      if (t.type === "comment") {
        comments.push({ text: t.value, line: t.line });
        return false;
      }
      return true;
    });
    const p = iter(code);
    const pages: DslNode[] = [];
    const components: DslNode[] = [];
    let implicit: DslNode | null = null;
    let pageCount = 0;

    while (peek(p).type !== "eof") {
      if (this.atKeyword(p, "page")) {
        pages.push(this.parsePage(p));
        pageCount++;
        if (pageCount > 1) this.warn("duplicate-page", "only one page per file in v1", pages[pages.length - 1].source);
      } else if (this.atKeyword(p, "component")) {
        components.push(this.parseComponent(p));
      } else {
        const el = this.parseElementStatement(p);
        if (el) {
          if (!implicit) {
            implicit = this.barePage("Root");
            this.info("Implicit page", "missing `page` — content wrapped in `page Root`", el.source);
          }
          implicit.children.push(el);
        } else {
          const before = p.i;
          this.recover(p);
          if (p.i === before) next(p); // never stall on a lone `}` or stray token
        }
      }
    }

    if (implicit) pages.push(implicit);
    if (pageCount === 0 && !implicit && components.length === 0) {
      const pg = this.barePage("Home");
      this.info("Implicit page", "empty file — bootstrapped `page Home`", pg.source);
      pages.push(pg);
    }

    const project: Project = { meta: { version: "1.0", fileType: ".cl" }, pages, components, diagnostics: this.dedup() };
    this.attachComments(project, comments);
    assignIds([...pages, ...components]);
    return project;
  }

  /**
   * Attach comment trivia structurally so the formatter can emit them at depth
   * and never drop them. Every comment is anchored to exactly one emission slot:
   *  - lead: the statement it immediately precedes (node.comments)
   *  - tail: the last statement inside the enclosing body before its `}`
   *          (node.tailComments)
   *  - file: before any statement (project.comments)
   * Anchoring is by body extent (element lines), which survives a format
   * round-trip, so format(format(x)) === format(x) holds.
   */
  private attachComments(project: Project, comments: CommentNode[]): void {
    if (comments.length === 0) return;

    interface Stmt { node: DslNode; start: number; end: number; depth: number }
    const stmts: Stmt[] = [];
    const walk = (n: DslNode, depth: number) => {
      stmts.push({ node: n, start: n.source.start.line, end: n.source.end.line, depth });
      for (const c of n.children) walk(c, depth + 1);
    };
    for (const p of project.pages) walk(p, 0);
    for (const c of project.components) walk(c, 0);

    for (const c of comments) {
      // deepest statement whose body contains the comment line
      let container: Stmt | undefined;
      for (const s of stmts) {
        if (c.line > s.start && c.line <= s.end && s.depth >= (container?.depth ?? -1)) container = s;
      }
      if (!container) {
        (project.comments ??= []).push(c);
        continue;
      }
      // first child after the comment -> lead comment on that child
      let target: DslNode | undefined;
      for (const child of container.node.children) {
        if (child.source.start.line > c.line) { target = child; break; }
      }
      if (target) (target.comments ??= []).push(c);
      else (container.node.tailComments ??= []).push(c);
    }

    const sortComments = (n: DslNode) => {
      n.comments?.sort((a, b) => a.line - b.line);
      n.tailComments?.sort((a, b) => a.line - b.line);
      for (const c of n.children) sortComments(c);
    };
    for (const p of project.pages) sortComments(p);
    for (const c of project.components) sortComments(c);
    project.comments?.sort((a, b) => a.line - b.line);
  }

  private barePage(name: string): DslNode {
    return {
      kind: "page",
      nodeId: "",
      type: "page",
      name,
      props: {},
      children: [],
      source: { start: { line: 1, col: 1 }, end: { line: 1, col: 1 }, text: "" },
    };
  }

  private atKeyword(p: TokIter, kw: string): boolean {
    const t = peek(p);
    return t.type === "ident" && t.value.toLowerCase() === kw;
  }

  private parsePage(p: TokIter): DslNode {
    const t = next(p); // 'page'
    let name = "Home";
    if (peek(p).type === "ident") name = next(p).value;
    const node: DslNode = { kind: "page", nodeId: "", type: "page", name, props: {}, children: [], source: rangeOf(t) };
    this.ensureLbrace(p, node.source, "page");
    this.parseBody(p, node);
    this.validateNode(node);
    return node;
  }

  private parseComponent(p: TokIter): DslNode {
    const t = next(p); // 'component'
    let name = "";
    if (peek(p).type === "ident") name = next(p).value;
    else this.error("expected-component-name", "expected a name after `component`", rangeOf(t));
    if (name && (ELEMENTS[name.toLowerCase()] || ALL_TYPES.has(name.toLowerCase()))) {
      this.error("reserved-name", `\`${name}\` is reserved — pick another name`, rangeOf(peek(p, -1)));
    }
    const params = this.parseParams(p);
    const node: DslNode = { kind: "component", nodeId: "", type: name, name, params, props: {}, children: [], source: rangeOf(t) };
    this.ensureLbrace(p, node.source, "component");
    this.parseBody(p, node);
    this.validateNode(node);
    return node;
  }

  private parseParams(p: TokIter): ComponentParam[] {
    const params: ComponentParam[] = [];
    if (peek(p).type !== "lparen") return params;
    next(p); // (
    while (peek(p).type !== "rparen" && peek(p).type !== "eof") {
      if (peek(p).type !== "ident") {
        next(p); // tolerate stray tokens
        continue;
      }
      const nm = next(p).value;
      let ty = "string";
      if (peek(p).type === "colon") {
        next(p);
        if (peek(p).type === "ident" || peek(p).type === "string") ty = next(p).value;
      }
      params.push({ name: nm, type: ty });
      if (peek(p).type === "comma") next(p);
    }
    if (peek(p).type === "rparen") next(p);
    else this.error("unbalanced-parens", "unterminated parameter list", rangeOf(peek(p, -1)));
    return params;
  }

  private ensureLbrace(p: TokIter, _fallback: SourceRange, what: string): void {
    if (peek(p).type === "lbrace") {
      next(p);
      return;
    }
    this.error("expected-brace", `expected { to open ${what}`, rangeOf(peek(p)));
  }

  private parseBody(p: TokIter, node: DslNode): void {
    for (let guard = 0; guard < 100000 && peek(p).type !== "eof" && peek(p).type !== "rbrace"; guard++) {
      const t = peek(p);
      if (t.type === "lbrace") {
        this.error("unexpected-brace", "stray { in body", rangeOf(t));
        next(p);
        this.recoverUntil(p, "rbrace");
        continue;
      }
      if (t.type === "string" || t.type === "number" || t.type === "color" || t.type === "ref") {
        this.error("unexpected-token", `unexpected '${t.value || t.type}'`, rangeOf(t));
        next(p);
        continue;
      }
      if (t.type !== "ident") {
        this.error("unexpected-token", `unexpected '${t.value || t.type}'`, rangeOf(t));
        next(p);
        continue;
      }
      // article tolerance: `the button "Go"` -> skip article then element
      if (ARTICLES.has(t.value.toLowerCase()) && this.elementStarts(p, 1)) {
        next(p);
        const el = this.parseElementStatement(p);
        if (el) node.children.push(el);
        continue;
      }
      // property?
      if (peek(p, 1).type === "colon") {
        const { key, value, range } = this.parseProperty(p);
        if (key) this.setProp(node, key, value, range);
        continue;
      }
      // a known prop key without ':' -> missing-colon tolerance
      if (ALL_PROPS.has(t.value.toLowerCase())) {
        this.warn("missing-colon", `property '${t.value}' is missing ':' — treated as '${t.value}: …'`, rangeOf(t));
        next(p);
        const value = this.parseValueRun(p);
        if (value) this.setProp(node, t.value.toLowerCase(), value, rangeOf(t));
        continue;
      }
      const el = this.parseElementStatement(p);
      if (el) node.children.push(el);
      else {
        const before = p.i;
        this.recover(p);
        if (p.i === before) next(p); // never stall
      }
    }
    if (peek(p).type === "rbrace") {
      const close = next(p);
      // record the body extent so comments can be re-interleaved structurally
      node.source = { ...node.source, end: { line: close.line, col: close.col + 1 } };
    }
  }

  private elementStarts(p: TokIter, off: number): boolean {
    const t1 = peek(p, off);
    if (t1.type !== "ident") return false;
    const t2 = peek(p, off + 1);
    return t2.type === "ident" || t2.type === "string" || t2.type === "lbrace";
  }

  private parseElementStatement(p: TokIter): DslNode | null {
    if (peek(p).type !== "ident") return null;
    const t = next(p);
    const raw = t.value;
    const type = canonicalType(raw.toLowerCase());
    if (!ALL_TYPES.has(type)) {
      const sug = suggestions(raw, [...ALL_TYPES]);
      this.warn("unknown-type", `unknown element '${raw}'${sug.length ? ` — did you mean ${sug.map((s) => `'${s}'`).join(" or ")}?` : ""}`, rangeOf(t));
    }
    const node: DslNode = { kind: "element", nodeId: "", type, props: {}, children: [], source: rangeOf(t) };

    // optional name: ident not followed by ':' (a name is never a value here)
    if (peek(p).type === "ident" && peek(p, 1).type !== "colon") {
      node.name = next(p).value;
    }

    // optional text content (string) or text bound to an @param ref
    if (peek(p).type === "string") {
      node.text = next(p).value;
      const sch = schemaFor(node.type);
      if (sch && !sch.textContent) this.warn("unexpected-text", `'${node.type}' does not take text content`, rangeOf(peek(p, -1)));
    } else if (peek(p).type === "ref") {
      node.textRef = next(p).value;
      const sch = schemaFor(node.type);
      if (sch && !sch.textContent) this.warn("unexpected-text", `'${node.type}' does not take text content`, rangeOf(peek(p, -1)));
    }

    // optional body
    if (peek(p).type === "lbrace") {
      next(p);
      this.parseBody(p, node);
    } else {
      node.source = rangeOf(t);
    }
    this.validateNode(node);
    return node;
  }

  private parseProperty(p: TokIter): { key: string | null; value: PropValue | null; range: SourceRange } {
    const t = next(p); // key
    const key = t.value.toLowerCase();
    if (peek(p).type !== "colon") {
      this.error("expected-colon", `expected ':' after '${key}'`, rangeOf(t));
      return { key: null, value: null, range: rangeOf(t) };
    }
    next(p); // ':'
    const value = this.parseValueRun(p);
    if (!value) this.error("expected-value", `expected a value for '${key}'`, rangeOf(peek(p)));
    return { key, value, range: rangeOf(t) };
  }

  private parseValue(p: TokIter): PropValue | null {
    const t = peek(p);
    switch (t.type) {
      case "number": {
        next(p);
        let unit: Unit | undefined;
        if (peek(p).type === "percent") { next(p); unit = "%"; }
        else if (peek(p).type === "ident" && UNITS.has(peek(p).value.toLowerCase())) unit = next(p).value.toLowerCase() as Unit;
        return { t: "num", v: parseFloat(t.value), unit };
      }
      case "string": { next(p); return { t: "str", v: t.value }; }
      case "color": { next(p); return { t: "color", v: t.value }; }
      case "ref": { next(p); return { t: "ref", v: t.value }; }
      case "lbracket": {
        next(p);
        const list: PropValue[] = [];
        while (peek(p).type !== "rbracket" && peek(p).type !== "eof") {
          if (peek(p).type === "comma") { next(p); continue; }
          const v = this.parseValue(p);
          if (v) list.push(v);
          else next(p);
        }
        if (peek(p).type === "rbracket") next(p);
        else this.error("unbalanced-bracket", "unterminated value list", rangeOf(peek(p, -1)));
        return { t: "list", v: list };
      }
      case "ident": {
        const low = t.value.toLowerCase();
        if (low === "true") { next(p); return { t: "bool", v: true }; }
        if (low === "false") { next(p); return { t: "bool", v: false }; }
        if ((low === "rgb" || low === "rgba") && peek(p, 1).type === "lparen") {
          next(p);
          return { t: "color", v: this.consumeColorFunction(p, t.value) };
        }
        next(p);
        return { t: "enum", v: low };
      }
      default:
        return null;
    }
  }

  private consumeColorFunction(p: TokIter, fn: string): string {
    let s = fn + "(";
    let depth = 0;
    while (peek(p).type !== "eof") {
      const tk = next(p);
      if (tk.type === "lparen") depth++;
      if (tk.type === "rparen") {
        depth--;
        s += ")";
        if (depth <= 0) break;
        continue;
      }
      if (tk.type === "comma") s += ",";
      else s += tk.value;
    }
    if (depth > 0) this.error("unbalanced-parens", "unterminated color function", rangeOf(peek(p, -1)));
    return s;
  }

  /** Parse a run of values (tuple) with stop rules; a single value stays scalar. */
  private parseValueRun(p: TokIter): PropValue | null {
    const vals: PropValue[] = [];
    let hadAny = false;
    for (let guard = 0; guard < 50; guard++) {
      if (this.stopValueRun(p)) break;
      if (hadAny && peek(p).type === "ident" && CONJUNCTIONS.has(peek(p).value.toLowerCase())) {
        next(p); // conjunction tolerance: `gap: 24 and align: center`
        continue;
      }
      const v = this.parseValue(p);
      if (!v) break;
      vals.push(v);
      hadAny = true;
    }
    if (vals.length === 0) return null;
    return vals.length === 1 ? vals[0] : { t: "tuple", v: vals };
  }

  private stopValueRun(p: TokIter): boolean {
    const t = peek(p);
    if (t.type === "eof" || t.type === "rbrace" || t.type === "rparen" || t.type === "rbracket") return true;
    if (t.type === "ident") {
      const low = t.value.toLowerCase();
      if (CONJUNCTIONS.has(low)) return false;
      if (ARTICLES.has(low)) return true; // article belongs to the next statement (`gap: 24 the button "Go"`)
      const nxt = peek(p, 1);
      if (nxt.type === "colon") return true; // next property begins
      if (nxt.type === "lparen") return false; // color function continues the run
      if (nxt.type === "string" || nxt.type === "lbrace") return true; // element w/ text or body begins
      if (nxt.type === "ident" && peek(p, 2).type === "colon") return false; // value then prop key: `layout: stack padding: 48`
      // element name form: TYPE [NAME] { ... } — stop only when the current token is
      // itself a type. Layout enums double as values, so keep them in the run.
      if (ALL_TYPES.has(low) && !LAYOUT_ENUMS.has(low)) return true;
    }
    return false;
  }

  private setProp(node: DslNode, key: string, value: PropValue | null, range: SourceRange): void {
    if (!value) return;
    if (node.props[key] !== undefined) this.warn("dup-prop", `duplicate property '${key}' — last value wins`, range);
    node.props[key] = value;
  }

  private validateNode(node: DslNode): void {
    const sch = schemaFor(node.type);
    if (sch) {
      for (const [key, value] of Object.entries(node.props)) {
        const ps = sch.props[key];
        if (!ps) {
          const sug = suggestions(key, Object.keys(sch.props));
          this.warn("unknown-prop", `unknown property '${key}' on '${node.type}'${sug.length ? ` — did you mean ${sug.map((s) => `'${s}'`).join(" or ")}?` : ""}`, node.source, node.nodeId);
          continue;
        }
        this.checkValue(key, value, ps.kind, ps.values);
      }
    }
    for (const c of node.children) this.validateNode(c);
  }

  private checkValue(key: string, value: PropValue, kind: string, enums: string[] | undefined): void {
    switch (kind) {
      case "enum": {
        if (value.t === "enum" && !(enums ?? []).includes(value.v)) {
          const sug = suggestions(value.v, enums ?? []);
          this.warn("bad-enum", `'${value.v}' is not valid for '${key}'${sug.length ? ` — did you mean ${sug.map((s) => `'${s}'`).join(" or ")}?` : ""}`);
        } else if (value.t !== "enum") this.badValue(key, kind, value);
        break;
      }
      case "color": {
        if (value.t === "enum" && !NAMED_COLORS.has(value.v)) this.warn("bad-color", `'${value.v}' is not a known color for '${key}'`);
        else if (value.t !== "color" && value.t !== "enum") this.badValue(key, kind, value);
        break;
      }
      case "number": { if (value.t !== "num") this.badValue(key, kind, value); break; }
      case "string": { if (value.t !== "str") this.badValue(key, kind, value); break; }
      case "boolean": { if (value.t !== "bool") this.badValue(key, kind, value); break; }
      default: break; // tuple/list validated structurally by the value parser
    }
  }

  private badValue(key: string, kind: string, value: PropValue): void {
    this.warn("bad-value", `'${key}' expects ${kind}, got ${value.t}`);
  }

  private recover(p: TokIter): void {
    for (let guard = 0; guard < 512 && peek(p).type !== "eof"; guard++) {
      const t = peek(p);
      if (t.type === "rbrace" || t.type === "rparen") return;
      if (t.type === "ident" && peek(p, 1).type === "colon") return;
      next(p);
    }
  }

  private recoverUntil(p: TokIter, stop: "rbrace" | "rparen"): void {
    for (let guard = 0; guard < 512 && peek(p).type !== "eof"; guard++) {
      if (peek(p).type === stop) return;
      next(p);
    }
  }

  private error(code: string, message: string, range: SourceRange): void {
    this.diags.push({ severity: "error", code, message, range });
  }
  private warn(code: string, message: string, range?: SourceRange, nodeId?: string): void {
    this.diags.push({ severity: "warning", code, message, range, nodeId });
  }
  private info(message: string, detail: string, range: SourceRange): void {
    this.diags.push({ severity: "info", message: `${message}: ${detail}`, range });
  }

  private dedup(): Diagnostic[] {
    const seen = new Set<string>();
    const out: Diagnostic[] = [];
    for (const d of this.diags) {
      const k = `${d.severity}|${d.message}|${d.range?.start.line ?? 0}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (out.length >= MAX_DIAGS) break;
      out.push(d);
    }
    return out.sort((a, b) => prio(a) - prio(b));
  }
}

function prio(d: Diagnostic): number {
  const sev = d.severity === "error" ? 0 : d.severity === "warning" ? 1 : 2;
  return sev * 10000 + (d.range?.start.line ?? 0);
}

/** Parse a .cl source string into a Project. Never throws on malformed input. */
export function parse(source: string): Project {
  return new Parser().parse(source);
}