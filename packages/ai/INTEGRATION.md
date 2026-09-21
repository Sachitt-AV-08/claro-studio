# Bhasm — IDE Integration Guide

**Bhasm** is the AI brain of CLARO Studio. It runs locally on Ollama (`qwen2.5:3b`) and proposes UI patches from natural language.

## Quick Start

```typescript
import { createBhasm } from "@project/ai";

const bhasm = createBhasm(); // uses qwen2.5:3b by default

// Check if model is available
const h = await bhasm.health();
if (!h.ok) {
  console.error("Ollama not running or model missing");
  return;
}

// Natural language → Patch
const proposal = await bhasm.proposePatch("make the hero title red", project);
console.log(proposal.summary); // "Changed hero title color to red"
console.log(proposal.patch.ops); // validated PatchOp[]

// Apply patches
const result = bhasm.applyPatch(project.pages, proposal.patch.ops);
if (result.ok) {
  project.pages = result.ops ? project.pages : project.pages;
  // result.inverse contains the undo ops
}
```

## API Reference

### `createBhasm(options?)`

Creates the Bhasm client. Returns `Bhasm`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | `"qwen2.5:3b"` | Ollama model name |
| `provider` | `ModelProvider` | Ollama | Custom backend (for testing) |

### `bhasm.health()`

Check if Ollama is running and the model is loaded.

### `bhasm.proposePatch(instruction, project)`

Natural language → validated PatchOps. **Latency:** ~1-3s on qwen2.5:3b (8GB VRAM)

### `bhasm.describePatch(intendedSource, currentSource, project)`

Diff → minimal PatchOps.

### `bhasm.review(project, includeLlm?)`

Rules engine + optional LLM feedback.

### `bhasm.applyPatch(pages, ops)`

Apply PatchOps to AST. Returns `{ ok, ops, inverse }`.

## IPC Integration (Electron)

Bhasm runs in the **main process** and communicates with the renderer via IPC.

### Main Process Handler

```typescript
// src-electron/bhasm-handler.ts
import { createBhasm } from "@project/ai";
import type { Project } from "@project/contracts";

const bhasm = createBhasm();

export function registerBhasmHandlers(ipcMain: Electron.IpcMain): void {
  ipcMain.handle("bhasm:health", () => bhasm.health());
  ipcMain.handle("bhasm:status", () => bhasm.status());
  ipcMain.handle("bhasm:propose", (_e, instruction: string, project: Project) =>
    bhasm.proposePatch(instruction, project),
  );
  ipcMain.handle("bhasm:describe", (_e, intended: string, current: string, project: Project) =>
    bhasm.describePatch(intended, current, project),
  );
  ipcMain.handle("bhasm:review", (_e, project: Project) =>
    bhasm.review(project),
  );
}
```

### Renderer-Side Client

```typescript
// src/lib/bhasm-client.ts
import type { Project, PatchProposal, ReviewResult, ModelStatus } from "@project/contracts";

const ipc = window.electronAPI.ipcRenderer;

export const bhasm = {
  health: () => ipc.invoke("bhasm:health"),
  status: () => ipc.invoke("bhasm:status"),
  proposePatch: (instruction: string, project: Project): Promise<PatchProposal> =>
    ipc.invoke("bhasm:propose", instruction, project),
  describePatch: (intended: string, current: string, project: Project): Promise<PatchProposal> =>
    ipc.invoke("bhasm:describe", intended, current, project),
  review: (project: Project): Promise<ReviewResult> =>
    ipc.invoke("bhasm:review", project),
};
```

### Usage in React Component

```tsx
// components/AiChat.tsx
import { bhasm } from "../lib/bhasm-client";

function AiChat({ project }: { project: Project }) {
  const handleSubmit = async (instruction: string) => {
    const proposal = await bhasm.proposePatch(instruction, project);
    if (proposal.patch.ops.length > 0) {
      // Show diff view, let user accept/reject
      setShowDiff(proposal);
    }
  };

  return <ChatInput onSubmit={handleSubmit} />;
}
```

## Demo Flow (1.5 minutes)

1. **Open** a sample `.cl` file in the editor
2. **Type** "make the hero title bigger and red" in the AI chat
3. **See** PatchOps generated → click "Accept"
4. **Preview** updates with the new title style
5. **Click** "Review" → see 2-3 issues with fix buttons
6. **Accept** a fix → preview updates
7. **Ctrl+Z** → undo works (reversibility demo)

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Ollama not running" | Start Ollama app or run `ollama serve` |
| "Model not found" | Run `ollama pull qwen2.5:3b` |
| "Invalid JSON from model" | Bhasm retries once automatically. If still failing, check model health. |
| "Node not found" | The model may invent nodeIds. Check `project.pages` for valid IDs. |
| Slow responses | qwen2.5:3b takes 1-3s on GPU. Ensure Ollama is using GPU, not CPU. |
