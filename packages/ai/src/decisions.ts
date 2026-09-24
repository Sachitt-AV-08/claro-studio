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
  provider: "local" | "fallback";
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