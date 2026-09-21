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

export interface DslNode {
  kind: "page" | "component" | "element";
  /** Stable identity, dotted path of (name ?? type), disambiguated with :n. See contracts/src/ids.ts */
  nodeId: string;
  type: string;
  name?: string;
  props: Record<string, PropValue>;
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
  diagnostics: Diagnostic[];
}