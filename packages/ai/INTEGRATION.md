# Agent 3 → Agent 2 Integration Guide

## Quick Start

```typescript
import { createClaroAi } from "@project/ai";

const ai = createClaroAi(); // uses qwen2.5:3b by default

// Check if model is available
const h = await ai.health();
if (!h.ok) {
  console.error("Ollama not running or model missing");
  return;
}

// Natural language → Patch
const proposal = await ai.proposePatch("make the hero title red", project);
console.log(proposal.summary); // "Changed hero title color to red"
console.log(proposal.patch.ops); // validated PatchOp[]

// Apply patches
const result = ai.applyPatch(project.pages, proposal.patch.ops);
if (result.ok) {
  // Update your AST with the modified pages
  project.pages = result.ops ? project.pages : project.pages;
  // result.inverse contains the undo ops
}
```

## API Reference

### `createClaroAi(options?)`

Creates the AI client. Returns `ClaroAi`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | `"qwen2.5:3b"` | Ollama model name |
| `provider` | `ModelProvider` | Ollama | Custom backend (for testing) |

### `ai.health()`

Check if Ollama is running and the model is loaded.

```typescript
const h = await ai.health();
// h.ok: boolean
// h.models: [{ name: "qwen2.5:3b", size: 1840 }]
// h.error?: string
```

### `ai.proposePatch(instruction, project)`

Natural language → validated PatchOps.

```typescript
const proposal = await ai.proposePatch("make the hero title bigger and red", project);
// proposal.workflow: "modify"
// proposal.summary: "Made hero title larger and red"
// proposal.patch: { summary, ops: PatchOp[] }
// proposal.rationale?: string
```

**Latency:** ~1-3s on qwen2.5:3b (8GB VRAM)

### `ai.describePatch(intendedSource, currentSource, project)`

Diff → minimal PatchOps.

```typescript
const proposal = await ai.describePatch(
  'heading hero { size: 32, color: #ef4444 }',
  'heading hero { size: 24, color: #000000 }',
  project,
);
```

### `ai.review(project, includeLlm?)`

Rules engine + optional LLM feedback.

```typescript
const result = await ai.review(project, true);
// result.issues: ReviewIssue[]
// result.modelSourced: boolean

for (const issue of result.issues) {
  console.log(`${issue.severity}: ${issue.message}`);
  if (issue.fix) {
    // User can click "Fix" to apply issue.fix.ops
  }
}
```

### `ai.applyPatch(pages, ops)`

Apply PatchOps to AST. Returns `{ ok, ops, inverse }`.

```typescript
const result = ai.applyPatch(project.pages, proposal.patch.ops);
if (result.ok) {
  // result.ops = the applied ops
  // result.inverse = undo ops (for Ctrl+Z)
}
```

## Building ProjectContext

The AI needs context about the current project. Build it from your parsed AST:

```typescript
import { buildContext } from "@project/ai";

const ctx = buildContext(project);
// ctx.file: "current.cl"
// ctx.astJson: JSON of pages
// ctx.idMap: { "home.hero.title": { range, nodeId } }
// ctx.diagnostics: parser errors
// ctx.schemaHint: element/prop summary
```

## Applying Patches (End-to-End Flow)

```typescript
// 1. User types instruction
const instruction = "make the hero title red";

// 2. AI generates PatchOps
const proposal = await ai.proposePatch(instruction, project);

// 3. Validate (already done by AI layer, but double-check)
import { validateOps } from "@project/contracts";
const valid = validateOps(proposal.patch.ops);
if (!valid.ok) {
  console.error("Invalid ops:", valid.error);
  return;
}

// 4. Apply to AST
const result = ai.applyPatch(project.pages, proposal.patch.ops);
if (!result.ok) {
  console.error("Apply failed:", result.error);
  return;
}

// 5. Update editor state
// (your Zustand store or whatever state management you use)
updateProject({ ...project, pages: result.ok ? project.pages : project.pages });

// 6. Store inverse for undo
undoStack.push(result.inverse);
```

## IPC Channels (Renderer ↔ Main Process)

If running AI in the main process (recommended for Electron):

| Channel | Args | Returns |
|---------|------|---------|
| `ai:status` | `{}` | `Rpc<ModelStatus>` |
| `ai:complete` | `{ system, user }` | `Rpc<string>` |
| `ai:propose` | `{ workflow, instruction, ctx }` | `Rpc<PatchProposal>` |
| `ai:review` | `{ project }` | `Rpc<ReviewResult>` |

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
| "Invalid JSON from model" | The AI layer retries once automatically. If still failing, check model health. |
| "Node not found" | The model may invent nodeIds. Check `project.pages` for valid IDs. |
| Slow responses | qwen2.5:3b takes 1-3s on GPU. Ensure Ollama is using GPU, not CPU. |
