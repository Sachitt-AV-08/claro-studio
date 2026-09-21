/**
 * High-level integration API for Agent 2 (IDE).
 *
 * This is the primary surface Agent 2 should call. It wraps all low-level
 * AI logic behind a simple, typed interface.
 *
 * Usage:
 *   import { createClaroAi } from "@project/ai";
 *   const ai = createClaroAi();
 *   const result = await ai.proposePatch("make the hero title red", project);
 */

import type {
  Project,
  PatchProposal,
  ReviewResult,
  ModelStatus,
  DslNode,
  PatchOp,
} from "@project/contracts";
import { createOllamaProvider, health } from "./ollama.js";
import { proposeIntent, buildContext } from "./intent.js";
import { describeToPatch } from "./toPatch.js";
import { reviewProject } from "./review.js";
import { applyOps } from "./patches.js";
import type { ModelProvider } from "@project/contracts";

// ---------- public interface ----------

export interface ClaroAi {
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

  /** Apply PatchOps to a project's pages. Returns modified pages + inverses. */
  applyPatch(
    pages: DslNode[],
    ops: PatchOp[],
  ): ReturnType<typeof applyOps>;
}

// ---------- factory ----------

export interface ClaroAiOptions {
  /** Ollama model name. Defaults to "qwen2.5:3b". */
  model?: string;
  /** Custom ModelProvider (for testing or alternative backends). */
  provider?: ModelProvider;
}

export function createClaroAi(options: ClaroAiOptions = {}): ClaroAi {
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

    applyPatch(pages, ops) {
      return applyOps(pages, ops);
    },
  };
}

// ---------- re-exports for convenience ----------

export { createOllamaProvider, health } from "./ollama.js";
export { proposeIntent, buildContext } from "./intent.js";
export { describeToPatch } from "./toPatch.js";
export { reviewProject } from "./review.js";
export { applyOps, prop } from "./patches.js";
