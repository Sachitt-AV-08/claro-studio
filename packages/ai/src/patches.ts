/**
 * Stub patch applier — minimal AST walker that applies PatchOps + returns inverses.
 * TODO: Replace with @project/dsl implementation when Agent 1 lands.
 */

import type { DslNode, PropValue } from "@project/contracts";
import type { PatchOp, ApplyResult } from "@project/contracts";

// ---------- helpers ----------

function cloneNode(n: DslNode): DslNode {
  return {
    ...n,
    props: { ...n.props },
    children: n.children.map(cloneNode),
  };
}

function findNode(nodes: DslNode[], nodeId: string): DslNode | undefined {
  for (const n of nodes) {
    if (n.nodeId === nodeId) return n;
    const hit = findNode(n.children, nodeId);
    if (hit) return hit;
  }
  return undefined;
}

function findParent(
  nodes: DslNode[],
  nodeId: string,
): { parent: DslNode; index: number } | undefined {
  for (const n of nodes) {
    const idx = n.children.findIndex((c) => c.nodeId === nodeId);
    if (idx !== -1) return { parent: n, index: idx };
    const hit = findParent(n.children, nodeId);
    if (hit) return hit;
  }
  return undefined;
}

function removeNode(nodes: DslNode[], nodeId: string): DslNode | undefined {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].nodeId === nodeId) {
      return nodes.splice(i, 1)[0];
    }
    const removed = removeNode(nodes[i].children, nodeId);
    if (removed) return removed;
  }
  return undefined;
}

// ---------- main applier ----------

export function applyOps(
  pages: DslNode[],
  ops: PatchOp[],
): ApplyResult {
  const inverses: PatchOp[] = [];

  for (const op of ops) {
    switch (op.op) {
      case "set_property": {
        const node = findNode(pages, op.target);
        if (!node) return { ok: false, error: `node ${op.target} not found`, op };
        const prev = node.props[op.property];
        node.props[op.property] = op.value;
        if (prev) {
          inverses.push({ op: "set_property", target: op.target, property: op.property, value: prev });
        }
        break;
      }
      case "set_text": {
        const node = findNode(pages, op.target);
        if (!node) return { ok: false, error: `node ${op.target} not found`, op };
        const prop = op.property ?? "text";
        const prev = node.props[prop];
        node.props[prop] = { t: "str", v: op.value };
        if (prev) {
          inverses.push({ op: "set_property", target: op.target, property: prop, value: prev });
        }
        break;
      }
      case "add_element": {
        const parent = findNode(pages, op.parent);
        if (!parent) return { ok: false, error: `parent ${op.parent} not found`, op };
        const el = cloneNode(op.element);
        if (op.position === "last") {
          parent.children.push(el);
        } else if (op.position === "before" && op.ref) {
          const idx = parent.children.findIndex((c) => c.nodeId === op.ref);
          if (idx === -1) return { ok: false, error: `ref ${op.ref} not found`, op };
          parent.children.splice(idx, 0, el);
        } else if (op.position === "after" && op.ref) {
          const idx = parent.children.findIndex((c) => c.nodeId === op.ref);
          if (idx === -1) return { ok: false, error: `ref ${op.ref} not found`, op };
          parent.children.splice(idx + 1, 0, el);
        }
        inverses.push({ op: "remove_element", target: el.nodeId });
        break;
      }
      case "remove_element": {
        const removed = removeNode(pages, op.target);
        if (!removed) return { ok: false, error: `node ${op.target} not found`, op };
        const loc = findParent(pages, op.target);
        inverses.push({
          op: "add_element",
          parent: loc?.parent.nodeId ?? "",
          element: removed,
          position: "after",
          ref: loc ? loc.parent.children[loc.index - 1]?.nodeId : undefined,
        });
        break;
      }
      case "move_element": {
        const node = findNode(pages, op.target);
        if (!node) return { ok: false, error: `node ${op.target} not found`, op };
        const loc = findParent(pages, op.target);
        if (!loc) return { ok: false, error: `node ${op.target} has no parent`, op };
        const prevIndex = loc.index;
        removeNode(pages, op.target);
        if (op.position === "first") {
          loc.parent.children.unshift(node);
        } else if (op.position === "last") {
          loc.parent.children.push(node);
        } else if ((op.position === "before" || op.position === "after") && op.ref) {
          const refIdx = loc.parent.children.findIndex((c) => c.nodeId === op.ref);
          if (refIdx === -1) return { ok: false, error: `ref ${op.ref} not found`, op };
          const insertIdx = op.position === "before" ? refIdx : refIdx + 1;
          loc.parent.children.splice(insertIdx, 0, node);
        }
        inverses.push({
          op: "move_element",
          target: op.target,
          position: "last",
        });
        break;
      }
      case "set_layout": {
        const node = findNode(pages, op.target);
        if (!node) return { ok: false, error: `node ${op.target} not found`, op };
        const prev = node.props["layout"];
        node.props["layout"] = { t: "enum", v: op.layout };
        if (prev) {
          inverses.push({ op: "set_property", target: op.target, property: "layout", value: prev });
        }
        break;
      }
      case "set_effects": {
        const node = findNode(pages, op.target);
        if (!node) return { ok: false, error: `node ${op.target} not found`, op };
        const prev = node.props["effect"];
        node.props["effect"] = { t: "enum", v: op.effect };
        if (prev) {
          inverses.push({ op: "set_property", target: op.target, property: "effect", value: prev });
        }
        break;
      }
      default: {
        const _exhaustive: never = op;
        return { ok: false, error: `unknown op ${JSON.stringify(_exhaustive)}`, op };
      }
    }
  }

  return { ok: true, ops, inverse: inverses };
}

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
