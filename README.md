# CLARO Workbench

Local-first, AI-native development environment for **Claro** (`.cl`) — a tiny, reversible UI language.

> "The code and the interface are the same program."

## What it is

CLARO Workbench is a desktop IDE (Electron + Monaco) for building UIs in Claro.
Edit the source or edit the preview — every change is expressed as a **PatchOp**, which is
reversible, so **undo/redo is free**. The whole thing runs offline: the AI brain is a local
Ollama model (`qwen2.5:3b`), no cloud, no telemetry.

## Terms

| Term | Meaning |
|---|---|
| **Claro** | A small, typed, declarative UI language. `.cl` files. Deterministic CODE ↔ AST ↔ PREVIEW round-tripping. |
| **PatchOp** | The reversible edit vocabulary (`set_property`, `set_text`, `add_element`, `remove_element`, `move_element`, `set_layout`, `set_effects`, `clear_property`). The AI never mutates the AST directly — it only ever proposes PatchOps. |
| **BHASM** | The internal, opencode-style AI extension/agent. One agent with modes: **Ask / Code / Review / Explain-comment**. Runs locally, knows the Claro language, and every action it takes is a tool call surfaced as a chat chip. |
| **Stitch** | The primary merge view (inspired by Google Stitch): a **goal bar** on top, **Source A \| Source B \| Destination** side-by-side, and a seam where you stitch fragments from either source into your working document. Every stitched hunk is a reversible PatchOp with provenance. |
| **Comment-as-idea** | `#` comments are the project's "brain". They survive in the AST, feed BHASM's context, and double-click to seed a BHASM ask. |
| **Todos** | Two layers: BHASM execution todos per instruction (opencode-style pending → in_progress → done) and a persisted team Tasks panel. |
| **Extensions** | The internal extension surface — BHASM's agent, tools, and loaded skills (including the auto-generated `claro-language` knowledge pack) are inspectable. |

## Features

### Implemented
- Reversible CODE ↔ AST ↔ PREVIEW loop (components, inspector, undo, palette)
- Tolerant parser, canonical formatter, patch engine (`packages/dsl`)
- Local AI structured patches, reviewer, offline proof (`packages/ai`, Ollama `qwen2.5:3b`)
- Dark IDE workbench with custom title bar, activity bar, explorer, preview, status bar
- Packaged Windows runnable: `apps/ide/release/win-unpacked/CLARO Workbench.exe`

### Planned (this build)
1. **Icons & chrome** — official Codicons, no emoji; tab strip; VS Code explorer; status bar groups
2. **Preview + AI foundation** — phone-frame preview + device toggle; real streaming AI wired in
3. **BHASM** — bottom docked panel, mode picker, streaming markdown, tool-call chips, Extensions view, language-grounded
4. **Stitch** — dedicated primary view with goal bar + A/B/Destination seam
5. **Comment → Bhasm** — `#` token, gutter badge, double-click seeds BHASM
6. **Export** — single-file offline HTML + "Package app" (spawns `npm run dist`)
7. **Multi-language** — `.cl` (reversible + AI) plus `js/ts/py/json/html/md…` (highlight + BHASM assist)
8. **Todos** — BHASM execution lists + persisted team board
9. **Delivery** — palette alignment, clean rebuild, on-screen verification

## Architecture

```
contracts/            types + validation (single source of truth: dsl-schema.ts)
packages/dsl/         tokenizer, parser, formatter, patch engine  (Agent 1)
packages/ai/          Ollama client, intent→patch, describe→patch, review  (Agent 3)
packages/android/     Claro → Android (Compose/XML) codegen  (Agent 4)
apps/ide/             the Electron IDE  (Agent 2)
docs/                 CONTRACTS.md, AGENT3.md, reference.md, roadmap.md, BHASM.md
```

See `docs/CONTRACTS.md` for the frozen architecture shared by all agents.

## Quickstart

```bash
npm install
cd apps/ide
npm run dev          # dev mode (localhost:5173 + Electron)
npm run dist         # build + package win-unpacked exe
```

The packaged app lives at `apps/ide/release/win-unpacked/CLARO Workbench.exe`.
The Electron binary is copied into `apps/ide/node_modules/electron` — don't let a fresh
`npm install` remove it.

## Team

- **Agent 1** — DSL engine (`agent-1/dsl`)
- **Agent 2** — IDE workbench (`agent-2/ide`, this lane)
- **Agent 3** — AI / Ollama (`agent-3/ai`)
- **Agent 4** — Android components (`agent-4/android-components`)

Per-agent task briefs: `docs/AGENT-PROMPTS.txt`.