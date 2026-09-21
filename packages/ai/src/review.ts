/**
 * CodeRabbit-style reviewer — deterministic rules engine + LLM pass.
 *
 * Every finding links to a corrective PatchOp the user can accept/reject.
 */

import type { DslNode, Project } from "@project/contracts";
import type {
  ReviewIssue,
  ReviewResult,
  ReviewRuleKind,
  ReviewSeverity,
} from "@project/contracts";
import type { ModelProvider, PatchProposal } from "@project/contracts";
import { schemaFor } from "@project/contracts";
import { buildContext } from "./intent.js";
import type { PatchOp } from "@project/contracts";

// ---------- deterministic rules ----------

interface RuleCheck {
  rule: ReviewRuleKind;
  severity: ReviewSeverity;
  check(nodes: DslNode[]): ReviewIssue[];
}

const LAYOUT_PROPS = new Set(["gap", "padding", "margin", "align", "justify"]);
const TEXT_ONLY_TYPES = new Set(["heading", "text", "badge"]);

const rules: RuleCheck[] = [
  {
    rule: "nesting",
    severity: "warning",
    check(nodes) {
      const issues: ReviewIssue[] = [];
      function walk(ns: DslNode[], depth: number) {
        for (const n of ns) {
          if (depth > 8) {
            issues.push({
              id: `nesting-${n.nodeId}`,
              rule: "nesting",
              severity: "warning",
              message: `Deeply nested node "${n.nodeId}" (${depth} levels). Consider flattening.`,
              nodeId: n.nodeId,
              fix: {
                summary: `Flatten ${n.nodeId}`,
                ops: [],
              },
            });
          }
          walk(n.children, depth + 1);
        }
      }
      walk(nodes, 0);
      return issues;
    },
  },
  {
    rule: "accessibility",
    severity: "error",
    check(nodes) {
      const issues: ReviewIssue[] = [];
      function walk(ns: DslNode[]) {
        for (const n of ns) {
          if (n.type === "button") {
            const text = n.props["text"];
            const hasTextProp =
              text &&
              ((text.t === "str" && text.v.trim().length > 0) ||
                (text.t === "ref" && text.v.length > 0));
            if (!hasTextProp) {
              issues.push({
                id: `button-no-text-${n.nodeId}`,
                rule: "accessibility",
                severity: "error",
                message: `Button "${n.nodeId}" has no text. Add text content for accessibility.`,
                nodeId: n.nodeId,
                fix: {
                  summary: `Add text to button ${n.nodeId}`,
                  ops: [
                    {
                      op: "set_text",
                      target: n.nodeId,
                      value: "Click me",
                    } satisfies PatchOp,
                  ],
                },
              });
            }
          }
          walk(n.children);
        }
      }
      walk(nodes);
      return issues;
    },
  },
  {
    rule: "unknown-prop",
    severity: "error",
    check(nodes) {
      const issues: ReviewIssue[] = [];
      function walk(ns: DslNode[]) {
        for (const n of ns) {
          const schema = schemaFor(n.type);
          if (schema) {
            for (const key of Object.keys(n.props)) {
              if (!(key in schema.props)) {
                issues.push({
                  id: `unknown-prop-${n.nodeId}-${key}`,
                  rule: "unknown-prop",
                  severity: "error",
                  message: `Property "${key}" is not valid for element type "${n.type}" on node "${n.nodeId}".`,
                  nodeId: n.nodeId,
                  fix: {
                    summary: `Remove invalid property "${key}" from ${n.nodeId}`,
                    ops: [
                      {
                        op: "remove_element",
                        target: n.nodeId,
                      } as PatchOp,
                    ],
                  },
                });
              }
            }
          }
          walk(n.children);
        }
      }
      walk(nodes);
      return issues;
    },
  },
  {
    rule: "id-collision",
    severity: "error",
    check(nodes) {
      const issues: ReviewIssue[] = [];
      const seen = new Map<string, DslNode>();
      function walk(ns: DslNode[]) {
        for (const n of ns) {
          if (seen.has(n.nodeId)) {
            issues.push({
              id: `dup-id-${n.nodeId}`,
              rule: "id-collision",
              severity: "error",
              message: `Duplicate nodeId "${n.nodeId}" found. Each node must have a unique ID.`,
              nodeId: n.nodeId,
            });
          } else {
            seen.set(n.nodeId, n);
          }
          walk(n.children);
        }
      }
      walk(nodes);
      return issues;
    },
  },
  {
    rule: "layout",
    severity: "warning",
    check(nodes) {
      const issues: ReviewIssue[] = [];
      function walk(ns: DslNode[]) {
        for (const n of ns) {
          if (TEXT_ONLY_TYPES.has(n.type)) {
            const hasLayoutProp = Object.keys(n.props).some((k) =>
              LAYOUT_PROPS.has(k),
            );
            if (hasLayoutProp) {
              const badProps = Object.keys(n.props).filter((k) =>
                LAYOUT_PROPS.has(k),
              );
              issues.push({
                id: `layout-on-text-${n.nodeId}`,
                rule: "layout",
                severity: "warning",
                message: `Text-only node "${n.nodeId}" (${n.type}) has layout properties [${badProps.join(", ")}]. These have no effect on text nodes.`,
                nodeId: n.nodeId,
                fix: {
                  summary: `Remove layout props from ${n.nodeId}`,
                  ops: badProps.map(
                    (p) =>
                      ({
                        op: "set_property",
                        target: n.nodeId,
                        property: p,
                        value: { t: "str", v: "" },
                      }) satisfies PatchOp,
                  ),
                },
              });
            }
          }
          walk(n.children);
        }
      }
      walk(nodes);
      return issues;
    },
  },
  {
    rule: "nesting",
    severity: "warning",
    check(nodes) {
      const issues: ReviewIssue[] = [];
      function walk(ns: DslNode[]) {
        for (const n of ns) {
          if (
            (n.type === "heading" || n.type === "text") &&
            n.children.length > 0
          ) {
            issues.push({
              id: `text-has-children-${n.nodeId}`,
              rule: "nesting",
              severity: "warning",
              message: `Text node "${n.nodeId}" has ${n.children.length} children. Text nodes should not have children.`,
              nodeId: n.nodeId,
              fix: {
                summary: `Remove children from ${n.nodeId}`,
                ops: n.children.map(
                  (c) =>
                    ({
                      op: "remove_element",
                      target: c.nodeId,
                    }) satisfies PatchOp,
                ),
              },
            });
          }
          walk(n.children);
        }
      }
      walk(nodes);
      return issues;
    },
  },
];

// ---------- deterministic pass ----------

function runRules(project: Project): ReviewIssue[] {
  const allNodes = [...project.pages, ...project.components];
  const issues: ReviewIssue[] = [];
  for (const rule of rules) {
    issues.push(...rule.check(allNodes));
  }
  return issues;
}

// ---------- LLM pass ----------

const REVIEW_SYSTEM = `You are a code reviewer for the Claro (.cl) reversible UI language.

Review the project and provide a short paragraph of feedback. Focus on:
- UI/UX improvements
- Missing elements that would improve the layout
- Accessibility concerns
- Consistency issues

Return JSON: {"feedback":"<paragraph>","suggestions":["suggestion 1","suggestion 2",...]}`;

async function runLlmPass(
  project: Project,
  provider: ModelProvider,
): Promise<string | null> {
  try {
    const ctx = buildContext(project);
    const userPrompt = `Project AST:\n${ctx.astJson}\n\nSchema:\n${ctx.schemaHint}`;

    const result = await provider.structuredComplete<{
      feedback: string;
      suggestions: string[];
    }>(REVIEW_SYSTEM, userPrompt, { feedback: "", suggestions: [] });

    const parts: string[] = [];
    if (result.feedback) parts.push(result.feedback);
    if (result.suggestions?.length) {
      parts.push("Suggestions:");
      result.suggestions.forEach((s, i) => parts.push(`  ${i + 1}. ${s}`));
    }
    return parts.join("\n") || null;
  } catch {
    return null;
  }
}

// ---------- main export ----------

export async function reviewProject(
  project: Project,
  provider?: ModelProvider,
): Promise<ReviewResult> {
  const issues = runRules(project);
  let modelSourced = false;

  if (provider) {
    const llmFeedback = await runLlmPass(project, provider);
    if (llmFeedback) {
      issues.push({
        id: "llm-feedback",
        rule: "semantic",
        severity: "info",
        message: llmFeedback,
      });
      modelSourced = true;
    }
  }

  return { issues, modelSourced };
}
