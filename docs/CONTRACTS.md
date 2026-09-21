# CLARO — Architecture Contract (frozen)

> Read this before writing code. "The code and the interface are the same program."

## Product
Local-first, AI-native IDE for the **Claro** (`.cl`) reversible UI language, plus real native Android development.

- Path A: Claro DSL — deterministic `CODE ↔ AST/IR ↔ PREVIEW` round-trip, semantic bidirectional editing.
- Path B: native Android — Kotlin/Java/XML/Gradle project browse, edit, build, run.

## Language (Claro, extension `.cl`)
Two statement shapes only, whitespace-insensitive, brace-blocked:
- property: `key: value` — `gap: 24`, `layout: stack`, `color: #1e1e24`
- element: `type [name] ["text"] { ... }` — `button primary "Get Started" { radius: 12 }`

Pages: `page Home { ... }`. Components: `component Hero(title: string, cta: string) { ... }` with `@param` refs.

Built-in elements (contracts/src/dsl-schema.ts): page, section, container, row, column/stack, grid, overlay, heading, text, button, card, navbar, input, textarea, form, modal, image, spacer, divider, badge. Components registered by Agent 4.

Property vocabulary (~24 keys): layout | gap padding margin | width height | align justify | color size weight (text) | background border radius shadow opacity | effect (aurora|particles|glow|noise) | animation (fade-in|float|pulse|rise) | columns rows | label placeholder type value.

Shorthand: `padding: 24` = all, `24 12` = y/x, `24 12 8 4` = t/r/b/l; bare `24` = 24px. Synonyms: column→stack, flex→row, line/para→text, separator→divider (canonicalized on generate).

## AST (contracts/src/ast.ts)
```
DslNode { kind: "page"|"component"|"element", nodeId, type, name?, props, params?, children, source }
PropValue = num|str|color|bool|enum|tuple|list|ref   (t-tagged unions)
Project = { meta, pages, components, diagnostics }
```
Deterministic: `parse(source)` and `generate(ast)` are pure; `parse(generate(parse(x)))` is stable.

## Element identity (contracts/src/ids.ts)
`nodeId` = dotted path of `(name ?? type)`, `:n` disambiguates sibling repeats, root scope prefix.
Pure function of AST → same source, same ids. Parser emits `id → sourceRange` map.
Preview DOM nodes MUST carry `data-node-id`. Selection preserved by re-resolving nodeId; stale renders discarded via monotonic `revision`.

## Patch operations (contracts/src/patches.ts)
All mutations reduce to: `set_property`, `set_text`, `add_element`, `remove_element`, `move_element`, `set_layout`, `set_effects`. Applier (in @project/dsl) returns inverses for undo. `validateOps` runs on every batch — from drag, inspector, AI, reviewer Fix.

## Data flow
```
buffer → (debounce 120ms) parse → AST → preview render
preview drag → build semantic op (snap 4px; NEVER raw pixels)
  → apply ops → generate → replace buffer (undo-grouped) → reparse → re-render
AI: prompt + ProjectContext → local model (JSON-constrained) → PatchProposal
  → validateOps → diff view → accept/reject → deterministic applier
```
Single source of truth = the editor buffer. Every mutation path updates it; undo = unified Ctrl+Z.

## Local AI (contracts/src/ai.ts)
`ModelProvider` (Ollama first; `qwen2.5:3b`, `format:"json"`); stub provider for TESTS ONLY (never in the app). LLM proposes → validator decides. `AiClient.propose()` → `PatchProposal`. Reviewer: deterministic static rules first, quiet LLM pass optional. Status/metrics: contracts/src/metrics.ts.

## IPC (contracts/src/api.ts)
Typed channels (fs, ai, android, gradle, metrics, term). Always `{ ok, data } | { ok:false, error }`. Browser fallback shadows the same interface over HTTP/WS.

## Repo layout
```
contracts/            shared types (frozen; Agent 1 signs off on changes)
packages/dsl          Agent 1: tokenizer, parser, generator, patch applier, ids
packages/ai           Agent 3: model adapter, structured patcher, reviewer, metrics
packages/android      Agent 4: project scanner, gradle/adb wrapper, error parser
packages/components   Agent 4: .cl components + effects
apps/ide              Agent 2: Electron + Vite + React + Monaco renderer
scripts/verify.mjs    gate: workspaces typecheck + tests
```

## Branches & rules
`main` (always green) + `agent-1/dsl` + `agent-2/ide` + `agent-3/ai` + `agent-4/android-components`.
No direct commits across territories. PRs merge at coordination windows; contract changes need Agent 1 sign-off.

## P0 gates
IDE shell · Claro parser/AST/generator · code→preview · preview→code · stable ids · undo/redo ·
local AI adapter + one working model · AI structured patching · basic reviewer · offline op · metrics · polish.

## Rules of the road
Prefer working code over abstractions. Never fake success states. Deterministic over LLM rewrites.
Keep the core functional after every major integration. Small PRs. Minimize dependencies.