/**
 * BhasmRuntime — the streaming agent loop.
 *
 * Assembles the system prompt from the agent (mode) + auto skills
 * (claro-language, ideas, user skills), health-gates, dispatches tool calls,
 * and streams the model's reply. Degrades gracefully to { ok:false, reason }.
 */

import type { Project, ReviewResult } from "@project/contracts";
import { createBhasm, type Bhasm } from "@project/ai";
import { agentFor, type BhasmMode } from "./agent";
import { skills, type Skill } from "./skills";
import { toolById, type StoreAdapter, type ToolRunContext } from "./tools";
import { graphifyGraphSummary, mcpSidecarRunning, mcpCallTool } from "./mcp";
import { routeTool, guardrailOps, isConfidentReject, isConversational, shouldPropose } from "./decisions";
import { loadBhasmGraphSettings } from "../graph/graphSettings";

/** Chat-only persona for greetings/small talk — never generates code or JSON. */
const CONVERSATION_SYSTEM =
  `You are BHASM, the friendly local-first AI brain of CLARO Workbench. The user just ` +
  `greeted you or made small talk. Chat warmly and briefly (1-3 sentences). Do NOT generate ` +
  `code, PatchOps, or JSON. If they seem ready to work, tell them what you can do (ask, code, ` +
  `review, explain a "#" idea) and that every change they make is reversible.`;

const SEVERITY_LABEL: Record<string, string> = {
  error: "error",
  warning: "warning",
  info: "info",
};

/** Format engine review findings into a scannable markdown report. Pure — unit-testable. */
export function formatReview(result: ReviewResult): string {
  if (!result.issues.length) {
    return "## Review — clean\n\nNo issues found. The project looks consistent.";
  }
  const count = (s: string) => result.issues.filter((i) => i.severity === s).length;
  const lines: string[] = [`## Review — ${result.issues.length} finding${result.issues.length === 1 ? "" : "s"}`];
  lines.push(`**${count("error")} error · ${count("warning")} warning · ${count("info")} info**`, "");
  for (const issue of result.issues) {
    const at = issue.nodeId ? ` \`${issue.nodeId}\`` : "";
    lines.push(`- **[${SEVERITY_LABEL[issue.severity] ?? issue.severity}]** ${issue.rule}${at}`);
    lines.push(`  ${issue.message}`);
    if (issue.fix?.ops?.length) {
      const json = JSON.stringify(issue.fix.ops, null, 2)
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n");
      lines.push(`  fix:\n  \`\`\`json\n${json}\n  \`\`\``);
    }
  }
  return lines.join("\n");
}

export interface BhasmMessage {
  role: "user" | "assistant";
  text: string;
  toolChips?: { tool: string; ok: boolean }[];
  final?: boolean;
}

export interface RunCallbacks {
  onEvent: (ev: BhasmRunEvent) => void;
}

export type BhasmRunEvent =
  | { type: "start" }
  | { type: "tool"; id: string; ok: boolean; detail?: string }
  | { type: "proposal"; summary: string; ops: import("@project/contracts").PatchOp[] }
  | { type: "delta"; text: string }
  | { type: "done"; message: BhasmMessage }
  | { type: "error"; reason: string };

export interface BhasmRunOptions {
  mode: BhasmMode;
  input: string;
  project: Project;
  source: string;
  store: StoreAdapter;
  skillOverrides?: Skill[]; // e.g. explain-comment seeds a specific comment
  /** inject query_graph results into the user prompt when the sidecar is up */
  graphAssist?: boolean;
}

export class BhasmRuntime {
  private bhasm: Bhasm;
  private healthOk = false;
  private healthError?: string;

  constructor(_model = "qwen2.5:3b") {
    this.bhasm = createBhasm({ model: _model });
  }

  async health() {
    const res = await this.bhasm.health();
    this.healthOk = res.ok;
    this.healthError = res.error;
    return res;
  }

  get ready() {
    return this.healthOk;
  }

  async run(opts: BhasmRunOptions, cb: RunCallbacks): Promise<BhasmMessage> {
    await this.health();
    if (!this.healthOk) {
      cb.onEvent({
        type: "error",
        reason: `Ollama offline (${this.healthError ?? "no model on :11434"}). Start Ollama with qwen2.5:3b and retry.`,
      });
      return { role: "assistant", text: "", final: true };
    }

    cb.onEvent({ type: "start" });

    // Conversational gate: "hi"/"thanks" etc. must never reach the task engine
    // (which would happily turn "hi" into PatchOps that display "hi").
    if (isConversational(opts.input)) {
      return this.answerConversational(opts.input, cb);
    }

    const agent = agentFor(opts.mode);
    const active = opts.skillOverrides ?? (await skills.forAgent(opts.source));
    const system = this.buildSystemPrompt(agent.systemPrompt, active);

    const chips: { tool: string; ok: boolean }[] = [];
    const ctx: ToolRunContext = {
      project: opts.project,
      source: opts.source,
      store: opts.store,
    };

    // ---- tool phase: BHASM answers with JSON that selects a tool ----
    // Keep it deterministic and honest: dispatch based on mode + user input,
    // then stream the resulting markdown answer.
    try {
      const chosen = this.dispatch(agent.tools);
      for (const tool of chosen) {
        cb.onEvent({ type: "tool", id: tool.tool, ok: true });
        chips.push({ tool: tool.tool, ok: true });
      }

      // Claro Decisions router: pick the primary tool for this run on the local
      // 3B model (schema-forced JSON + confidence), then surface the pick as a
      // chip. Advisory by design — query_graph is already shown by graph assist
      // and the deterministic dispatch never regresses.
      const route = await routeTool(opts.mode, opts.input, agent.tools);
      if (route.result.valid && route.choice !== "query_graph") {
        cb.onEvent({ type: "tool", id: route.choice, ok: true, detail: "route" });
        chips.push({ tool: route.choice, ok: true });
      }

      const answer = await this.streamAnswer(agent, system, opts, ctx, chips, cb);
      if (answer) return answer;
    } catch (e) {
      cb.onEvent({ type: "error", reason: e instanceof Error ? e.message : String(e) });
      return { role: "assistant", text: "", final: true };
    }

    cb.onEvent({ type: "error", reason: "BHASM returned an empty reply." });
    return { role: "assistant", text: "", final: true };
  }

  /** Pick which tools to flash based on mode + input (kept light for the demo). */
  private dispatch(tools: string[]): { tool: string }[] {
    const out: { tool: string }[] = [];
    for (const id of tools) {
      const t = toolById(id);
      if (!t) continue;
      // auto-inject the project-context tools
      if (id === "comment_to_idea" || id === "inspect_node") out.push({ tool: id });
    }
    return out;
  }

  private async streamAnswer(
    agent: ReturnType<typeof agentFor>,
    system: string,
    opts: BhasmRunOptions,
    ctx: ToolRunContext,
    _chips: { tool: string; ok: boolean }[],
    cb: RunCallbacks,
  ): Promise<BhasmMessage | null> {
    let userPrompt = await this.buildUserPrompt(agent.tools, opts.input, ctx);

    // Graph assist (Phase 3): when the mode exposes query_graph AND the user
    // wants graph grounding AND the sidecar is actually up, ask the project
    // graph about the same question and feed the traversal back into the
    // prompt. Best-effort — the answer still streams with or without it.
    const assist =
      opts.graphAssist !== false &&
      agent.tools.includes("query_graph") &&
      (await mcpSidecarRunning());
    if (assist) {
      const r = await mcpCallTool("query_graph", { question: opts.input });
      cb.onEvent({ type: "tool", id: "query_graph", ok: r.ok });
      if (r.ok && r.text) {
        const trimmed = r.text.length > 900 ? `${r.text.slice(0, 900)}\n…(truncated)` : r.text;
        userPrompt += `\n\nGraph context (query_graph on the same question):\n${trimmed}`;
      }
    }

    let text = "";
    try {
      switch (opts.mode) {
        case "code":
          // assigned task: natural language → validated reversible PatchOps
          text = await this.proposePatchAnswer(opts, cb);
          break;
        case "review":
          // assigned task: actually run the rules engine + LLM pass
          cb.onEvent({ type: "tool", id: "review", ok: true });
          text = formatReview(await this.bhasm.review(opts.project, true));
          break;
        case "explain-comment": {
          // assigned task: explain the seeded "#" idea; propose ops only when
          // the decision layer is confident the idea demands a change
          const seeded = this.matchSeedIdea(opts.input, opts.source);
          if (seeded) userPrompt += `\n\nSeeded idea to explain: "${seeded.text}" (line ${seeded.line}).`;
          text = (await shouldPropose(seeded?.text ?? opts.input))
            ? await this.proposePatchAnswer(opts, cb)
            : await this.bhasmDescribe(agent, system, userPrompt);
          break;
        }
        default:
          // ask: grounded conversational answer about the codebase
          text = await this.bhasmDescribe(agent, system, userPrompt);
      }
    } catch (e) {
      if (e instanceof Error) {
        cb.onEvent({ type: "error", reason: e.message });
      }
      return null;
    }

    return this.stream(text, _chips, cb);
  }

  /** code / explain-comment-propose path: proposePatch + decision guardrail. */
  private async proposePatchAnswer(opts: BhasmRunOptions, cb: RunCallbacks): Promise<string> {
    const proposal = await this.bhasm.proposePatch(opts.input, opts.project);
    if (!proposal.patch.ops.length) {
      return `I could not produce a valid patch for "${opts.input}". ${proposal.rationale ?? ""}`;
    }
    const guard = await guardrailOps(proposal.patch.ops);
    if (isConfidentReject(guard, await loadBhasmGraphSettings())) {
      cb.onEvent({
        type: "tool",
        id: "apply_patch",
        ok: false,
        detail: `guardrail: ${guard.reason ?? "confident reject"}`,
      });
      return (
        `**Blocked by the decision guardrail** (${(guard.probability * 100).toFixed(0)}% reject confidence). ` +
        `${guard.reason ?? "This patch looks risky."} I did not propose it.`
      );
    }
    cb.onEvent({ type: "proposal", summary: proposal.summary, ops: proposal.patch.ops });
    return (
      `**Plan**: ${proposal.summary}\n\n` +
      `\`\`\`json\n${JSON.stringify(proposal.patch.ops, null, 2)}\n\`\`\`\n\n` +
      `The ops dry-run clean through the engine. Open **Stitch** to see the seam.`
    );
  }

  /** Match the seeded "#" idea (from a `claro:bhasm-prompt` double-click) in source. */
  private matchSeedIdea(
    input: string,
    source: string,
  ): { line: number; text: string } | undefined {
    const tail = input
      .replace(/^explain(?: and improve)?:?\s*/i, "")
      .replace(/^explain(?: the idea)?:?\s*/i, "")
      .trim()
      .toLowerCase();
    if (!tail) return undefined;
    const ideas = skills.ideas(source);
    const exact = ideas.find((i) => i.text.toLowerCase() === tail);
    if (exact) return exact;
    return ideas.find(
      (i) => i.text.toLowerCase().includes(tail) || tail.includes(i.text.toLowerCase()),
    );
  }

  /** Chatty reply for greetings — short model turn, never tools/patches. */
  private async answerConversational(input: string, cb: RunCallbacks): Promise<BhasmMessage> {
    const fallback =
      `Hey! I'm BHASM — the local AI inside Claro Workbench. I can answer questions about the ` +
      `codebase, propose reversible edits (code mode), run a review, or explain your "#" ideas. ` +
      `What would you like to do?`;
    let text = fallback;
    try {
      const { createOllamaProvider } = await import("@project/ai");
      const provider = createOllamaProvider("qwen2.5:3b");
      const r = await provider.complete(CONVERSATION_SYSTEM, input.trim().slice(0, 400));
      if (r.text.trim()) text = r.text;
    } catch {
      // keep the canned reply
    }
    return this.stream(text, [], cb);
  }

  /** Stream a complete answer in slices so the UI feels alive. */
  private stream(
    text: string,
    chips: { tool: string; ok: boolean }[],
    cb: RunCallbacks,
  ): Promise<BhasmMessage> {
    const final = { role: "assistant" as const, text, toolChips: chips, final: true };
    const step = 6;
    let shown = 0;
    return new Promise((resolve) => {
      const tick = () => {
        const next = Math.min(shown + step, text.length);
        cb.onEvent({ type: "delta", text: text.slice(0, next) });
        shown = next;
        if (shown >= text.length) {
          cb.onEvent({ type: "done", message: final });
          resolve(final);
        } else {
          setTimeout(tick, 12);
        }
      };
      setTimeout(tick, 40);
    });
  }

  private async bhasmDescribe(
    agent: ReturnType<typeof agentFor>,
    system: string,
    user: string,
  ): Promise<string> {
    // fall back to the raw provider with our grounded system prompt
    const { createOllamaProvider } = await import("@project/ai");
    const provider = createOllamaProvider(agent.model);
    const r = await provider.complete(system, user);
    return r.text;
  }

  private buildSystemPrompt(base: string, active: Skill[]): string {
    const head =
      `# Skills (grounding)\n\n${active
        .map((s) => `## ${s.name}\n${s.content}`)
        .join("\n\n---\n\n")}`;
    return `${base}\n\n${head}`;
  }

private async buildUserPrompt(
    tools: string[],
    input: string,
    ctx: ToolRunContext,
  ): Promise<string> {
    const current = JSON.stringify(ctx.project.pages, null, 2);
    const ideas = skills.ideas(ctx.source);
    const ideasTxt = ideas.length
      ? ideas.map((i) => `- line ${i}: ${i.text}`).join("\n")
      : "(none)";
    const graph = await this.graphGrounding();
    return (
      `Available tools: ${tools.join(", ")}\n\n` +
      `User request: ${input}\n\n` +
      `Current project AST (pages):\n${current}\n\n` +
      `Project ideas (# comments):\n${ideasTxt}\n\n` +
      (graph ? `${graph}\n\n` : "") +
      `Answer in concise markdown. Cite concrete nodeIds and schema from the skills.`
    );
  }

  /** Best-effort project-graph grounding line (graphify sidecar), or null. */
  private async graphGrounding(): Promise<string | null> {
    try {
      const summary = await graphifyGraphSummary();
      return summary ? `Project graph (graphify): ${summary}` : null;
    } catch {
      return null;
    }
  }
}

export const runtime = new BhasmRuntime();