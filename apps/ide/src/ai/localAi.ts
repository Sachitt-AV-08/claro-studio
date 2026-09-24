import { createBhasm } from "@project/ai";
import type { Bhasm } from "@project/ai";
import type { ModelStatus } from "@project/contracts";

/**
 * Thin IDE-side adapter over @project/ai's Bhasm (Ollama qwen2.5:3b, offline).
 *
 * Bhasm runs entirely in the renderer: it talks to Ollama directly over HTTP
 * (http://localhost:11434). No IPC needed. Every AI action is a PatchOp batch
 * validated against the engine — reversible by construction.
 */

const instance: Bhasm = createBhasm({ model: "qwen2.5:3b" });

export interface ClaroAi {
  health(): Promise<{ ok: boolean; models: Array<{ name: string; size: number }>; error?: string }>;
  status(): Promise<ModelStatus>;
  proposePatch(instruction: string, project: import("@project/contracts").Project): Promise<import("@project/contracts").PatchProposal>;
  describePatch(intendedSource: string, currentSource: string, project: import("@project/contracts").Project): Promise<import("@project/contracts").PatchProposal>;
  review(project: import("@project/contracts").Project, includeLlm?: boolean): Promise<import("@project/contracts").ReviewResult>;
  applyPatch(project: import("@project/contracts").Project, ops: import("@project/contracts").PatchOp[]): Promise<import("@project/dsl").ApplyResult>;
}

export function createClaroAi(): ClaroAi {
  return {
    async health() {
      return instance.health();
    },
    async status() {
      return instance.status();
    },
    async proposePatch(instruction, project) {
      return instance.proposePatch(instruction, project);
    },
    async describePatch(intendedSource, currentSource, project) {
      return instance.describePatch(intendedSource, currentSource, project);
    },
    async review(project, includeLlm) {
      return instance.review(project, includeLlm ?? false);
    },
    async applyPatch(project, ops) {
      const { applyOps } = await import("@project/dsl");
      return applyOps(project, ops);
    },
  };
}