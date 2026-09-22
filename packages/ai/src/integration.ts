/**
 * Bhasm — the AI brain of CLARO Workbench.
 *
 * High-level integration API for the IDE. This is the primary surface
 * the editor calls. It wraps all low-level AI logic behind a simple,
 * typed interface.
 *
 * Usage:
 *   import { createBhasm } from "@project/ai";
 *   const bhasm = createBhasm();
 *   const result = await bhasm.proposePatch("make the hero title red", project);
 */

import type {
  Project,
  PatchProposal,
  ReviewResult,
  ModelStatus,
  PatchOp,
} from "@project/contracts";
import { createOllamaProvider, health } from "./ollama.js";
import { proposeIntent } from "./intent.js";
import { describeToPatch } from "./toPatch.js";
import { reviewProject } from "./review.js";
import { applyOps } from "./patches.js";
import type { ModelProvider } from "@project/contracts";

// ---------- public interface ----------

export interface Bhasm {
  /** Check if Ollama is running and the model is available. */
  health(): Promise<{ ok: boolean; models: Array<{ name: string; size: number }>; error?: string }>;

  /** Get current model status. */
  status(): Promise<ModelStatus>;

  /** Natural language → PatchOp list. e.g. "make it red" */
  proposePatch(instruction: string, project: Project): Promise<PatchProposal>;

  /** Diff → minimal PatchOps. Given intended + current DSL source. */
  describePatch(
    intendedSource: string,
    currentSource: string,
    project: Project,
  ): Promise<PatchProposal>;

  /** Review project with rules engine + optional LLM feedback. */
  review(project: Project, includeLlm?: boolean): Promise<ReviewResult>;

  /** Apply PatchOps to a project. Returns modified project + inverses. */
  applyPatch(
    project: Project,
    ops: PatchOp[],
  ): ReturnType<typeof applyOps>;
}

// ---------- factory ----------

export interface BhasmOptions {
  /** Ollama model name. Defaults to "qwen2.5:3b". */
  model?: string;
  /** Custom ModelProvider (for testing or alternative backends). */
  provider?: ModelProvider;
}

export function createBhasm(options: BhasmOptions = {}): Bhasm {
  const provider = options.provider ?? createOllamaProvider(options.model ?? "qwen2.5:3b");

  return {
    async health() {
      return health();
    },

    async status() {
      return provider.status();
    },

    async proposePatch(instruction: string, project: Project): Promise<PatchProposal> {
      return proposeIntent(instruction, project, provider);
    },

    async describePatch(
      intendedSource: string,
      currentSource: string,
      project: Project,
    ): Promise<PatchProposal> {
      return describeToPatch(intendedSource, currentSource, project, provider);
    },

    async review(project: Project, includeLlm = true): Promise<ReviewResult> {
      return reviewProject(project, includeLlm ? provider : undefined);
    },

    applyPatch(project, ops) {
      return applyOps(project, ops);
    },
  };
}

// ---------- re-exports for convenience ----------

export { createOllamaProvider, health } from "./ollama.js";
export { proposeIntent, buildContext } from "./intent.js";
export { describeToPatch } from "./toPatch.js";
export { reviewProject } from "./review.js";
export { applyOps, prop } from "./patches.js";
