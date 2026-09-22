/**
 * BHASM — the agent.
 *
 * opencode-style Agent model: one flexible agent, behavior selected by a mode
 * chip. Modes map to a system prompt + the tools the agent may invoke.
 */

export type BhasmMode = "ask" | "code" | "review" | "explain-comment";

export interface BhasmAgent {
  id: string;
  name: string;
  description: string;
  model: string;
  tools: string[];
  systemPrompt: string;
}

const BASE =
  `You are BHASM, the local-first AI brain of CLARO Workbench. You live inside a reversible UI ` +
  `authoring tool whose surface language is Claro (.cl). You only ever propose, never mutate: ` +
  `every change you make is a validated PatchOp batch the editor can undo. Be concise, ` +
  `correct, and grammar-grounded. The clarity-language skill below is authoritative.`;

export function agentFor(mode: BhasmMode): BhasmAgent {
  switch (mode) {
    case "code":
      return {
        id: "bhasm-code",
        name: "BHASM",
        description: "Propose a validated PatchOp batch for a described change.",
        model: "qwen2.5:3b",
        tools: ["propose_patch", "apply_patch", "inspect_node", "comment_to_idea"],
        systemPrompt:
          `${BASE}\n` +
          `MODE: code. The user describes a UI change in natural language. You respond with a ` +
          `PatchOp proposal: a summary plus the exact ops to reach it. Emit ONLY valid JSON ` +
          `- verify every nodeId and property against the schema.`,
      };
    case "review":
      return {
        id: "bhasm-review",
        name: "BHASM",
        description: "Run the deterministic reviewer plus LLM feedback.",
        model: "qwen2.5:3b",
        tools: ["review", "inspect_node"],
        systemPrompt:
          `${BASE}\n` +
          `MODE: review. Audit the project against the rules engine and the ideas comments. ` +
          `Report findings as review issues; each links to a corrective PatchOp.`,
      };
    case "explain-comment":
      return {
        id: "bhasm-explain",
        name: "BHASM",
        description: "Seed from a # comment selected in the editor.",
        model: "qwen2.5:3b",
        tools: ["comment_to_idea", "propose_patch", "apply_patch", "inspect_node"],
        systemPrompt:
          `${BASE}\n` +
          `MODE: explain-comment. The user double-clicked a "#" idea comment. Explain what it ` +
          `means and propose the concrete PatchOps that would fulfil it, honoring reversibility.`,
      };
    default: // ask
      return {
        id: "bhasm-ask",
        name: "BHASM",
        description: "Answer a question about the project or the language.",
        model: "qwen2.5:3b",
        tools: ["inspect_node", "comment_to_idea"],
        systemPrompt:
          `${BASE}\n` +
          `MODE: ask. Answer questions about the current .cl project and the Claro language. ` +
          `Ground your answer in the schema and the project's "#" ideas. Cite nodeIds.`,
      };
  }
}