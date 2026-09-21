/**
 * BHASM typed tool registry — opencode tool-call shape.
 *
 * `{ id, name, description, inputSchema, run }`. Runs in the renderer, talks to
 * @project/ai Bhasm (Ollama, localhost:11434) and the DSL engine directly. Every
 * proposal tool dry-runs validateOps + applyOps before returning, and apply_patch
 * routes through the live undo stack via the runtime's store adapter.
 */

import type { Project, PatchOp } from "@project/contracts";
import { createBhasm, type Bhasm } from "@project/ai";
import { validateOps, applyOps } from "@project/dsl";
import { schemaFor } from "@project/contracts";

export interface StoreAdapter {
  applyOps: (ops: PatchOp[]) => { ok: boolean; error?: string };
}

export interface ToolRunContext {
  project: Project;
  source: string;
  store: StoreAdapter;
}

export interface Tool<Args = Record<string, unknown>> {
  id: string;
  name: string;
  description: string;
  inputSchema: string[];
  run(args: Args, ctx: ToolRunContext): Promise<unknown>;
}

const bhasm: Bhasm = createBhasm({ model: "qwen2.5:3b" });

function findNode(project: Project, nodeId: string): unknown | undefined {
  const walk = (nodes: Project["pages"]): unknown | undefined => {
    for (const n of nodes) {
      if (n.nodeId === nodeId) return n;
      const hit = walk(n.children);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(project.pages) ?? walk(project.components);
}

export const TOOLS: Tool[] = [
  {
    id: "propose_patch",
    name: "propose_patch",
    description: "Natural language → validated PatchOp batch. Dry-runs validateOps + applyOps before returning.",
    inputSchema: ["instruction: string", "project: Project (auto)"],
    async run(args, ctx) {
      const instruction = String(args.instruction ?? "");
      const result = await bhasm.proposePatch(instruction, ctx.project);
      if (result.patch.ops.length) {
        const check = validateOps(result.patch.ops);
        if (!check.ok) {
          return { ...result, dryRun: { ok: false, error: check.error } };
        }
        const applied = applyOps(ctx.project, result.patch.ops);
        return {
          ...result,
          dryRun: applied.ok ? { ok: true } : { ok: false, error: applied.error },
        };
      }
      return { ...result, dryRun: { ok: false, error: "model returned no ops" } };
    },
  },
  {
    id: "describe_patch",
    name: "describe_patch",
    description: "Intended snippet vs current source → minimal PatchOp list.",
    inputSchema: ["intended: string", "current: string", "project: Project (auto)"],
    async run(args, ctx) {
      return bhasm.describePatch(
        String(args.intended ?? ""),
        String(args.current ?? ""),
        ctx.project,
      );
    },
  },
  {
    id: "review",
    name: "review",
    description: "Deterministic rules engine + LLM pass. Findings link to corrective ops.",
    inputSchema: ["project: Project (auto)"],
    async run(_args, ctx) {
      return bhasm.review(ctx.project, true);
    },
  },
  {
    id: "apply_patch",
    name: "apply_patch",
    description: "Reversibly apply a validated op batch through the editor undo stack.",
    inputSchema: ["ops: PatchOp[]"],
    async run(args, ctx) {
      const ops = ((args.ops as unknown[]) ?? []) as PatchOp[];
      const check = validateOps(ops);
      if (!check.ok) return { ok: false, error: check.error };
      return ctx.store.applyOps(ops);
    },
  },
  {
    id: "comment_to_idea",
    name: "comment_to_idea",
    description: "Gather the project's # comments (the brain) from the raw source.",
    inputSchema: ["source: string (auto)"],
    async run(_args, ctx) {
      const ideas = ctx.source
        .split(/\r?\n/)
        .map((line, i) => ({ line: i + 1, text: line.match(/^\s*#\s*(.+)$/)?.[1]?.trim() }))
        .filter((c) => c.text);
      return { ideas };
    },
  },
  {
    id: "inspect_node",
    name: "inspect_node",
    description: "Return the element schema plus current props for a nodeId.",
    inputSchema: ["nodeId: string"],
    async run(args, ctx) {
      const nodeId = String(args.nodeId ?? "");
      const node = findNode(ctx.project, nodeId);
      const schema = node ? schemaFor((node as { type: string }).type) : undefined;
      return { node, schema };
    },
  },
  {
    id: "export_project",
    name: "export_project",
    description: "Render the current project to a single-file offline HTML.",
    inputSchema: ["project: Project (auto)"],
    async run(_args, ctx) {
      const { renderProjectHtml } = await import("../../export/renderHtml");
      return renderProjectHtml(ctx.project);
    },
  },
];

export function toolById(id: string): Tool | undefined {
  return TOOLS.find((t) => t.id === id);
}