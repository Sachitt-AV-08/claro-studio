import type { DslNode, PropValue } from "./ast.js";

/**
 * Patch operations — the single mutation vocabulary. Every change from
 * drag, inspector, AI, or reviewer "Fix" reduces to these ops.
 * The deterministic applier lives in @project/dsl (packages/dsl).
 */

export type PatchOp =
  | { op: "set_property"; target: string; property: string; value: PropValue }
  | { op: "clear_property"; target: string; property: string }
  | { op: "set_text"; target: string; property?: string; value: string }
  | { op: "add_element"; parent: string; element: DslNode; position: "before" | "after" | "last"; ref?: string }
  | { op: "remove_element"; target: string }
  | { op: "move_element"; target: string; position: "first" | "last" | "before" | "after"; ref?: string }
  | { op: "set_layout"; target: string; layout: "stack" | "row" | "grid" | "overlay" }
  | { op: "set_effects"; target: string; effect: string };

export type ApplyResult =
  | { ok: true; ops: PatchOp[]; inverse: PatchOp[] }
  | { ok: false; error: string; op?: PatchOp };

export interface PatchBatch {
  summary: string;
  ops: PatchOp[];
}

/** Pure validator — must run on every PatchBatch before it touches an AST. */
export function validateOps(ops: PatchOp[]): { ok: true } | { ok: false; error: string; op?: PatchOp } {
  for (const op of ops) {
    // every op targets a node: `target`, or `parent` for add_element
    const nodeRef = (op as { target?: string }).target ?? (op as { parent?: string }).parent;
    if (!nodeRef || typeof nodeRef !== "string") {
      return { ok: false, error: "op missing target", op };
    }
    switch (op.op) {
      case "set_property":
        if (!op.property || !op.value) return { ok: false, error: "set_property needs property+value", op };
        break;
      case "clear_property":
        if (!op.property) return { ok: false, error: "clear_property needs property", op };
        break;
      case "set_text":
        if (typeof op.value !== "string") return { ok: false, error: "set_text needs string value", op };
        break;
      case "add_element":
        if (!op.element) return { ok: false, error: "add_element needs element", op };
        break;
      case "remove_element":
        break;
      case "set_effects":
        if (!op.effect) return { ok: false, error: "set_effects needs effect", op };
        break;
      case "move_element": {
        if (op.position === "before" || op.position === "after") {
          if (!op.ref) return { ok: false, error: "move before/after needs ref", op };
        }
        break;
      }
      case "set_layout":
        if (!["stack", "row", "grid", "overlay"].includes(op.layout)) {
          return { ok: false, error: `unknown layout ${op.layout}`, op };
        }
        break;
      default:
        return { ok: false, error: `unknown op ${(op as PatchOp).op}`, op };
    }
  }
  return { ok: true };
}