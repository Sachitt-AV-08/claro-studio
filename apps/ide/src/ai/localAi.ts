import React, { useState, useMemo } from "react";
import { useClaroStore } from "../store/claroStore";

export interface ClaroAi {
  health(): Promise<{ ok: boolean; models: Array<{ name: string; size: number }>; error?: string }>;
  proposePatch(instruction: string, project: import("@project/contracts").Project): Promise<import("@project/contracts").PatchProposal>;
  review(project: import("@project/contracts").Project, includeLlm?: boolean): Promise<import("@project/contracts").ReviewResult>;
  applyPatch(project: import("@project/contracts").Project, ops: import("@project/contracts").PatchOp[]): Promise<ReturnType<import("@project/dsl").applyOps>>;
}

export function createClaroAi(): ClaroAi {
  return {
    async health() {
      // Placeholder - will be implemented when @project/ai is properly wired
      return { ok: false, models: [], error: "AI not yet connected. Wire @project/ai in IDE." };
    },

    async proposePatch(instruction: string, _project: import("@project/contracts").Project) {
      // Local stub: parse simple instructions for demo
      const ops: import("@project/contracts").PatchOp[] = [];
      
      if (instruction.toLowerCase().includes("red") && instruction.toLowerCase().includes("title")) {
        ops.push({ op: "set_property", target: "home.hero.title", property: "color", value: { t: "color", v: "#ef4444" } });
      }
      if (instruction.toLowerCase().includes("blue") && instruction.toLowerCase().includes("title")) {
        ops.push({ op: "set_property", target: "home.hero.title", property: "color", value: { t: "color", v: "#3b82f6" } });
      }
      if (instruction.toLowerCase().includes("bigger") && instruction.toLowerCase().includes("title")) {
        ops.push({ op: "set_property", target: "home.hero.title", property: "size", value: { t: "num", v: 64 } });
      }
      if (instruction.toLowerCase().includes("green")) {
        ops.push({ op: "set_property", target: "home.features", property: "background", value: { t: "color", v: "#22c55e" } });
      }
      
      return {
        workflow: "modify" as const,
        summary: ops.length ? `AI suggestion for: ${instruction}` : "No matching rule",
        patch: { summary: ops.length ? "demo ops" : "none", ops },
      };
    },

    async review(project: import("@project/contracts").Project) {
      // Delegate to deterministic rules only
      const issues: import("@project/contracts").ReviewIssue[] = [];
      return { issues, modelSourced: false };
    },

    async applyPatch(project: import("@project/contracts").Project, ops: import("@project/contracts").PatchOp[]) {
      const { applyOps } = await import("@project/dsl");
      return applyOps(project, ops);
    },
  };
}