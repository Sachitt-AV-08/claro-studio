// High-level API (preferred for Agent 2 integration)
export { createClaroAi } from "./integration.js";
export type { ClaroAi, ClaroAiOptions } from "./integration.js";

// Individual modules
export { createOllamaProvider, health } from "./ollama.js";
export { applyOps, prop } from "./patches.js";
export { proposeIntent, buildContext } from "./intent.js";
export { describeToPatch } from "./toPatch.js";
export { reviewProject } from "./review.js";

// Prompts (for customization)
export {
  INTENT_SYSTEM,
  DESCRIBE_SYSTEM,
  REVIEW_SYSTEM,
  buildIntentPrompt,
  buildDescribePrompt,
  buildReviewPrompt,
} from "./prompts.js";
