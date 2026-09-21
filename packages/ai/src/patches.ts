/**
 * Patch application for the AI lane.
 *
 * Agent 1's engine is the single source of truth — every op the AI suggests is
 * validated and applied by @project/dsl. The CLI commands we used to enforce
 * `applyOps` on the AI branch are the same ones the IDE uses on the UI branch,
 * so an applyOp never behaves differently depending on which agent shipped it.
 */

export { applyOps, applyOp } from "@project/dsl";

import type { PropValue } from "@project/contracts";

/** Convenience: build a minimal PropValue from a plain value. */
export function prop(v: string | number | boolean): PropValue {
  if (typeof v === "string") {
    if (v.startsWith("#") || v.startsWith("rgb"))
      return { t: "color", v };
    return { t: "str", v };
  }
  if (typeof v === "number") return { t: "num", v };
  return { t: "bool", v };
}