import { create } from "zustand";
import {
  parse,
  format,
  applyOps,
  validateOps,
  type Project,
} from "@project/dsl";
import type {
  Diagnostic,
  PatchOp,
} from "@project/contracts";

/**
 * Single source of truth for the editor + preview.
 *
 * Every mutation — typing in Monaco, clicking an AI suggestion, undoing — flows
 * through the Claro engine (@project/dsl). The engine parses, formats and
 * patch-applies; this store only orchestrates it. Nothing here mutates the AST
 * by hand.
 */

export const DEFAULT_SOURCE = `page Home {
    section hero {
        heading "Welcome to CLARO" {
            size: 48
        }
        text "Reversible, AI-native UI. Write it, preview it, undo it." {
            color: #c8c8d0
            size: 18
        }
        button "Get Started"
    }

    section features {
        stack {
            card "Reversible"
            card "Edge AI"
            card "Feels like English"
        }
    }
}
`;

export interface EngineOutcome {
  ok: boolean;
  error?: string;
}

interface ClaroState {
  source: string;
  project: Project;
  errors: Diagnostic[];
  warnings: Diagnostic[];
  selection: string | null;
  inverseStack: PatchOp[][];
  forwardStack: PatchOp[][];
  setSource(source: string): void;
  applyOps(ops: PatchOp[]): EngineOutcome;
  undo(): void;
  redo(): void;
  select(nodeId: string | null): void;
}

function buildProject(source: string): { project: Project } {
  return { project: parse(source) };
}

export const useClaroStore = create<ClaroState>((set, get) => {
  const initial = buildProject(DEFAULT_SOURCE);

  const sync = (project: Project) =>
    set({
      project,
      source: format(project),
      errors: project.diagnostics.filter((d) => d.severity === "error"),
      warnings: project.diagnostics.filter((d) => d.severity === "warning"),
    });

  return {
    source: DEFAULT_SOURCE,
    project: initial.project,
    errors: initial.project.diagnostics.filter((d) => d.severity === "error"),
    warnings: initial.project.diagnostics.filter(
      (d) => d.severity === "warning",
    ),
    selection: null,
    inverseStack: [],
    forwardStack: [],

    setSource(source) {
      const { project } = buildProject(source);
      set({
        source,
        project,
        errors: project.diagnostics.filter((d) => d.severity === "error"),
        warnings: project.diagnostics.filter((d) => d.severity === "warning"),
      });
    },

    applyOps(ops) {
      const state = get();
      const check = validateOps(ops);
      if (!check.ok) return { ok: false, error: check.error };

      const { project } = state;
      const result = applyOps(project, ops);
      if (!result.ok) return { ok: false, error: result.error };

      set({
        inverseStack: [...state.inverseStack, result.inverse],
        forwardStack: [],
      });
      sync(project);
      return { ok: true };
    },

    undo() {
      const state = get();
      const batch = state.inverseStack[state.inverseStack.length - 1];
      if (!batch) return;
      const result = applyOps(state.project, batch);
      if (!result.ok) return;
      set({
        inverseStack: state.inverseStack.slice(0, -1),
        forwardStack: [...state.forwardStack, result.inverse],
      });
      sync(state.project);
    },

    redo() {
      const state = get();
      const batch = state.forwardStack[state.forwardStack.length - 1];
      if (!batch) return;
      const result = applyOps(state.project, batch);
      if (!result.ok) return;
      set({
        forwardStack: state.forwardStack.slice(0, -1),
        inverseStack: [...state.inverseStack, result.inverse],
      });
      sync(state.project);
    },

    select(nodeId) {
      set({ selection: nodeId });
    },
  };
});