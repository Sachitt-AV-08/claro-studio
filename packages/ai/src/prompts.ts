/**
 * System prompt templates optimized for qwen2.5:3b.
 *
 * Design principles for this model:
 * - Keep prompts under 500 tokens (model has 32k context but quality degrades)
 * - Be extremely explicit about output format — JSON only, no markdown
 * - Provide 1-2 examples per prompt (few-shot works best for 3B models)
 * - Use simple, direct language — no jargon
 * - Always show the full PatchOp vocabulary so the model doesn't invent new ops
 */

import { ELEMENTS } from "@project/contracts";

// ---------- schema summary (reused across prompts) ----------

const ELEMENT_LIST = Object.entries(ELEMENTS)
  .map(([name, el]) => {
    const props = Object.keys(el.props).join(", ");
    return `- ${name}${el.textContent ? " (has text content)" : ""}: ${props || "no props"}`;
  })
  .join("\n");

const OP_VOCABULARY = `PATCH OPS (use ONLY these, no others):

1. Set a property:
   {"op":"set_property","target":"home.hero.title","property":"color","value":{"t":"color","v":"#ff0000"}}

2. Set text content:
   {"op":"set_text","target":"home.hero.title","value":"New Title"}

3. Add an element:
   {"op":"add_element","parent":"home","element":{"kind":"element","nodeId":"","type":"text","name":"subtitle","props":{},"children":[],"source":{"start":{"line":0,"col":0},"end":{"line":0,"col":0},"text":""}},"position":"last"}

4. Remove an element:
   {"op":"remove_element","target":"home.hero.title"}

5. Move an element:
   {"op":"move_element","target":"home.hero.title","position":"first"}

6. Change layout:
   {"op":"set_layout","target":"home.hero","layout":"row"}

7. Add visual effect:
   {"op":"set_effects","target":"home.hero","effect":"glow"}

PropValue types:
- Number: {"t":"num","v":48} or {"t":"num","v":1.5,"unit":"em"}
- String: {"t":"str","v":"hello"}
- Color: {"t":"color","v":"#ff0000"} or {"t":"color","v":"rgb(255,0,0)"}
- Boolean: {"t":"bool","v":true}
- Enum: {"t":"enum","v":"primary"}
- Tuple: {"t":"tuple","v":[{"t":"num","v":24},{"t":"num","v":12}]}`;

// ---------- intent prompt (NL → PatchOp) ----------

export const INTENT_SYSTEM = `You convert natural language instructions into UI patch operations for the Claro (.cl) language.

Your job: Given a user instruction and the current project, produce a JSON object with:
- "summary": one sentence describing the change
- "ops": array of PatchOps (exactly as shown below)

AVAILABLE ELEMENTS:
${ELEMENT_LIST}

${OP_VOCABULARY}

IMPORTANT RULES:
- Output ONLY valid JSON. No markdown, no explanations, no code fences.
- target must be a nodeId that exists in the project (e.g. "home.hero.title")
- Only modify existing nodes unless the user asks to ADD something new
- Keep changes minimal — do exactly what the user asked, nothing more
- If the user says "bigger", increase size by ~30%
- If the user says "red", use color "#ef4444"
- If the user says "blue", use color "#3b82f6"
- If the user says "green", use color "#22c55e"
- If unsure about a nodeId, pick the most likely match from the available IDs

EXAMPLE:
User: "make the hero title blue"
Project has node "home.hero.title" (heading with size 24, color #000000)
Response: {"summary":"Changed hero title to blue","ops":[{"op":"set_property","target":"home.hero.title","property":"color","value":{"t":"color","v":"#3b82f6"}}]}`;

// ---------- describe prompt (intended source → PatchOp) ----------

export const DESCRIBE_SYSTEM = `You generate the smallest list of patch operations to transform current DSL into intended DSL.

Your job: Given a "current source" and an "intended source", produce a JSON object with:
- "summary": one sentence describing the diff
- "ops": array of PatchOps (exactly as shown below)

${OP_VOCABULARY}

RULES:
- Output ONLY valid JSON. No markdown, no explanations.
- Produce the MINIMUM number of ops needed.
- Only target nodeIds that exist in the current project.
- If the intended source adds new elements, use add_element.
- If the intended source removes elements, use remove_element.
- Focus on prop changes and text changes — those are the most common.

EXAMPLE:
Current: heading hero-title { size: 24, color: #000000 }
Intended: heading hero-title { size: 32, color: #ef4444 }
Response: {"summary":"Made heading larger and red","ops":[{"op":"set_property","target":"home.hero.hero-title","property":"size","value":{"t":"num","v":32}},{"op":"set_property","target":"home.hero.hero-title","property":"color","value":{"t":"color","v":"#ef4444"}}]}`;

// ---------- review prompt (project → feedback) ----------

export const REVIEW_SYSTEM = `You review Claro UI code and provide helpful feedback.

Given a project's AST and any issues found by the rules engine, write a short paragraph (2-4 sentences) of feedback. Focus on:
- UI/UX improvements that a designer would suggest
- Accessibility issues (missing alt text, low contrast, small touch targets)
- Consistency problems (uneven spacing, mixed font sizes)
- Layout improvements (better alignment, visual hierarchy)

Return JSON: {"feedback":"your paragraph here","suggestions":["suggestion 1","suggestion 2","suggestion 3"]}

RULES:
- Output ONLY valid JSON. No markdown.
- Be specific and actionable — not generic advice.
- Keep suggestions under 10 words each.
- Maximum 3 suggestions.
- Don't repeat issues already found by the rules engine.`;

// ---------- prompt builder ----------

export function buildIntentPrompt(
  instruction: string,
  astJson: string,
  nodeIds: string[],
  schemaHint: string,
): string {
  return `Current project:\n${astJson}\n\nAvailable node IDs:\n${nodeIds.join(", ")}\n\nElement schema:\n${schemaHint}\n\nInstruction: ${instruction}`;
}

export function buildDescribePrompt(
  intendedSource: string,
  currentSource: string,
  astJson: string,
  nodeIds: string[],
  schemaHint: string,
): string {
  return `Current project:\n${astJson}\n\nAvailable node IDs:\n${nodeIds.join(", ")}\n\nSchema:\n${schemaHint}\n\nCurrent DSL source:\n${currentSource}\n\nIntended DSL source:\n${intendedSource}\n\nGenerate minimal PatchOps to transform current into intended.`;
}

export function buildReviewPrompt(
  astJson: string,
  ruleIssues: string[],
  schemaHint: string,
): string {
  const issuesText =
    ruleIssues.length > 0
      ? `\n\nIssues found by static analysis:\n${ruleIssues.map((i) => `- ${i}`).join("\n")}`
      : "\n\nNo static analysis issues found.";
  return `Project AST:\n${astJson}\n\nSchema:\n${schemaHint}${issuesText}`;
}
