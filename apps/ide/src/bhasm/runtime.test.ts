import { describe, it, expect } from "vitest";
import type { ReviewResult } from "@project/contracts";
import { formatReview } from "./runtime";
import { agentFor } from "./agent";

describe("formatReview", () => {
  it("reports a clean project", () => {
    const report = formatReview({ issues: [], modelSourced: false });
    expect(report).toContain("clean");
    expect(report).not.toContain("fix:");
  });

  it("groups findings by severity with nodeIds and inline fix ops", () => {
    const result: ReviewResult = {
      modelSourced: true,
      issues: [
        { id: "i1", rule: "nesting", severity: "error", nodeId: "home.nav", message: "nav is too deep" },
        {
          id: "i2",
          rule: "accessibility",
          severity: "warning",
          nodeId: "hero.cta",
          message: "missing alt",
          fix: { summary: "add alt", ops: [{ op: "set_property", target: "hero.cta", property: "alt", value: "CTA" }] },
        },
        { id: "i3", rule: "naming", severity: "info", message: "consider renaming" },
      ],
    };
    const report = formatReview(result);
    expect(report).toContain("Review — 3 findings");
    expect(report).toContain("1 error · 1 warning · 1 info");
    expect(report).toContain("- **[error]** nesting `home.nav`");
    expect(report).toContain("- **[warning]** accessibility `hero.cta`");
    expect(report).toContain("set_property");
    expect(report).toContain("missing alt");
  });
});

describe("mode tool assignment (modes do their own job)", () => {
  it("code keeps propose_patch", () => {
    const tools = agentFor("code").tools;
    expect(tools).toContain("propose_patch");
  });

  it("review exposes review", () => {
    expect(agentFor("review").tools).toContain("review");
  });

  it("explain-comment no longer auto-generates ops", () => {
    const tools = agentFor("explain-comment").tools;
    expect(tools).not.toContain("propose_patch");
    expect(tools).not.toContain("apply_patch");
    expect(tools).toContain("comment_to_idea");
  });

  it("ask describes tools only", () => {
    const tools = agentFor("ask").tools;
    expect(tools).not.toContain("propose_patch");
    expect(tools).toContain("query_graph");
  });
});