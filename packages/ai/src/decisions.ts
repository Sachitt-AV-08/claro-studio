/**
 * Claro Decisions — a lightweight, homegrown instant of the JEV pattern.
 *
 * Not a new model: this augments an existing small Ollama model (qwen2.5:3b)
 * until it behaves like a typed-decision layer. The augmentations carry the
 * weight: a hard JSON contract, strict validation with ONE cheap repair retry,
 * a rule-based heuristic hint that the model can confirm or override, and a
 * confidence ladder (act / escalate / fallback). Every decision is a soft
 * signal — when the model is unsure or unavailable, callers fall back to their
 * deterministic path unchanged, so the engine only ever gets better.
 */

import type { ModelProvider } from "@project/contracts";
import { createOllamaEmbedder, cosine, type Embedder } from "./embeddings.js";

export type DecisionTask = "route" | "classify" | "guardrail";

export interface DecisionChoice {
  id: string;
  /** short semantic description — helps small models route far better */
  description?: string;
}

export interface DecisionRequest {
  task: DecisionTask;
  /** serializable context: message, patch summary, seed idea, … (truncated) */
  state: Record<string, unknown>;
  /** the fixed set of choices the model may return */
  choices: DecisionChoice[];
  /** rule-based prior ("heuristic: review") — the model may override it */
  hint?: string;
}

export interface DecisionResult {
  task: DecisionTask;
  choice: string;
  /** 0..1 soft confidence — self-reported, never a hard gate */
  probability: number;
  /** true only when the model returned schema-valid JSON + a real choice */
  valid: boolean;
  reason?: string;
  provider: "local" | "fallback" | "embed" | "gate";
  latencyMs: number;
}

export interface DecisionLayer {
  decide(req: DecisionRequest): Promise<DecisionResult>;
}

export interface DecisionLayerConfig {
  model?: string;
  /** confidence above which the caller should act */
  actThreshold?: number;
  /** confidence above which the caller should escalate (else fallback path) */
  askThreshold?: number;
}

export const DEFAULT_ACT_THRESHOLD = 0.9;
export const DEFAULT_ASK_THRESHOLD = 0.6;

export type LadderStep = "act" | "ask" | "fallback";

export function ladderStep(
  probability: number,
  act = DEFAULT_ACT_THRESHOLD,
  ask = DEFAULT_ASK_THRESHOLD,
): LadderStep {
  if (probability >= act) return "act";
  if (probability >= ask) return "ask";
  return "fallback";
}

interface RawDecision {
  choice?: unknown;
  probability?: unknown;
  reason?: unknown;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Shape of the trailing JSON-only instruction on every decision prompt. */
function contractFor(req: DecisionRequest): string {
  return `Return ONLY one JSON object with exactly these keys:
{
  "choice": ${JSON.stringify(req.choices.map((c) => c.id))}[one of these],
  "probability": 0..1,
  "reason": "short phrase"
}`;
}

function systemPrompt(): string {
  return (
    "You are the decision layer of an AI code workbench. You return exactly one " +
    "JSON object, never prose. Be honest about uncertainty: use ~0.5 for a guess, " +
    "~1.0 only when very sure. Follow the schema exactly."
  );
}

function userPrompt(req: DecisionRequest): string {
  const choices = req.choices
    .map((c) => `- ${c.id}${c.description ? `: ${c.description}` : ""}`)
    .join("\n");
  const hint = req.hint ? `\nA deterministic heuristic suggests "${req.hint}". You may agree or override it.` : "";
  return (
    `TASK: ${req.task}\n` +
    `STATE: ${JSON.stringify(req.state).slice(0, 800)}\n` +
    `CHOICES:\n${choices}\n` +
    hint +
    `\n\n${contractFor(req)}`
  );
}

export function createOllamaDecisionLayer(
  provider: ModelProvider,
  _cfg: DecisionLayerConfig = {},
): DecisionLayer {
  return {
    async decide(req: DecisionRequest): Promise<DecisionResult> {
      const start = Date.now();
      const attempt = async (extra: string): Promise<RawDecision | null> => {
        try {
          const raw = await provider.structuredComplete<RawDecision>(
            systemPrompt(),
            userPrompt(req) + extra,
            {},
          );
          if (!raw || typeof raw.choice !== "string") return null;
          return raw;
        } catch {
          return null;
        }
      };

      // First attempt; on any invalid/unparseable response, ONE cheap repair
      // retry; still bad → invalid so the caller falls back to heuristics.
      const raw = (await attempt("")) ??
        (await attempt("\n\nYour previous response was invalid. Return valid JSON exactly matching the schema."));
      if (!raw) {
        return {
          task: req.task,
          choice: req.hint ?? req.choices[0]?.id ?? "",
          probability: 0,
          valid: false,
          reason: "decision model produced no valid choice",
          provider: "local",
          latencyMs: Date.now() - start,
        };
      }

      const found = req.choices.find((c) => c.id === (raw.choice as string))?.id;
      if (!found) {
        return {
          task: req.task,
          choice: raw.choice as string,
          probability: 0,
          valid: false,
          reason: `choice ${JSON.stringify(raw.choice)} not in schema`,
          provider: "local",
          latencyMs: Date.now() - start,
        };
      }

      const probability =
        typeof raw.probability === "number" && Number.isFinite(raw.probability)
          ? clamp01(raw.probability)
          : 0;
      return {
        task: req.task,
        choice: found,
        probability,
        valid: probability > 0,
        reason: typeof raw.reason === "string" ? raw.reason.slice(0, 160) : undefined,
        provider: "local",
        latencyMs: Date.now() - start,
      };
    },
  };
}

/**
 * Claro Gate — the JEV-style cost gate.
 *
 * A tiny embedding classifier that decides whether a prompt needs the
 * expensive 3B reasoning model at all. Built on nomic-embed-text:
 * prototypes are centroids from labeled examples we already own
 * (heuristicHint regexes + isConversational + mode semantics).
 * Zero training run; pure cosine margin.
 */
export interface GateResult {
  needsDeep: boolean;
  score: number;        // cosine margin: positive → deep, negative → simple
  provider: "embed" | "fallback";
  latencyMs: number;
}

export interface GateConfig {
  /** embedding model (default: nomic-embed-text) */
  model?: string;
  /** cosine margin; >0 = deep, <0 = simple (default 0.05) */
  margin?: number;
  /** injected embedder for testing */
  embedder?: Embedder;
}

/** Labeled examples that seed the simple/deep centroids. */
interface GateLabel {
  text: string;
  kind: "simple" | "deep";
}

/** Heuristic labels we already trust → build prototypes offline at module load. */
const GATE_LABELS: GateLabel[] = [
  // Conversational / simple
  { text: "hi", kind: "simple" },
  { text: "hello", kind: "simple" },
  { text: "hey", kind: "simple" },
  { text: "thanks", kind: "simple" },
  { text: "thank you", kind: "simple" },
  { text: "what can you do", kind: "simple" },
  { text: "help", kind: "simple" },
  { text: "ok", kind: "simple" },
  { text: "nice", kind: "simple" },
  { text: "cool", kind: "simple" },
  // isConversational catches these
  // heuristicHint simple cases
  { text: "where is the button used", kind: "simple" },
  { text: "show me the component structure", kind: "simple" },
  { text: "query the graph for usage", kind: "simple" },
  { text: "graph stats", kind: "simple" },
  // mode: ask (grounded questions)
  { text: "explain this component", kind: "simple" },
  { text: "what does the hero do", kind: "simple" },
  { text: "how does the nav work", kind: "simple" },
  // simple patches (heuristicHint proposes_patch but clear intent)
  { text: "make the button red", kind: "deep" },
  { text: "add a hero section", kind: "deep" },
  { text: "change the header color", kind: "deep" },
  // deep / reasoning needed
  { text: "review the project for problems", kind: "deep" },
  { text: "find all accessibility issues", kind: "deep" },
  { text: "audit the code for performance", kind: "deep" },
  { text: "refactor the component hierarchy", kind: "deep" },
  { text: "redesign the layout", kind: "deep" },
  { text: "improve the design system", kind: "deep" },
  { text: "cross-file risk analysis", kind: "deep" },
  { text: "security review", kind: "deep" },
];

// Build centroids at load time (pure cosine on embeddings; no model call yet).
// These will be hydrated lazily on first use with real embeddings.
let simpleCentroid: number[] | null = null;
let deepCentroid: number[] | null = null;
let centroidsReady = false;

async function ensureCentroids(embedder: Embedder): Promise<void> {
  if (centroidsReady) return;
  const simpleTexts = GATE_LABELS.filter((l) => l.kind === "simple").map((l) => l.text);
  const deepTexts = GATE_LABELS.filter((l) => l.kind === "deep").map((l) => l.text);
  const [simpleVecs, deepVecs] = await Promise.all([
    embedder.embed(simpleTexts),
    embedder.embed(deepTexts),
  ]);
  simpleCentroid = meanVector(simpleVecs);
  deepCentroid = meanVector(deepVecs);
  centroidsReady = true;
}

function meanVector(vecs: number[][]): number[] {
  if (!vecs.length) return [];
  const dim = vecs[0].length;
  const sum = new Array(dim).fill(0);
  for (const v of vecs) {
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }
  return sum.map((x) => x / vecs.length);
}

/**
 * Create a Claro Gate instance.
 * Lazy hydrates centroids on first call; returns fallback if embedder unavailable.
 */
export function createClaroGate(cfg: GateConfig = {}): {
  gateReasoning: (input: string) => Promise<GateResult>;
} {
  let embedder: Embedder | undefined = cfg.embedder;
  let margin = cfg.margin ?? 0.05;
  let model = cfg.model ?? "nomic-embed-text";
  let hydrated = false;

  return {
    async gateReasoning(input: string): Promise<GateResult> {
      const start = Date.now();
      try {
        if (!embedder) {
          embedder = createOllamaEmbedder(model);
          const ok = await embedder.isInstalled();
          if (!ok) throw new Error(`embed model ${model} not installed`);
        }
        if (!hydrated) {
          await ensureCentroids(embedder);
          hydrated = true;
        }
        const [inputVec] = await embedder.embed([input]);
        const simSimple = cosine(inputVec, simpleCentroid!);
        const simDeep = cosine(inputVec, deepCentroid!);
        const score = simDeep - simSimple; // positive → deep
        return {
          needsDeep: score >= margin,
          score,
          provider: "embed",
          latencyMs: Date.now() - start,
        };
      } catch {
        // Embedder down or model missing → safe default: escalate to deep.
        return {
          needsDeep: true,
          score: 0,
          provider: "fallback",
          latencyMs: Date.now() - start,
        };
      }
    },
  };
}