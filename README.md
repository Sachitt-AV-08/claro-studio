# CLARO Workbench

> **The interface you design *is* the code — and every change is reversible.**

[Local-First](#what-it-is) · [Offline AI](#claro-decisions) · [Reversible by Design](#patchops) · No Cloud · No Telemetry · Windows-first

CLARO Workbench is a desktop IDE (Electron + Monaco) for **Claro** (`.cl`) — a tiny, declarative UI language. You build screens as a mix of source and live preview; the AI brain edits the design model, not scrambled text. Because every mutation is a validated, reversible **PatchOp**, undo/redo comes free — and an AI assistant can safely propose entire features.

---

## The problem it solves

Today's UI tooling makes you pick sides:

- **Code-first** (React/Compose/HTML) — powerful, but no live visual editing; every AI edit *mutates text* and nobody can safely undo a "smart" refactor.
- **Designer-first** (Figma/Framer) — great canvas, but the output is throwaway screens, and "codegen" fights your real app.
- **AI copilots** — fast and impressive, but they write into your files with no reversibility, no structure, and often no idea about your codebase.

CLARO Workbench takes the third option and makes it safe:

- one **structured language** where code ↔ AST ↔ preview round-trip deterministically;
- every AI action is an *auditable, undoable PatchOp batch* — the editor and the model speak the same vocabulary;
- the entire AI stack runs on **your machine** (Ollama `qwen2.5:3b`), with a **local decision layer** that routes, classifies, and *blocks* risky edits before they ever land.

## The 60-second demo

1. Type a screen with Claro source on the left, live phone preview on the right.
2. Open **BHASM** (bottom dock), pick **code**, and type `make the hero title blue and larger`.
3. Watch the streaming reply, the tool-call chips, and the guardrail decision — then open **Stitch** and see the reversible seam: *Source A / Destination / Source B*.
4. Undo it all for free. Then ask BHASM to **review** the project and fix what it flags — every finding links to a corrective PatchOp.

## Core ideas

| Term | Meaning |
|---|---|
| **Claro** | A small, typed, declarative UI language (`.cl` files). Deterministic CODE ↔ AST ↔ PREVIEW round-tripping. |
| **PatchOp** | The reversible edit vocabulary: `set_property`, `set_text`, `add_element`, `remove_element`, `move_element`, `set_layout`, `set_effects`, `clear_property`. The AI only ever *proposes* PatchOps — it never mutates your files directly. |
| **Claro Decisions** | A local AI decision layer (Ollama `qwen2.5:3b`) sitting between your prompt and the tools: it **routes** work to the right tool, **classifies** ideas, and **guardrails** every patch — a confident "don't do this" blocks the proposal. Thresholds: act `0.90`, ask `0.60`. |
| **BHASM** | The internal AI extension/agent. Four modes — **ask · code · review · explain-comment** — each with one assigned job (see below). Every action it takes is a tool call surfaced as a chat chip. |
| **Stitch** | The primary merge/review view (inspired by Google Stitch): a **goal bar** on top, **Source A \| Source B \| Destination** side by side, and a seam where you stitch fragments into your working document as reversible, provenance-tracked PatchOps. |
| **Comment-as-idea** | `#` comments are the project's "brain": they survive in the AST, feed BHASM's context, and double-click to seed a BHASM explain/execute run. |
| **Terminal** | A real ConPTY terminal inside the IDE (`claro:term:*`), with a Git toolbar. |

## BHASM modes — each one actually does its job

| Mode | What it really does |
|---|---|
| **ask** | Grounded conversational answers about the current project and the Claro language — cites `nodeId`s, schema, and `#` ideas. |
| **code** | Turns a natural-language change into a validated PatchOp proposal (dry-runs through the patch engine), surfaced in Stitch; a confident decision-guardrail reject blocks it with a reason. |
| **review** | Runs the deterministic rules engine **plus** an LLM pass over the whole project and renders a severity-coded report — each finding carries its corrective ops. |
| **explain-comment** | Seeds from the `#` idea you double-clicked. Explains it first; only if the decision layer is *confident* the idea demands a change does it propose ops. |
| *(chat gate)* | `hi` / `thanks` / `what can you do?` are answered conversationally and **never** become PatchOps. |

## Claro Decisions (what makes this hack-special)

Raw LLM output is fast, impressive, and dangerous. Everything BHASM does is gated by a small local model that answers structured questions with a confidence:

- **Router** — which tool does this request want? (chip: `route · propose_patch · 0.94`)
- **Guardrail** — is this patch batch safe? A **confident reject** (probability ≥ act) blocks the proposal and prints the reason. Low-confidence or unavailable model → the deterministic path just runs. The engine can only *get better*, never worse.
- **Classifier** — is a `#` idea an explanation or a build task?
- **Conversational gate** — a plain greeting is chat, not a coding task.

Every decision degrades gracefully: if Ollama is off, BHASM still works with deterministic heuristics and honest fallbacks.

## Features

**Implemented**
- Reversible CODE ↔ AST ↔ PREVIEW loop — components, inspector, undo/redo, palette
- Tolerant Claro parser, canonical formatter, validated patch engine (`packages/dsl`)
- Local AI: structured intent→patch, describe→patch, reviewer — all on Ollama `qwen2.5:3b` (`packages/ai`)
- Project-graph AI grounding: a **Graphify MCP sidecar** (`claro:mcp:*`) indexes the code graph so BHASM answers use real structure, not just the current file
- Dark workbench: custom title bar, activity bar, explorer, preview, status bar, Monaco with a full featured source editor
- Multi-file workspace (native open/save, dynamic tabs), live JSON **Settings**, **Git** status/terminal toolbar, **debug** breakpoints, **Build → EXE** installer, single-file offline HTML export
- Packaged Windows app: `apps/ide/release/win-unpacked/CLARO Workbench.exe`

**Planned / next**
- Semantic scoring (`nomic-embed-text` embeddings + cosine) for graph results and decision confidence
- `semantic_search` over the project graph via the MCP sidecar
- Multi-language editing (`.cl` + `js/ts/py/json/html/md…`)

## Quickstart

**Prerequisites**
- Node.js 18+
- [Ollama](https://ollama.com) with the model pulled: `ollama pull qwen2.5:3b`
- Windows (the packaged build targets Windows)

```bash
npm install
cd apps/ide
npm run dev          # dev mode — Vite renderer + Electron main
npm run dist         # build + package win-unpacked EXE
```

The packaged app lives at `apps/ide/release/win-unpacked/CLARO Workbench.exe`.
The Electron binary is copied into `apps/ide/node_modules/electron` — don't let a fresh `npm install` remove it.

## Architecture

```
contracts/            types + validation (single source of truth: dsl-schema.ts)
packages/dsl/         tokenizer, parser, formatter, patch engine
packages/ai/          Ollama client, intent→patch, describe→patch, review, decision engine
                      (router / guardrail / classifier ladder + JSON repair)
packages/android/     Claro → Android (Compose/XML) codegen
apps/ide/             the Electron IDE — BHASM runtime, decision adapter, graphify MCP sidecar,
                      Stitch, Terminal, Settings, packaging
docs/                 CONTRACTS.md, BHASM.md, reference.md, roadmap.md, …
```

The AI stack is explicit: create a *structured* intent, validate the resulting ops against the schema, and present them to the human as an undoable proposal. The project graph (sidecar MCP server) gives the model local "codebase memory."

## Testing — what the suite signifies

`npx vitest run` (122 tests) proves the layers, top to bottom:

- **DSL round-trip** — parser → formatter → parser stays canonical; the patch engine applies and undoes.
- **Intent → patch** — natural language → valid, schema-safe PatchOps (rule-based + LLM e2e against a real Ollama).
- **Decision layer** — routing picks the right tool, a confident reject *blocks*, a low-confidence reject does **not**, and the chat gate sends `hi` to chat while `make the hero red` goes to code.
- **Modes** — each BHASM mode is wired to its assigned job (code proposes, review reports, explain-comment explains unless confident).
- **Graph / MCP contract** — renderer ↔ main-sidecar IPC shape.

Type health is continuous: renderer + Electron main both run `tsc --noEmit` clean.

## Documentation

- `docs/CONTRACTS.md` — the frozen cross-package architecture
- `docs/BHASM.md` — the agent & tool surface
- `docs/reference.md` / `docs/roadmap.md` — language reference and plan
- `docs/AGENT-PROMPTS.txt` — per-agent build briefs

## Team

| Lane | Focus | Task |
|---|---|---|
| **Agent 1** | DSL engine | parser, formatter, patch model |
| **Agent 2** | IDE (this lane) | workbench, BHASM runtime, decisions, graphify sidecar |
| **Agent 3** | AI / Ollama | clients, intents, review, decision engine |
| **Agent 4** | Android | Claro → Compose/XML codegen |