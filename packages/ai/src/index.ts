// High-level API (preferred for IDE integration)
export { createBhasm } from "./integration.js";
export type { Bhasm, BhasmOptions } from "./integration.js";

// Individual modules
export { createOllamaProvider, health, setOllamaTransport } from "./ollama.js";
export type { OllamaTransport } from "./ollama.js";
export { applyOps, prop } from "./patches.js";
export { proposeIntent, buildContext } from "./intent.js";
export { describeToPatch } from "./toPatch.js";
export { reviewProject } from "./review.js";

// Decision layer (JEV-style routing/guardrail built on the local model)
export {
  createOllamaDecisionLayer,
  ladderStep,
  DEFAULT_ACT_THRESHOLD,
  DEFAULT_ASK_THRESHOLD,
} from "./decisions.js";
export type {
  DecisionLayer,
  DecisionLayerConfig,
  DecisionRequest,
  DecisionResult,
  DecisionChoice,
  DecisionTask,
  LadderStep,
} from "./decisions.js";

// Prompts (for customization)
export {
  INTENT_SYSTEM,
  DESCRIBE_SYSTEM,
  REVIEW_SYSTEM,
  buildIntentPrompt,
  buildDescribePrompt,
  buildReviewPrompt,
} from "./prompts.js";
