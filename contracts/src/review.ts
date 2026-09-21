import type { SourceRange } from "./ast.js";

/** Built-in reviewer issue kinds (deterministic checks first; see packages/ai). */
export type ReviewRuleKind =
  | "accessibility"
  | "layout"
  | "performance"
  | "contrast"
  | "unknown-prop"
  | "unused-component"
  | "id-collision"
  | "nesting"
  | "naming"
  | "semantic";

export type ReviewSeverity = "error" | "warning" | "info";

export interface ReviewIssue {
  id: string;
  rule: ReviewRuleKind;
  severity: ReviewSeverity;
  message: string;
  nodeId?: string;
  range?: SourceRange;
  /** optional op-batch to fix it — generated deterministically where possible */
  fix?: { summary: string; ops: unknown[] };
}

export interface ReviewResult {
  issues: ReviewIssue[];
  modelSourced: boolean;
}