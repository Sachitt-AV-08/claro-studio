import { create } from "zustand";
import { applyOps, validateOps } from "@project/dsl";
import type { Project, PatchOp } from "@project/contracts";

/**
 * Stitch — the seam between two versions.
 *
 * Google-Stitch-style: Source A (base), the PatchOps flowing across the seam,
 * and Destination (base + ops applied). Everything is reversible: the seam
 * holds the exact ops, and the destination preview can be discarded or
 * committed back into the editor undo stack.
 */

export interface StitchProposal {
  id: string;
  summary: string;
  baseProject: Project;
  ops: PatchOp[];
  provenance: "bhasm" | "idea" | "manual" | "export";
}

export interface StitchState {
  proposal: StitchProposal | null;
  goal: string | null;
  setProposal: (p: StitchProposal | null) => void;
  clear: () => void;
  setGoal: (goal: string | null) => void;
}

let sid = 0;
export const nextProposalId = () => `stitch-${++sid}`;

export const useStitchStore = create<StitchState>((set) => ({
  proposal: null,
  goal: null,

  setProposal(p) {
    set({ proposal: p });
  },
  clear() {
    set({ proposal: null });
  },
  setGoal(goal) {
    set({ goal });
  },
}));

export function makeProposal(
  summary: string,
  ops: PatchOp[],
  project: Project,
  provenance: StitchProposal["provenance"],
): StitchProposal {
  return { id: nextProposalId(), summary, baseProject: project, ops, provenance };
}

/** Apply ops to a snapshot project for the Destination preview. applyOps mutates in place, so clone first. */
export function destProject(base: Project, ops: PatchOp[]): Project {
  const clone = structuredClone(base);
  const applied = applyOps(clone, ops);
  return applied.ok ? clone : base;
}

/** Dry-check an op batch against the seam validators. */
export function checkOps(ops: PatchOp[]) {
  return validateOps(ops);
}