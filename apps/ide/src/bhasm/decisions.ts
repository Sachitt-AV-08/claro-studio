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
  createOllamaEmbedder,
  ladderStep,
  createClaroGate,
  cosine,
  type DecisionLayer,
  type DecisionResult as BaseDecisionResult,
  type LadderStep,
} from "@project/ai";
import type { ModelProvider, PatchOp, PropValue } from "@project/contracts";
import { loadBhasmGraphSettings, type BhasmGraphSettings } from "../graph/graphSettings";
import { useDecisionStore } from "./decisionStore";
import { useMetricsStore, type MetricProvider } from "./metricsStore";
import type { BhasmMode } from "./agent";

/** Publish an Edge-AI metric sample for one decision outcome. */
function note(task: "route" | "guardrail" | "classify", provider: MetricProvider, skippedModel: boolean, latencyMs: number, probability: number): void {
  try {
    useMetricsStore.getState().record({ task, provider, skippedModel, latencyMs, probability });
  } catch {
    /* metrics are best-effort */
  }
}

/** DecisionResult with Claro Gate / embedding prior provider types. */
type DecisionResult = Omit<BaseDecisionResult, "provider"> & {
  provider: "local" | "fallback" | "embed" | "gate";
};

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

// ---------- embedder & Claro Gate (lazy, cached) ----------

let embedderCache: { embedder: ReturnType<typeof createOllamaEmbedder> | null; model: string } | null = null;

async function getEmbedder(cfg: BhasmGraphSettings) {
  const model = cfg.decision.embedModel ?? "nomic-embed-text";
  if (embedderCache && embedderCache.model === model) return embedderCache.embedder;
  const embedder = createOllamaEmbedder(model);
  const ok = await embedder.isInstalled();
  if (!ok) return null;
  embedderCache = { embedder, model };
  return embedder;
}

function resetEmbedderCache(): void {
  embedderCache = null;
}

// Claro Gate instance (lazy hydrated on first use)
let gateCache: { gate: ReturnType<typeof createClaroGate> | null; margin: number; model: string } | null = null;

async function getGate(cfg: BhasmGraphSettings) {
  const model = cfg.decision.embedModel ?? "nomic-embed-text";
  const margin = cfg.decision.gateMargin ?? 0.05;
  if (gateCache && gateCache.model === model && gateCache.margin === margin) return gateCache.gate;
  const gate = createClaroGate({ model, margin });
  gateCache = { gate, model, margin };
  return gate;
}

function resetGateCache(): void {
  gateCache = null;
}

// ---------- embedHint: cosine prior for tool routing ----------

/**
 * Embedding prior for tool routing.
 * Returns the top-matching tool by cosine similarity, or undefined if embedder unavailable.
 */
export async function embedHint(
  input: string,
  toolIds: string[],
  cfg: BhasmGraphSettings,
): Promise<{ choice: string; score: number } | undefined> {
  const embedder = await getEmbedder(cfg);
  if (!embedder || !toolIds.length) return undefined;

  const descriptions = toolIds.map((id) => ({ id, description: describe(id) }));
  const texts = [input, ...descriptions.map((d) => d.description)];
  const vectors = await embedder.embed(texts);
  const inputVec = vectors[0];
  const toolVecs = vectors.slice(1);

  let bestIdx = -1;
  let bestScore = -1;
  for (let i = 0; i < toolVecs.length; i++) {
    const score = cosine(inputVec, toolVecs[i]);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0) {
    return { choice: descriptions[bestIdx].id, score: bestScore };
  }
  return undefined;
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
  if (toolIds.length < 1) {
    note("route", "fallback", true, 0, 0);
    return fallback;
  }

  try {
    const cfg = await loadBhasmGraphSettings();

    // Claro Gate: decide if we need deep reasoning at all
    const gate = (await getGate(cfg))!;
    const gateResult = await gate.gateReasoning(input);
    if (!gateResult.needsDeep) {
      // Simple query - skip LLM entirely, use embedding prior or heuristic
      const embed = await embedHint(input, toolIds, cfg);
      const choice = embed?.choice ?? hint ?? fallbackChoice;
      note("route", embed ? "embed" : "fallback", true, gateResult.latencyMs, embed?.score ?? 0);
      return {
        result: {
          task: "route",
          choice,
          probability: embed?.score ?? 0,
          valid: !!embed,
          provider: (embed ? "embed" : "fallback") as DecisionResult["provider"],
          latencyMs: gateResult.latencyMs,
        },
        step: embed?.score && embed.score >= cfg.decision.ask ? "ask" : "fallback",
        choice,
      };
    }

    // Deep reasoning needed - use the LLM decision layer
    const layer = await getLayer(cfg);
    if (!layer) {
      // Layer unavailable but gate says deep - try embedding prior
      const embed = await embedHint(input, toolIds, cfg);
      const choice = embed?.choice ?? hint ?? fallbackChoice;
      note("route", embed ? "embed" : "fallback", true, gateResult.latencyMs, embed?.score ?? 0);
      return {
        result: {
          task: "route",
          choice,
          probability: embed?.score ?? 0,
          valid: !!embed,
          provider: "embed" as DecisionResult["provider"],
          latencyMs: 0,
        },
        step: embed?.score && embed.score >= cfg.decision.ask ? "ask" : "fallback",
        choice,
      };
    }

    const result = await layer.decide({
      task: "route",
      state: { mode, input },
      choices: toolIds.map((id) => ({ id, description: describe(id) })),
      hint,
    });
    if (!result.valid) {
      // LLM failed - try embedding prior as fallback
      const embed = await embedHint(input, toolIds, cfg);
      const choice = embed?.choice ?? hint ?? fallbackChoice;
      note("route", embed ? "embed" : "fallback", true, result.latencyMs, embed?.score ?? 0);
      return {
        result: {
          task: "route",
          choice,
          probability: embed?.score ?? 0,
          valid: !!embed,
          provider: embed ? "embed" : "fallback",
          latencyMs: 0,
        },
        step: embed?.score && embed.score >= cfg.decision.ask ? "ask" : "fallback",
        choice,
      };
    }
    const choice = toolIds.includes(result.choice) ? result.choice : fallback.choice;
    const r: DecisionResult = { ...result, choice };
    const step = ladderStep(result.probability, cfg.decision.act, cfg.decision.ask);

    // In ask-zone, consider embedding prior as tiebreaker
    let finalChoice = choice;
    let finalStep = step;
    let finalProb = result.probability;
    let finalProvider = result.provider;
    if (step === "ask") {
      const embed = await embedHint(input, toolIds, cfg);
      if (embed && embed.score > finalProb) {
        finalChoice = embed.choice;
        finalProb = embed.score;
        finalStep = embed.score >= cfg.decision.act ? "act" : "ask";
        finalProvider = "embed" as DecisionResult["provider"];
      }
    }

    useDecisionStore.getState().setRoute({
      choice: finalChoice,
      probability: finalProb,
      step: finalStep,
      provider: finalProvider,
      task: "route",
    });
    note("route", finalProvider as MetricProvider, finalProvider === "embed", result.latencyMs, finalProb);
    return { result: { ...r, choice: finalChoice, probability: finalProb, provider: finalProvider }, step: finalStep, choice: finalChoice };
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

    // Claro Gate: simple patches skip deep guardrail
    const gate = (await getGate(cfg))!;
    const patch = ops.map(opSummary).join("; ").slice(0, 800);
    const gateResult = await gate.gateReasoning(patch);
    if (!gateResult.needsDeep) {
      // Simple patch - auto-approve via gate
      note("guardrail", "gate", true, gateResult.latencyMs, 1 - gateResult.score);
      return {
        task: "guardrail",
        choice: "approve",
        probability: 1 - gateResult.score,
        valid: true,
        provider: "gate" as DecisionResult["provider"],
        latencyMs: gateResult.latencyMs,
        reason: "gate: simple patch auto-approved",
      };
    }

    const layer = await getLayer(cfg);
    if (!layer) return fallback;
    const result = await layer.decide({
      task: "guardrail",
      state: { patch, count: ops.length },
      choices: [
        { id: "approve", description: "this edit is safe and consistent with the codebase" },
        { id: "reject", description: "the edit is risky, destructive, or contradicts prior context" },
      ],
    });
    const verdict = result.valid ? (result.choice as "approve" | "reject") : undefined;
    if (!verdict || !["approve", "reject"].includes(verdict)) {
      note("guardrail", "fallback", true, result.latencyMs, 0);
      return fallback;
    }
    useDecisionStore.getState().setGuardrail({
      choice: verdict,
      probability: result.probability,
      reason: result.reason,
      provider: result.provider,
      step: ladderStep(result.probability, cfg.decision.act, cfg.decision.ask),
    });
    note("guardrail", "local", false, result.latencyMs, result.probability);
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

    // Claro Gate: simple ideas skip deep classification
    const gate = (await getGate(cfg))!;
    const gateResult = await gate.gateReasoning(idea);
    if (!gateResult.needsDeep) {
      // Simple idea - use embedding prior
      const embedder = await getEmbedder(cfg);
      if (embedder) {
        const [ideaVec, proposeVec, explainVec] = await embedder.embed([
          idea,
          "the idea describes a concrete change to build",
          "the idea is a question, a note, or an open thought",
        ]);
        const simPropose = cosine(ideaVec, proposeVec);
        const simExplain = cosine(ideaVec, explainVec);
        note("classify", "embed", true, gateResult.latencyMs, simPropose);
        return simPropose > simExplain;
      }
      note("classify", "fallback", true, gateResult.latencyMs, 0);
      return /(make|add|build|change|create|hero|button|page|component)/.test(idea);
    }

    const layer = await getLayer(cfg);
    if (!layer) {
      note("classify", "fallback", true, 0, 0);
      return false;
    }
    const result = await layer.decide({
      task: "classify",
      state: { seed: idea },
      choices: [
        { id: "propose", description: "the idea describes a concrete change to build" },
        { id: "explain", description: "the idea is a question, a note, or an open thought" },
      ],
      hint: /(make|add|build|change|create|hero|button|page|component)/.test(idea) ? "propose" : "explain",
    });
    if (!result.valid || result.probability < cfg.decision.act) {
      note("classify", "fallback", true, result.latencyMs, result.probability);
      return false;
    }
    note("classify", "local", false, result.latencyMs, result.probability);
    return result.choice === "propose";
  } catch {
    return false;
  }
}

// ---------- classify: seed idea → mode ----------

const MODE_CHOICES: { id: BhasmMode; description: string }[] = ["ask", "code", "review", "explain-comment"].map((id) => ({
  id: id as BhasmMode,
  description: describe(id === "code" ? "propose_patch" : "chat"),
}));

export async function classifySeed(idea: string): Promise<{ mode: BhasmMode; result: DecisionResult }> {
  const fallback = { mode: "explain-comment" as BhasmMode, result: { task: "classify", choice: "explain-comment", probability: 0, valid: false, provider: "fallback", latencyMs: 0 } as DecisionResult };
  if (!idea.trim()) return fallback;
  try {
    const cfg = await loadBhasmGraphSettings();

    // Claro Gate: simple seeds skip deep classification
    const gate = (await getGate(cfg))!;
    const gateResult = await gate.gateReasoning(idea);
    if (!gateResult.needsDeep) {
      // Simple seed - use embedding prior to pick mode
      const embedder = await getEmbedder(cfg);
      if (embedder) {
        const descriptions = MODE_CHOICES.map((c) => c.description);
        const texts = [idea, ...descriptions];
        const vectors = await embedder.embed(texts);
        const ideaVec = vectors[0];
        const modeVecs = vectors.slice(1);
        let bestIdx = -1;
        let bestScore = -1;
        for (let i = 0; i < modeVecs.length; i++) {
          const score = cosine(ideaVec, modeVecs[i]);
          if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
          }
        }
        if (bestIdx >= 0) {
          note("classify", "embed", true, gateResult.latencyMs, bestScore);
          return {
            mode: MODE_CHOICES[bestIdx].id,
            result: {
              task: "classify",
              choice: MODE_CHOICES[bestIdx].id,
              probability: bestScore,
              valid: true,
              provider: "embed" as DecisionResult["provider"],
              latencyMs: gateResult.latencyMs,
            },
          };
        }
      }
      // Heuristic fallback
      const mode = /hero|component|page/.test(idea) ? "code" : "ask";
      note("classify", "fallback", true, gateResult.latencyMs, 0);
      return {
        mode,
        result: {
          task: "classify",
          choice: mode,
          probability: 0,
          valid: false,
          provider: "fallback",
          latencyMs: gateResult.latencyMs,
        },
      };
    }

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
    note("classify", "local", false, result.latencyMs, result.probability);
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

export { resetLayerCache, resetEmbedderCache, resetGateCache };
