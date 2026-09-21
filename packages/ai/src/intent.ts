/**
 * Natural-language → PatchOp list.
 *
 * Given the current DslProject and a user sentence ("make the hero title bigger
 * and red"), emit ONLY a list of valid PatchOps. The IDE preview applies them,
 * so AI never mutates AST directly.
 */

import type { DslNode, Project } from "@project/contracts";
import { validateOps } from "@project/contracts";
import type { PatchProposal, ProjectContext, AiWorkflow, PatchOp } from "@project/contracts";
import { ELEMENTS } from "@project/contracts";
import type { ModelProvider } from "@project/contracts";

// ---------- DSL schema summary for the system prompt ----------

const ELEMENT_LIST = Object.keys(ELEMENTS)
  .map((k) => `- ${k}: ${ELEMENTS[k].doc}`)
  .join("\n");

const PROP_LIST = (() => {
  const lines: string[] = [];
  for (const [name, el] of Object.entries(ELEMENTS)) {
    const props = Object.keys(el.props).join(", ");
    if (props) lines.push(`${name}: ${props}`);
  }
  return lines.join("\n");
})();

// ---------- build context from AST ----------

function flattenNodes(nodes: DslNode[]): DslNode[] {
  const out: DslNode[] = [];
  for (const n of nodes) {
    out.push(n);
    if (n.children.length > 0) {
      out.push(...flattenNodes(n.children));
    }
  }
  return out;
}

function flattenAll(project: Project): DslNode[] {
  const out: DslNode[] = [];
  for (const page of project.pages) {
    out.push(page);
    if (page.children.length > 0) out.push(...flattenNodes(page.children));
  }
  for (const comp of project.components) {
    out.push(comp);
    if (comp.children.length > 0) out.push(...flattenNodes(comp.children));
  }
  return out;
}

export function buildContext(project: Project): ProjectContext {
  const allNodes = flattenAll(project);

  const idMap: Record<string, { range: unknown; nodeId: string }> = {};
  for (const n of allNodes) {
    idMap[n.nodeId] = { range: n.source, nodeId: n.nodeId };
  }

  return {
    file: "current.cl",
    astJson: JSON.stringify(project.pages, null, 2),
    idMap,
    diagnostics: project.diagnostics,
    schemaHint: `Elements:\n${ELEMENT_LIST}\n\nProperties per element:\n${PROP_LIST}`,
  };
}

// ---------- system prompt ----------

const SYSTEM_PROMPT = `You are a UI patching assistant for the Claro (.cl) reversible UI language.

Given a user instruction and the current project AST, produce a JSON object with:
- "summary": one-line description of what you are changing
- "ops": array of PatchOp objects

PATCH OP VOCABULARY (use ONLY these):
{"op":"set_property","target":"<nodeId>","property":"<prop>","value":<PropValue>}
{"op":"clear_property","target":"<nodeId>","property":"<prop>"}
{"op":"set_text","target":"<nodeId>","value":"<string>"}
{"op":"add_element","parent":"<nodeId>","element":<DslNode>,"position":"last"}
{"op":"remove_element","target":"<nodeId>"}
{"op":"move_element","target":"<nodeId>","position":"first|last","ref":"<nodeId>"}
{"op":"set_layout","target":"<nodeId>","layout":"stack|row|grid|overlay"}
{"op":"set_effects","target":"<nodeId>","effect":"aurora|particles|glow|noise"}

PropValue types: {"t":"num","v":<number>}, {"t":"str","v":"<string>"}, {"t":"color","v":"<hex>"},
{"t":"bool","v":<boolean>}, {"t":"enum","v":"<value>"}

Rules:
- target must be a valid nodeId from the project (e.g. "home.hero.title")
- Only modify existing nodes unless the user explicitly asks to add something
- Keep changes minimal — do exactly what the user asked
- If unsure about a nodeId, pick the most likely match from the AST
- Return ONLY valid JSON, no markdown`;

// ---------- main function ----------

export async function proposeIntent(
  instruction: string,
  project: Project,
  provider: ModelProvider,
): Promise<PatchProposal> {
  const ctx = buildContext(project);

  const userPrompt = `Current project:\n${ctx.astJson}\n\nAvailable node IDs:\n${Object.keys(ctx.idMap).join(", ")}\n\nSchema:\n${ctx.schemaHint}\n\nInstruction: ${instruction}`;

  // First attempt
  const result = await tryPropose(provider, userPrompt);
  if (result.ok) return result.proposal;

  // Retry with error context
  const retryPrompt = `${userPrompt}\n\nPrevious attempt failed: ${result.error}\nPlease fix the issues and try again.`;
  const retry = await tryPropose(provider, retryPrompt);
  if (retry.ok) return retry.proposal;

  return {
    workflow: "modify" as AiWorkflow,
    summary: `Failed to generate patch: ${retry.error}`,
    patch: { summary: "failed", ops: [] },
    rationale: retry.error,
  };
}

async function tryPropose(
  provider: ModelProvider,
  userPrompt: string,
): Promise<
  | { ok: true; proposal: PatchProposal }
  | { ok: false; error: string }
> {
  try {
    const raw = await provider.structuredComplete<{
      summary: string;
      ops: unknown[];
    }>(SYSTEM_PROMPT, userPrompt, { summary: "", ops: [] });

    if (!raw || !Array.isArray(raw.ops)) {
      return { ok: false, error: "Model returned non-array ops" };
    }

    const ops = raw.ops as PatchOp[];
    const validation = validateOps(ops);
    if (!validation.ok) {
      return { ok: false, error: validation.error };
    }

    return {
      ok: true,
      proposal: {
        workflow: "modify",
        summary: raw.summary || "AI-suggested patch",
        patch: { summary: raw.summary || "patch", ops },
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
