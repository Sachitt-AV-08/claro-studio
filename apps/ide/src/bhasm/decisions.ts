/**
 * Claro Decisions — renderer adapter.
 *
 * Turns the engine decision layer into BHASM facts: a router (primary tool),
 * a guardrail (approve/reject a patch), and an intent classifier. Every call
 * degrades gracefully on top of the existing deterministic heuristics, so the
 * engine can only get better, never worse.
 */

import {
  createOllamaDecisionLayer,
  createOllamaProvider,
  ladderStep,
  type DecisionLayer,
  type DecisionResult,
  type LadderStep,
} from "@project/ai";
import type { ModelProvider, PatchOp, PropValue } from "@project/contracts";
import { loadBhasmGraphSettings, type BhasmGraphSettings } from "../graph/graphSettings";
import { useDecisionStore } from "./decisionStore";
import type { BhasmMode } from "./agent";

const TOOL_DESCRIPTIONS: Record<string, string> = {
  propose_patch: "propose an edit, create a component from a description",
  apply_patch: "apply accepted edits to the project, run them, commit them",
  review: "review the project or the patch, find problems and risks",
  inspect_node: "inspect a project node, explain a component",
  comment_to_idea: "extract structured idea notes from a comment or message",
  describe_patch: "summarize a patch in natural language",
  export_project: "export the project as source code",
  query_graph: "answer questions about code structure, usage and relationships from the code graph",
  graph_stats: "report code graph statistics",
  chat: "plain conversation about the codebase",
};

function describe(id: string): string {
  return TOOL_DESCRIPTIONS[id] ?? `run the ${id} tool`;
}

/** Rule-based prior: cheap, deterministic, always available. */
export function heuristicHint(_mode: string, input: string): string | undefined {
  const t = input.toLowerCase();
  if (/(review|risk|problem|broken|issue|improve)/.test(t)) return "review";
  if (/(make|add|change|update|create|write|fix|hero|page|component)\b/.test(t)) return "propose_patch";
  if (/(where .* used|used in|called by|component structure|show .* relationship|usage)/.test(t)) return "query_graph";
  if (/(apply|approve|commit)/.test(t)) return "apply_patch";
  if (/export|generate c#|generate source/.test(t)) return "export_project";
  return undefined;
}

// Greetings/pleasantries that should never reach the task engine (e.g. "hi"
// must not be turned into PatchOps that "display hi").
const CONVERSATIONAL_WHOLE = /^(hi|hiya|hello|hey|yo|howdy|sup|hola|thanks|thank you|ty|tnx|thx|ok|okay|k|sure|alright|good (morning|afternoon|evening|night)|goodbye|bye|see you|who are you|what can you do|what do you do|help|how do i use (you|this)|nice|awesome|great|perfect|cool|cool beans)\b[!.,?]*$/i;

// If the message also carries a work intent, it is a task regardless of how it starts.
const WORK_WORDS = /(make|add|change|update|create|write|fix|review|build|remov|edit|set |style|design|layout|page|hero|button|component|query|graph)/i;

/** Whole-message chat detector: a greeting/pleasantry that is NOT also a work request. */
export function isConversational(input: string): boolean {
  const t = input.trim();
  if (!t || t.length > 60) return false;
  if (!CONVERSATIONAL_WHOLE.test(t)) return false;
  return !WORK_WORDS.test(t);
}

// ---------- provider injection (test seam) ----------

let providerFactory: (() => ModelProvider | null) | null = null;

/** Test hook: override the local provider (null → force fallback). */
export function setDecisionProviderFactory(f: (() => ModelProvider | null) | null): void {
  providerFactory = f;
}

// ---------- layer lifecycle (lazy, cached) ----------

let layerCache: { layer: DecisionLayer | null; model: string } | null = null;

async function getLayer(cfg: BhasmGraphSettings): Promise<DecisionLayer | null> {
  if (layerCache && layerCache.model === cfg.decision.model) return layerCache.layer;
  const injected = providerFactory?.();
  const provider = injected ?? createOllamaProvider(cfg.decision.model);
  const layer = provider ? createOllamaDecisionLayer(provider, cfg.decision) : null;
  layerCache = { layer, model: cfg.decision.model };
  return layer;
}

function resetLayerCache(): void {
  layerCache = null;
}

// ---------- route: primary tool ----------

export interface RouteOutcome {
  result: DecisionResult;
  step: LadderStep;
  choice: string;
}

export async function routeTool(mode: string, input: string, toolIds: string[]): Promise<RouteOutcome> {
  const fallbackChoice = toolIds[0] ?? "chat";
  const hint = heuristicHint(mode, input);
  const fallback: RouteOutcome = {
    result: {
      task: "route",
      choice: hint ?? fallbackChoice,
      probability: 0,
      valid: false,
      provider: "fallback",
      latencyMs: 0,
    },
    step: "fallback",
    choice: hint ?? fallbackChoice,
  };
  if (toolIds.length < 1) return fallback;

  try {
    const cfg = await loadBhasmGraphSettings();
    const layer = await getLayer(cfg);
    if (!layer) return fallback;

    const result = await layer.decide({
      task: "route",
      state: { mode, input },
      choices: toolIds.map((id) => ({ id, description: describe(id) })),
      hint,
    });
    if (!result.valid) return fallback;
    const choice = toolIds.includes(result.choice) ? result.choice : fallback.choice;
    const r: DecisionResult = { ...result, choice };
    const step = ladderStep(result.probability, cfg.decision.act, cfg.decision.ask);
    useDecisionStore.getState().setRoute({
      choice,
      probability: result.probability,
      step,
      provider: result.provider,
      task: "route",
    });
    return { result: r, step, choice };
  } catch {
    return fallback;
  }
}

// ---------- guardrail: approve / reject patch ----------

function propText(v: PropValue | undefined): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return ` = ${v}`;
  return ` = ${JSON.stringify(v)}`;
}

function opSummary(op: PatchOp): string {
  const o = op as unknown as Record<string, unknown>;
  const where = String(o.target ?? o.parent ?? "?").slice(0, 60);
  const extra = o.value != null ? propText(o.value as PropValue) : o.property != null ? ` = ${String(o.property)}` : "";
  return `${op.op} ${where}${extra}`.slice(0, 160);
}

export async function guardrailOps(ops: PatchOp[]): Promise<DecisionResult> {
  const fallback: DecisionResult = {
    task: "guardrail",
    choice: "approve",
    probability: 1,
    valid: false,
    provider: "fallback",
    latencyMs: 0,
    reason: "no decision model available",
  };
  if (!ops.length) return fallback;
  try {
    const cfg = await loadBhasmGraphSettings();
    const layer = await getLayer(cfg);
    if (!layer) return fallback;
    const patch = ops.map(opSummary).join("; ").slice(0, 800);
    const result = await layer.decide({
      task: "guardrail",
      state: { patch, count: ops.length },
      choices: [
        { id: "approve", description: "this edit is safe and consistent with the codebase" },
        { id: "reject", description: "the edit is risky, destructive, or contradicts prior context" },
      ],
    });
    const verdict = result.valid ? (result.choice as "approve" | "reject") : undefined;
    if (!verdict || !["approve", "reject"].includes(verdict)) return fallback;
    useDecisionStore.getState().setGuardrail({
      choice: verdict,
      probability: result.probability,
      reason: result.reason,
      provider: result.provider,
      step: ladderStep(result.probability, cfg.decision.act, cfg.decision.ask),
    });
    return result;
  } catch {
    return fallback;
  }
}

/** True when a confident-reject verdict should block the apply. */
export function isConfidentReject(guard: DecisionResult, cfg: BhasmGraphSettings): boolean {
  return guard.choice === "reject" && guard.probability >= cfg.decision.act;
}

/** True when a seeded "#" idea is confidently a concrete build task, i.e. worth proposing ops. */
export async function shouldPropose(idea: string): Promise<boolean> {
  if (!idea.trim()) return false;
  try {
    const cfg = await loadBhasmGraphSettings();
    const layer = await getLayer(cfg);
    if (!layer) return false;
    const result = await layer.decide({
      task: "classify",
      state: { seed: idea },
      choices: [
        { id: "propose", description: "the idea describes a concrete change to build" },
        { id: "explain", description: "the idea is a question, a note, or an open thought" },
      ],
      hint: /(make|add|build|change|create|hero|button|page|component)/.test(idea) ? "propose" : "explain",
    });
    if (!result.valid || result.probability < cfg.decision.act) return false;
    return result.choice === "propose";
  } catch {
    return false;
  }
}

// ---------- classify: seed idea → mode ----------

const MODE_CHOICES = ["ask", "code", "review", "explain-comment"].map((id) => ({
  id,
  description: describe(id === "code" ? "propose_patch" : "chat"),
}));

export async function classifySeed(idea: string): Promise<{ mode: BhasmMode; result: DecisionResult }> {
  const fallback = { mode: "explain-comment" as BhasmMode, result: { task: "classify", choice: "explain-comment", probability: 0, valid: false, provider: "fallback", latencyMs: 0 } as DecisionResult };
  if (!idea.trim()) return fallback;
  try {
    const cfg = await loadBhasmGraphSettings();
    const layer = await getLayer(cfg);
    if (!layer) return fallback;
    const result = await layer.decide({
      task: "classify",
      state: { seed: idea },
      choices: MODE_CHOICES,
      hint: /hero|component|page/.test(idea) ? "code" : "ask",
    });
    const step = result.valid ? ladderStep(result.probability, cfg.decision.act, cfg.decision.ask) : "fallback";
    const mode: BhasmMode = result.valid && step === "act"
      ? (result.choice as BhasmMode)
      : fallback.mode;
    useDecisionStore.getState().setRoute({
      choice: result.choice,
      probability: result.probability,
      step,
      provider: result.provider,
      task: "classify",
    });
    return { mode, result };
  } catch (e) {
    console.error(`[decisions] classifySeed error: ${e instanceof Error ? e.message : String(e)}`);
    return fallback;
  }
}

export { resetLayerCache };
