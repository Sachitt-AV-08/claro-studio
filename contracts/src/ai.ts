import type { PatchBatch } from "./patches.js";
import type { Diagnostic } from "./ast.js";

/**
 * Local AI layer. THE LLM PROPOSES — THE DETERMINISTIC APPLIER DECIDES.
 * All provider backends (Ollama, llama.cpp, LM Studio, stub-for-tests)
 * implement ModelProvider; Agent 3 owns this.
 */

export interface Completion {
  text: string;
  latencyMs: number;
  model: string;
  tokens?: { in: number; out: number };
}

export interface ModelStatus {
  model: string;
  loaded: boolean;
  vramMiB?: number;
  cpuOffload?: boolean;
  latencyMs?: number;
}

export interface ModelProvider {
  id: string;
  isInstalled(): Promise<boolean>;
  complete(system: string, user: string): Promise<Completion>;
  /** Constrained JSON completion. Provider must honor the shape hint. */
  structuredComplete<T>(system: string, user: string, shape: Record<string, unknown>): Promise<T>;
  status(): Promise<ModelStatus>;
}

/** Context handed to the model — the AST/IR, never raw random text. */
export interface ProjectContext {
  file: string;
  astJson: string;
  idMap: Record<string, { range: unknown; nodeId: string }>;
  selection?: { nodeId: string; props: Record<string, unknown> };
  diagnostics: Diagnostic[];
  schemaHint: string;
}

export type AiWorkflow =
  | "modify"
  | "explain"
  | "generate"
  | "fix"
  | "refactor"
  | "optimize"
  | "create_component";

/** Result of an AI request: a *proposed* patch that must be validated + diffed. */
export interface PatchProposal {
  workflow: AiWorkflow;
  summary: string;
  patch: PatchBatch;
  rationale?: string;
}

/** NL instruction → proposed structured patch. Safe on any failure. */
export interface AiClient {
  propose(workflow: AiWorkflow, instruction: string, ctx: ProjectContext): Promise<PatchProposal>;
  complete(system: string, user: string): Promise<Completion>;
  status(): Promise<ModelStatus>;
}