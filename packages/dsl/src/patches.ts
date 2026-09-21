import {
  type Project,
  type DslNode,
  type PatchOp,
  type ApplyResult,
  validateOps,
  nodeById,
  schemaFor,
} from "@project/contracts";

/**
 * Deterministic patch applier (contracts/src/patches.ts). Every mutation from
 * drag, inspector, AI, or reviewer "Fix" reduces to these ops and lands here.
 *
 * - Validates the whole batch first — a bad batch never partially applies.
 * - Every applied op records a best-effort inverse op batch, including
 *   `clear_property` for un-setting a prop that did not exist before.
 *   set_text on a node with no prior text has no inverse (snapshot covers it).
 *
 * Applies in place against `project` (pages + components).
 */

interface Row {
  node: DslNode;
  parent: DslNode | null;
  index: number;
}

export function applyOps(project: Project, ops: PatchOp[]): ApplyResult {
  const v = validateOps(ops);
  if (!v.ok) return v;

  const rows = indexAll(project);
  for (const op of ops) {
    const bad = preflight(op, rows);
    if (bad) return { ok: false, error: bad, op };
  }

  const inverse: PatchOp[] = [];
  for (const op of ops) applyOne(rows, op, inverse);
  return { ok: true, ops, inverse };
}

function indexAll(project: Project): Row[] {
  const out: Row[] = [];
  const roots = [...project.pages, ...project.components];
  const walk = (node: DslNode, parent: DslNode | null, index: number) => {
    out.push({ node, parent, index });
    node.children.forEach((c, i) => walk(c, node, i));
  };
  roots.forEach((r, i) => walk(r, null, i));
  return out;
}

function rowById(rows: Row[], id: string): Row | undefined {
  return rows.find((r) => r.node.nodeId === id);
}

function preflight(op: PatchOp, rows: Row[]): string | null {
  switch (op.op) {
    case "set_property":
    case "clear_property":
    case "set_text":
      if (!rowById(rows, op.target)) return `target not found: ${op.target}`;
      break;
    case "add_element": {
      if (!rowById(rows, op.parent)) return `parent not found: ${op.parent}`;
      if (op.position !== "last" && op.ref != null && !rowById(rows, op.ref)) return `ref not found: ${op.ref}`;
      break;
    }
    case "remove_element":
    case "set_layout":
    case "set_effects": {
      const r = rowById(rows, op.target);
      if (!r) return `target not found: ${op.target}`;
      break;
    }
    case "move_element": {
      const r = rowById(rows, op.target);
      if (!r) return `target not found: ${op.target}`;
      if (!r.parent) return `cannot move root: ${op.target}`;
      if ((op.position === "before" || op.position === "after") && op.ref != null && !rowById(rows, op.ref)) {
        return `ref not found: ${op.ref}`;
      }
      break;
    }
  }
  return null;
}

function applyOne(rows: Row[], op: PatchOp, inverse: PatchOp[]): void {
  switch (op.op) {
    case "set_property": {
      const r = rowById(rows, op.target)!;
      const prev = r.node.props[op.property];
      r.node.props[op.property] = cloneValue(op.value);
      if (prev) inverse.push({ op: "set_property", target: op.target, property: op.property, value: cloneValue(prev) });
      else inverse.push({ op: "clear_property", target: op.target, property: op.property });
      break;
    }
    case "clear_property": {
      const r = rowById(rows, op.target)!;
      const prev = r.node.props[op.property];
      delete r.node.props[op.property];
      if (prev) inverse.push({ op: "set_property", target: op.target, property: op.property, value: cloneValue(prev) });
      break;
    }
    case "set_text": {
      const r = rowById(rows, op.target)!;
      const prev = r.node.text;
      r.node.text = op.value;
      if (prev !== undefined) inverse.push({ op: "set_text", target: op.target, value: prev });
      break;
    }
    case "add_element": {
      const parent = rowById(rows, op.parent)!.node;
      const el = cloneNode(op.element);
      let index = parent.children.length; // default 'last'
      if (op.position !== "last" && op.ref != null) {
        const r = parent.children.findIndex((c) => c.nodeId === op.ref);
        index = op.position === "before" ? r : r + 1;
      }
      parent.children.splice(index, 0, el);
      inverse.push({ op: "remove_element", target: el.nodeId });
      break;
    }
    case "remove_element": {
      const r = rowById(rows, op.target)!;
      if (!r.parent) return;
      const removed = r.parent.children.splice(r.index, 1)[0];
      const refBefore = r.index > 0 ? r.parent.children[r.index - 1]?.nodeId : undefined;
      const refAfter = r.parent.children[r.index]?.nodeId; // sibling that followed
      inverse.push({
        op: "add_element",
        parent: r.parent.nodeId,
        element: cloneNode(removed),
        position: refBefore ? "after" : refAfter ? "before" : "last",
        ref: refBefore ?? refAfter ?? undefined,
      });
      break;
    }
    case "move_element": {
      const r = rowById(rows, op.target)!;
      const parent = r.parent!;
      // capture PRE-move neighbors so the inverse lands back in the old slot
      const prevSib = r.index > 0 ? parent.children[r.index - 1].nodeId : undefined;
      const nextSib = r.index + 1 < parent.children.length ? parent.children[r.index + 1].nodeId : undefined;
      const moved = parent.children.splice(r.index, 1)[0];
      let index: number;
      if (op.position === "first") index = 0;
      else if (op.position === "last") index = parent.children.length;
      else {
        const refIdx = parent.children.findIndex((c) => c.nodeId === op.ref);
        index = op.position === "before" ? refIdx : refIdx + 1;
      }
      parent.children.splice(index, 0, moved);
      inverse.push({
        op: "move_element",
        target: op.target,
        position: prevSib ? "after" : nextSib ? "before" : "first",
        ref: prevSib ?? nextSib ?? undefined,
      });
      break;
    }
    case "set_layout": {
      const r = rowById(rows, op.target)!;
      const prev = r.node.props.layout;
      r.node.props.layout = { t: "enum", v: op.layout };
      if (prev && prev.t === "enum") inverse.push({ op: "set_layout", target: op.target, layout: prev.v as "stack" | "row" | "grid" | "overlay" });
      else inverse.push({ op: "clear_property", target: op.target, property: "layout" });
      break;
    }
    case "set_effects": {
      const r = rowById(rows, op.target)!;
      const prev = r.node.props.effect;
      r.node.props.effect = { t: "enum", v: op.effect };
      if (prev && prev.t === "enum") inverse.push({ op: "set_effects", target: op.target, effect: prev.v });
      else inverse.push({ op: "clear_property", target: op.target, property: "effect" });
      break;
    }
  }
}

function cloneValue<T>(v: T): T {
  return structuredClone(v);
}

function cloneNode(n: DslNode): DslNode {
  return structuredClone(n);
}

/** Convenience: apply a single op (batch of one). */
export function applyOp(project: Project, op: PatchOp): ApplyResult {
  return applyOps(project, [op]);
}

/** Re-export the frozen validator so callers can check before touching an AST. */
export { validateOps };

/** Re-export schema helper so reversible "Fix" actions can validate values. */
export { schemaFor };

// re-export for any caller that resolves targets directly
export { nodeById };