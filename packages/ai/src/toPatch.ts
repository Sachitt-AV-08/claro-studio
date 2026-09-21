/**
 * Describe → minimal patch.
 *
 * Given a target text snippet (what the user wants to end up with) and the
 * current DSL source, produce the smallest PatchOp list that would reach it.
 * Frame it as: "find the diff between intended structure and current structure,
 * express as ops".
 */

import type { Project } from "@project/contracts";
import { validateOps } from "@project/contracts";
import type { PatchProposal, AiWorkflow } from "@project/contracts";
import type { ModelProvider } from "@project/contracts";
import { buildContext } from "./intent.js";
import type { PatchOp } from "@project/contracts";

// ---------- system prompt ----------

const SYSTEM_PROMPT = `You are a minimal-patch generator for the Claro (.cl) reversible UI language.

Given a "current source" and an "intended source", produce the smallest list of PatchOps that transforms the current into the intended.

PATCH OP VOCABULARY (use ONLY these):
{"op":"set_property","target":"<nodeId>","property":"<prop>","value":<PropValue>}
{"op":"set_text","target":"<nodeId>","value":"<string>"}
{"op":"add_element","parent":"<nodeId>","element":<DslNode>,"position":"last"}
{"op":"remove_element","target":"<nodeId>"}
{"op":"move_element","target":"<nodeId>","position":"first|last","ref":"<nodeId>"}
{"op":"set_layout","target":"<nodeId>","layout":"stack|row|grid|overlay"}
{"op":"set_effects","target":"<nodeId>","effect":"aurora|particles|glow|noise"}

PropValue types: {"t":"num","v":<number>}, {"t":"str","v":"<string>"}, {"t":"color","v":"<hex>"},
{"t":"bool","v":<boolean>}, {"t":"enum","v":"<value>"}

Rules:
- Produce the MINIMUM number of ops needed
- Only target nodeIds that exist in the current project
- If the intended source adds new elements, use add_element with the full DslNode
- Return ONLY valid JSON: {"summary":"...","ops":[...]}`;

// ---------- main function ----------

export async function describeToPatch(
  intendedSource: string,
  currentSource: string,
  project: Project,
  provider: ModelProvider,
): Promise<PatchProposal> {
  const ctx = buildContext(project);

  const userPrompt = `Current project AST:\n${ctx.astJson}\n\nAvailable node IDs:\n${Object.keys(ctx.idMap).join(", ")}\n\nSchema:\n${ctx.schemaHint}\n\nCurrent DSL source:\n${currentSource}\n\nIntended DSL source (what the user wants):\n${intendedSource}\n\nGenerate the minimal PatchOp list to transform current into intended.`;

  const result = await tryDescribe(provider, userPrompt);
  if (result.ok) return result.proposal;

  // Retry once
  const retryPrompt = `${userPrompt}\n\nPrevious attempt failed: ${result.error}\nFix and try again.`;
  const retry = await tryDescribe(provider, retryPrompt);
  if (retry.ok) return retry.proposal;

  return {
    workflow: "modify" as AiWorkflow,
    summary: `Failed to generate patch: ${retry.error}`,
    patch: { summary: "failed", ops: [] },
    rationale: retry.error,
  };
}

async function tryDescribe(
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
        summary: raw.summary || "Describe-to-patch",
        patch: { summary: raw.summary || "patch", ops },
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
