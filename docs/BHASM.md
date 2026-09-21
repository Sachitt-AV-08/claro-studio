# BHASM — the internal AI extension

BHASM is CLARO Studio's AI brain, built as an **opencode-style internal extension**:
an agent definition, a typed tool registry, and a skill layer, wired into a streaming
chat loop. It "lives internally" and is also inspectable from an **Extensions** view.

## 1. The agent (`src/bhasm/agent.ts`)

One flexible agent, modes selected by chips:

| Mode | Behavior |
|---|---|
| `ask` | Answer a question about the project / language |
| `code` | Propose a PatchOp batch to reach a described change |
| `review` | Run the deterministic reviewer + LLM feedback |
| `explain-comment` | Seed from a `#` comment (double-click) |

Shape (opencode `Agent` model): `{ id, name, description, model, tools, systemPrompt }`.

## 2. Tools (`src/bhasm/tools/`)

Typed tool registry, opencode tool-call shape `{ id, description, inputSchema, run }`:

| Tool | What it does |
|---|---|
| `propose_patch` | Natural language → PatchOp list. Dry-runs `validateOps` + `applyOps` before returning. |
| `describe_patch` | Intended snippet vs current source → minimal PatchOp list |
| `review` | Deterministic rules (`contracts/src/review.ts`) + LLM pass; findings link to corrective ops |
| `apply_patch` | Reversible apply; pushes to the store undo stack |
| `comment_to_idea` | Gather the project's `#` comments (the "brain") |
| `inspect_node` | Return the schema + current props for a `nodeId` |
| `export_project` | Render the current project to a single-file offline HTML |

Tool calls render as **chat chips**; clicking one opens the Stitch diff.

## 3. Skills (`src/bhasm/skills/`)

Markdown knowledge packs, auto-attached to every BHASM call:

- **`claro-language`** — the language reference, generated **in-memory from `contracts/dsl-schema.ts`**
  (the single source of truth) so it can never drift: all elements + props/types/units/enums/
  synonyms, the PatchOp vocabulary, and worked examples.
- **`ideas`** — runtime skill rebuilt from the project's `#` comments on every edit.
- User skills — real `.md` files in `apps/ide/skills/` (opencode SKILL.md style); users can drop
  in new ones. `claro-language` and `ideas` are auto-provided on top.

## 4. Runtime (`src/bhasm/runtime.ts`)

`BhasmRuntime`: streaming agent loop (Ollama `qwen2.5:3b`), skill attachment, tool dispatch,
health gating. On failure it degrades gracefully to `{ ok:false, reason }`.

## 5. Language correctness guarantee

Every `propose_patch` / `describe_patch` output is dry-run through `validateOps` + `applyOps`.
On failure the validation message is fed back to the model for **one grammar-grounded retry**,
then it fails soft. Qwen therefore knows Claro's real grammar, not a prompt hint.

## 6. UI

- **BHASM panel** — bottom docked, resizable/collapsible. Header `⚡ BHASM · local` (model
  name hidden). Mode picker (Ask / Code / Review / Explain-comment). Streaming markdown thread.
  Prompt bar (Enter to send, Shift+Enter for newline).
- **Extensions view** — activity-bar item showing the BHASM extension: agent, its tools, and
  loaded skills (`claro-language` visible/inspectable).

## 7. Non-negotiables

- Reversibility is sacred: BHASM only ever proposes PatchOps, never raw AST writes.
- Offline only: Ollama `http://localhost:11434`, model `qwen2.5:3b`. No cloud APIs.
- Strict JSON output from the model; coerce through the contracts. Never trust types.