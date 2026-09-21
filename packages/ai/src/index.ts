// High-level API (preferred for Agent 2 integration)
export { createClaroAi } from "./integration.ts";
export type { ClaroAi, ClaroAiOptions } from "./integration.ts";

// Individual modules
export { createOllamaProvider, health } from "./ollama.ts";
export { applyOps, prop } from "./patches.ts";
export { proposeIntent, buildContext } from "./intent.ts";
export { describeToPatch } from "./toPatch.ts";
export { reviewProject } from "./review.ts";

// Prompts (for customization)
export {
  INTENT_SYSTEM,
  DESCRIBE_SYSTEM,
  REVIEW_SYSTEM,
  buildIntentPrompt,
  buildDescribePrompt,
  buildReviewPrompt,
} from "./prompts.ts";