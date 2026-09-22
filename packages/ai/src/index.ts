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

// Prompts (for customization)
export {
  INTENT_SYSTEM,
  DESCRIBE_SYSTEM,
  REVIEW_SYSTEM,
  buildIntentPrompt,
  buildDescribePrompt,
  buildReviewPrompt,
} from "./prompts.js";
