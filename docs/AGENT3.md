# AGENT 3 — MASTER PROMPT (AI / Ollama)

You are **Agent 3** on the CLARO Studio hackathon team (VIT HTH 3.0). Your lane is the
local, offline AI brain. Read EVERYTHING below before writing code.

## The project in one paragraph

CLARO is a tiny reversibility-first UI language (`.cl`) plus an AI-native IDE that gives
"Python's good sense, reads like English, removes the overwhelming." Code and interface
are the same program. The IDE shows live, bidirectional editing: edit code OR edit the
preview — every change is expressed as a **PatchOp**, which is reversible (undo/redo is
free). The whole AI stack runs **locally, offline** on Ollama (`qwen2.5:3b`). We are
hackathon-scoped: v1 has NO control flow, NO logic — only structure, style, and content.

## Your deliverables (priority order)

1. `packages/ai/src/ollama.ts` — a minimal Ollama client: HTTP `POST /api/chat` to
   `http://localhost:11434`, non-streaming + streaming, with a 30s timeout, and a
   `health()` check. No external deps beyond what the monorepo already has (node fetch).
2. `packages/ai/src/intent.ts` — **natural-language → PatchOp list**. Given the current
   `DslProject` (contracts AST) and a user sentence ("make the hero title bigger and
   red"), emit ONLY a list of valid PatchOps. The IDE preview applies them, so AI never
   mutates AST directly.
3. `packages/ai/src/toPatch.ts` — **describe → minimal patch**. Given a target text
   snippet (what the user wants to end up with) and the current DSL source, produce the
   smallest PatchOp list that would reach it. Frame it as: "find the diff between
   intended structure and current structure, express as ops". (Data-rich example lives
   in docs/reference.md and `contracts/src/patches.ts`.)
4. `packages/ai/src/review.ts` — **CodeRabbit-style reviewer**, but in-IDE:
   - Rules engine first (deterministic, local): too-long section, missing required
     props (button needs text), unknown prop/type, duplicate ids, layout props on
     text-only nodes. Rules live in `contracts/src/review.ts` — the SHAPE is already
     defined there; implement filling it for the DSL.
   - LLM pass second: ask `qwen2.5:3b` for a short paragraph of feedback.
   - Every finding links to a corrective PatchOp the user can accept/reject.

## Hard rules

- **Reversibility is sacred.** AI output is ALWAYS PatchOps, never raw AST writes.
  Every op you suggest must be accepted by `validateOps`/`applyOps` in
  `contracts/src/patches.ts` + `packages/dsl/src/patches.ts`. If the model returns
  garbage, retry once against the grammar, then fail softly (return `{ ok:false,
  reason }`).
- **Offline only.** No cloud APIs. The laptop demo runs with no internet. `OLLAMA_HOST`
  is `http://localhost:11434`; model `qwen2.5:3b` (already verified, fits 8GB VRAM).
- **Strict JSON output.** Always request `json` format from the model and validate the
  parsed shape. Never trust the model's types; coerce through the contracts.
- **Small and boring first.** Hackathon. Do ONE perfect happy-path flow end-to-end
  before adding breadth. Judge: does a judge-typed sentence produce a correct preview
  change they can undo?
- **Tone:** the language is EASY for humans. Your prompts to the model must reflect
  this — no jargon leaking into user-facing text.

## Repo layout & conventions

- Branch: **`agent-3/ai`** (created). Work there, push, open a PR to `main`.
- Monorepo (npm workspaces): `contracts/` (types + validation — read first),
  `packages/dsl/` (tokenizer/parser/formatter/patch engine — READ ONLY mostly; Agent 1
  owns it), `packages/ai/` (YOU), `packages/ide/`, `packages/android-components/`.
- Everything typed strict TS. Use `contracts/src/*` types verbatim.
- Run `npm run typecheck` from root before pushing. Push PRs, don't force.
- Your files go in `packages/ai/src/`, tests in `packages/ai/test/*.test.ts`
  (vitest); keep the stub test script working: `vitest run --passWithNoTests`.
- Demo budget is ~1.5 min for your three flows (intent→patch, describe→patch,
  review). Rehearse them.

## Understanding the AST (the 4 things you need)

Read `contracts/src/ast.ts`, `contracts/src/dsl-schema.ts`, `contracts/src/patches.ts`,
`contracts/src/ids.ts` FIRST. Key facts:

- `DslProject` = `{ pages: Page[]; components: Component[] }`. Page has `children`.
- Elements are nested `DslNode`s; each has `nodeId`, `type`, optional `name`, optional
  `text`, `props` (PropTuple), `children`. Components have `params` and bodies with
  `@ref` text/props.
- Patch op vocabulary: `set_property`, `set_text`, `add_element`, `remove_element`,
  `move_element`, `set_layout`, `set_effects`, and `clear_property` (newest).
- The engine applies ops in `packages/dsl/src/patches.ts`. Use `applyOps` to dry-run
  your suggested patch before returning it — if `ok:false`, revise.
- `nodeId` is a stable path (`home.hero.title`) — ops target it, not indices.

## What your first PR must show

A working, demoable loop, exercised by tests that don't hit the network:
1. `health()` reports the model + VRAM footprint.
2. A canned sentence maps to a correct PatchOp list; `applyOps` accepts it.
3. `review()` flags a deliberately-broken project (missing button text) via the rules
   engine, with a suggested corrective op.
4. Everything typed against contracts, `npm run typecheck` green.

## Getting unstuck

- If the DSL engine PR (Agent 1) hasn't merged yet, read the packages on your branch
  when they land; until then, stub against `contracts` types and note assumptions in
  the PR.
- Ask for the one-page cheat sheet (docs/reference.md) — it lists every element, prop,
  and the 7 global limitations. Keep the model anchored to that list.
- NEVER invent new props or types. ~20 elements, ~24 props, that's the world.