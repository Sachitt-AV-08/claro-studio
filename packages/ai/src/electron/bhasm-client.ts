/**
 * Bhasm renderer-side client for the IDE.
 *
 * This is the typed interface the React UI calls. It communicates with
 * the main process over IPC where Bhasm actually runs.
 *
 * Usage:
 *   import { bhasm } from "@project/ai/electron/bhasm-client";
 *   const proposal = await bhasm.proposePatch("make it red", project);
 */

import type {
  Project,
  PatchProposal,
  ReviewResult,
  ModelStatus,
} from "@project/contracts";

/** The electron IPC bridge exposed by preload.ts */
interface ElectronIpc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

function getIpc(): ElectronIpc {
  const win = window as Window & { electronAPI?: { ipcRenderer?: ElectronIpc } };
  if (!win.electronAPI?.ipcRenderer) {
    throw new Error(
      "Bhasm client must be used in an Electron renderer process. " +
      "Ensure preload.ts exposes electronAPI.ipcRenderer.",
    );
  }
  return win.electronAPI.ipcRenderer;
}

/** Typed Bhasm client for the renderer process. */
export const bhasm = {
  /** Check if Ollama is running and the model is available. */
  async health(): Promise<{ ok: boolean; models: Array<{ name: string; size: number }>; error?: string }> {
    return getIpc().invoke("bhasm:health") as Promise<{ ok: boolean; models: Array<{ name: string; size: number }>; error?: string }>;
  },

  /** Get current model status. */
  async status(): Promise<ModelStatus> {
    return getIpc().invoke("bhasm:status") as Promise<ModelStatus>;
  },

  /** Natural language → PatchOp list. */
  async proposePatch(instruction: string, project: Project): Promise<PatchProposal> {
    return getIpc().invoke("bhasm:propose", instruction, project) as Promise<PatchProposal>;
  },

  /** Diff → minimal PatchOps. */
  async describePatch(
    intendedSource: string,
    currentSource: string,
    project: Project,
  ): Promise<PatchProposal> {
    return getIpc().invoke("bhasm:describe", intendedSource, currentSource, project) as Promise<PatchProposal>;
  },

  /** Review project with rules engine + optional LLM feedback. */
  async review(project: Project): Promise<ReviewResult> {
    return getIpc().invoke("bhasm:review", project) as Promise<ReviewResult>;
  },
};
