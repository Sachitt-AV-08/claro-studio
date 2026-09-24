export interface Pos {
  line: number;
  col: number;
}

export interface SourceRange {
  start: Pos;
  end: Pos;
  text: string;
}

export type PropValue =
  | { t: "num"; v: number; unit?: "px" | "%" | "fr" | "em" | "rem" }
  | { t: "str"; v: string }
  | { t: "color"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "enum"; v: string }
  | { t: "tuple"; v: PropValue[] }
  | { t: "list"; v: PropValue[] }
  | { t: "ref"; v: string };

export interface ComponentParam {
  name: string;
  type: string;
}

/** A line comment captured as trivia so format() never drops it. */
export interface CommentNode {
  /** Comment text WITH the leading `# ` or `// ` marker stripped by the parser. */
  text: string;
  /** 1-based source line (used to re-interleave comments in format()). */
  line: number;
}

export interface DslNode {
  kind: "page" | "component" | "element";
  /** Stable identity, dotted path of (name ?? type), disambiguated with :n. See contracts/src/ids.ts */
  nodeId: string;
  type: string;
  name?: string;
  props: Record<string, PropValue>;
  /** comments attached to this node (before its header or inside its body) */
  comments?: CommentNode[];
  /** comments trailing the body, emitted just before the closing `}` */
  tailComments?: CommentNode[];
  /** components only */
  params?: ComponentParam[];
  /** text content for textContent elements: `heading "Hello"` -> "Hello" */
  text?: string;
  /** text content bound to an @param ref: `heading @title` -> "title" */
  textRef?: string;
  children: DslNode[];
  source: SourceRange;
}

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  code?: string;
  range?: SourceRange;
  nodeId?: string;
}

export interface Project {
  meta: { version: "1.0"; fileType: ".cl" };
  pages: DslNode[];
  components: DslNode[];
  /** file-level comments not attached to any node, in source order */
  comments?: CommentNode[];
  diagnostics: Diagnostic[];
}