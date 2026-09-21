# Claro Roadmap

## Current build — M0 → M5 (active, locked)

- **M0 Icon & brand** — wire the app icon (assets/icon.png → exe via electron-builder,
  BrowserWindow icon, favicon). DONE.
- **M1 Icons + chrome** — official Codicons (no emoji), tab strip + multi-file model,
  VS Code explorer, activity bar (incl. Tasks / Stitch / Extensions), status bar groups.
- **M2 Preview + AI foundation** — phone-frame preview + device toggle; real streaming AI
  (drop `apps/ide/src/ai/localAi.ts` stub, wire `packages/ai`); health gate.
- **M3 BHASM** — internal opencode-style extension: agent, typed tools, skills
  (`claro-language` generated from `contracts/dsl-schema.ts` + ideas + user `.md`),
  runtime; bottom docked panel; Extensions view. See `docs/BHASM.md`.
- **M4 Stitch + Todos + differentiators** — Stitch primary view (goal bar, Source A|B |
  Destination seam, provenance via PatchOps); BHASM execution todos + persisted team
  Tasks panel; comment → Bhasm; command palette + Problems panel; Export (single-file
  HTML + "Package app"); multi-language files.
- **M5 Delivery** — palette alignment, clean rebuild (`npm run dist`), on-screen
  verification, commit to `agent-2/ide`.

Per-agent briefs: `docs/AGENT-PROMPTS.txt`.

## T1 — the demo (24h, locked P0, shipped)

- Reversible CODE ↔ AST ↔ PREVIEW loop
- Components, inspector, undo, palette
- Local AI structured patches, reviewer, offline proof
- Tolerant parser, canonical formatter, patch engine (`packages/dsl`)

## T2 — the backtrack pass (after T1, if time)

Priority order (user-approved direction):

1. **Design tokens / themes** — `theme` block, token refs in props
2. **Responsive variants** — `@breakpoint` sections on elements
3. **Named slots** — `slot "header"` in components
4. **Exports → Jetpack Compose + HTML** (Architecture path B shine)
5. **6 extra built-ins** — `link`, `footer`, `tabs`, `toggle`, `progress`, `chip`
6. **Preview-only events** — `on tap →` visual feedback only
7. **Multi-file `use`** — `use "./hero.cl"`

## T3 — post-hackathon pitch ("the modern alternative")

Claro's counter-argument to "rich language = hard language": AI-native, typed,
local-first, reversible. Any computation layer would grow as a *backend* behavior
language — never inside the UI tree.

---

## CodeRabbit-style in-IDE review (user request)

### Goal
Once a version of the IDE is ready, build a feature equivalent to **CodeRabbit**:
autonomous AI code review, but for general languages (and for Claro itself),
running **inside the IDE** on the local model — with the same "network offline
is fine" story as everything else.

### What CodeRabbit does (target behavior)
- Reviews diffs/PRs automatically against rules: correctness, security, bugs, style
- Posts line-comments explaining each finding, with severity + suggestions
- Approves/closes loops with minimal human effort

### Claro's in-IDE equivalent (`@project/ai` + IDE)
1. **On-diff review** — when a file is saved or a drag-edit lands, the reviewer
   (`contracts/src/review.ts`) runs deterministic rules first, then the local LLM.
2. **Rules-first, LLM-second** — deterministic findings (contrast, a11y labels,
   absolute-layout overuse, unknown props) are instant and offline; the LLM adds
   natural-language findings only where deterministic rules can't reach.
3. **Inline comments with fix ops** — every finding links to a `PatchOp` batch
   (deterministic) or a proposed rewrite (LLM); "Fix" applies it reversibly.
4. **Severity + auto-approve** — clear "errors vs suggestions"; auto-appliable
   fixes (e.g. missing alt) can be applied with one click.
5. **Multi-file context** — components known from their definition file; no
   repo-wide crawl needed for v1.

### Scope note
This is deliberately **T3 tech**, not a hackathon must — but the reviewers'
shape (`contracts/src/review.ts` rules → findings → fixes) is built today so the
IDE has the plumbing from day one. Agent 3 (`agent-3/ai`) builds the LLM glue;
Agent 2 exposes the inline comment UI.