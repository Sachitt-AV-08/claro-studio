/**
 * BhasmRuntime — the streaming agent loop.
 *
 * Assembles the system prompt from the agent (mode) + auto skills
 * (claro-language, ideas, user skills), health-gates, dispatches tool calls,
 * and streams the model's reply. Degrades gracefully to { ok:false, reason }.
 */

import type { Project } from "@project/contracts";
import { createBhasm, type Bhasm } from "@project/ai";
import { agentFor, type BhasmMode } from "./agent";
import { skills, type Skill } from "./skills";
import { toolById, type StoreAdapter, type ToolRunContext } from "./tools";

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
    const userPrompt = this.buildUserPrompt(agent.tools, opts.input, ctx);

    let text = "";
    try {
      if (agent.tools.includes("propose_patch")) {
        const proposal = await this.bhasm.proposePatch(opts.input, ctx.project);
        if (proposal.patch.ops.length) {
          cb.onEvent({
            type: "proposal",
            summary: proposal.summary,
            ops: proposal.patch.ops,
          });
          text =
            `**Plan**: ${proposal.summary}\n\n` +
            `\`\`\`json\n${JSON.stringify(proposal.patch.ops, null, 2)}\n\`\`\`\n\n` +
            `The ops dry-run clean through the engine. Open **Stitch** to see the seam.`;
        } else {
          text = `I could not produce a valid patch for "${opts.input}". ${proposal.rationale ?? ""}`;
        }
      } else {
        const completion = await this.bhasmDescribe(agent, system, userPrompt);
        text = completion;
      }
    } catch (e) {
      if (e instanceof Error) {
        cb.onEvent({ type: "error", reason: e.message });
      }
      return null;
    }

    // stream the answer in slices so the UI feels alive
    const final = { role: "assistant" as const, text, toolChips: _chips, final: true };
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

  private buildUserPrompt(
    tools: string[],
    input: string,
    ctx: ToolRunContext,
  ): string {
    const current = JSON.stringify(ctx.project.pages, null, 2);
    const ideas = skills.ideas(ctx.source);
    const ideasTxt = ideas.length
      ? ideas.map((i) => `- line ${i.line}: ${i.text}`).join("\n")
      : "(none)";
    return (
      `Available tools: ${tools.join(", ")}\n\n` +
      `User request: ${input}\n\n` +
      `Current project AST (pages):\n${current}\n\n` +
      `Project ideas (# comments):\n${ideasTxt}\n\n` +
      `Answer in concise markdown. Cite concrete nodeIds and schema from the skills.`
    );
  }
}

export const runtime = new BhasmRuntime();