import type { DslNode, PropValue, SourceRange } from "./ast.js";

/**
 * Element identity (requirement #8): every rendered node carries a stable id.
 * nodeId = dotted path of (name ?? type); repeated sibling segments get :n suffix.
 * Pure function of the AST: same source always yields the same ids, so ids are
 * recomputed after every parse and survive deterministic round-trips.
 */

export type IdMap = Record<string, { range: SourceRange; nodeId: string }>;

/** Walk a node list and assign nodeId on every node; return id -> range map. */
export function assignIds(nodes: DslNode[]): { nodes: DslNode[]; map: IdMap } {
  const map: IdMap = {};
  walk(nodes, "");
  return { nodes, map };

  function walk(ns: DslNode[], prefix: string): void {
    const seen = new Map<string, number>();
    for (const n of ns) {
      const base = (n.name ?? n.type).toLowerCase();
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      const seg = count > 1 ? `${base}:${count}` : base;
      const id = prefix ? `${prefix}.${seg}` : seg;
      n.nodeId = id;
      map[id] = { range: n.source, nodeId: id };
      if (n.children.length) walk(n.children, id);
    }
  }
}

/** Same as assignIds but returns the map only (assigns in place). */
export function buildIdMap(nodes: DslNode[]): IdMap {
  const map: IdMap = {};
  walk(nodes, "");
  return map;

  function walk(ns: DslNode[], prefix: string): void {
    const seen = new Map<string, number>();
    for (const n of ns) {
      const base = (n.name ?? n.type).toLowerCase();
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      const seg = count > 1 ? `${base}:${count}` : base;
      const id = prefix ? `${prefix}.${seg}` : seg;
      n.nodeId = id;
      map[id] = { range: n.source, nodeId: id };
      if (n.children.length) walk(n.children, id);
    }
  }
}

export function rangeOf(map: IdMap, nodeId: string): SourceRange | undefined {
  return map[nodeId]?.range;
}

export function nodeById(nodes: DslNode[], nodeId: string): DslNode | undefined {
  for (const n of nodes) {
    if (n.nodeId === nodeId) return n;
    const hit = nodeById(n.children, nodeId);
    if (hit) return hit;
  }
  return undefined;
}

export function setNodeProp(n: DslNode, key: string, value: PropValue): void {
  n.props[key] = value;
}