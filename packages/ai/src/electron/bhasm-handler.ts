/**
 * Bhasm IPC handler for Electron main process.
 *
 * Register these handlers in your main.ts to expose Bhasm to the renderer.
 *
 * Usage in main.ts:
 *   import { registerBhasmHandlers } from "@project/ai/electron/bhasm-handler";
 *   registerBhasmHandlers(ipcMain);
 *
 * Note: This file avoids importing 'electron' directly so it can typecheck
 * without electron as a dependency. The caller must pass an IpcMain-like object.
 */

import { createBhasm } from "../integration.js";
import type { Project } from "@project/contracts";

const bhasm = createBhasm();

/** Minimal IpcMain interface — avoids direct electron import. */
interface IpcMainLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(channel: string, listener: (...args: any[]) => any): void;
}

export function registerBhasmHandlers(ipcMain: IpcMainLike): void {
  ipcMain.handle("bhasm:health", () => bhasm.health());
  ipcMain.handle("bhasm:status", () => bhasm.status());
  ipcMain.handle("bhasm:propose", (_event: unknown, instruction: string, project: Project) =>
    bhasm.proposePatch(instruction, project),
  );
  ipcMain.handle("bhasm:describe", (_event: unknown, intended: string, current: string, project: Project) =>
    bhasm.describePatch(intended, current, project),
  );
  ipcMain.handle("bhasm:review", (_event: unknown, project: Project) =>
    bhasm.review(project),
  );
}
