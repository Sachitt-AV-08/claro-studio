# CLARO judges' demo — 3-minute script

> Run this on the packed EXE with Ollama running (`qwen2.5:3b` + `nomic-embed-text`).
> Press **Ctrl+Shift+J** to open the Judging Tour — it drives the whole flow.
> Screen: Explorer (source) + Preview (rendered) + status/metrics strip visible.

---

## 0:00 — Cold open (≈15s)

> Don't start with a blank screen. The moment judges sit down: **Ctrl+Shift+J → Step 1 (See it)**.

"Welcome to **Claro** — a developer tool that writes and edits UI screens with you.
Everything you'll see runs **on this machine, fully offline**."

## 0:15 — Step 1 · See it (≈25s)

Click **"1 · See it"** — the Aurora product screen loads instantly.

"That's a beginner-friendly language: 21 building blocks, plain words, no build
step. Type on the left, it renders on the right, **live**. This screen is the
Claro source there — every line drove everything you see: the aurora effect,
the hero, the pricing grid, the form."

> Judges can type `badge` / `divider` / `button` live if they want proof. Keep moving
> if they don't — the tour keeps the rhythm.

## 0:40 — Step 2 · Edit it (≈50s)

Click **"2 · Edit it"** — BHASM opens with the edit prompt pre-filled:

> *"Make the hero title bigger and accent-colored, then add a badge under it."*

"Now the interesting part. This prompt goes through our **Claro Decisions** layer.
A tiny local **embedding gate** asks: *did this even need the 3B model?* No — so the
answer came back in milliseconds, **without the model waking up**.

Watch the metrics strip: **epoch 1 · X% on-device · 0/0 decisions skipped 3B**.
That's a real, counted number on this machine.

Click **Suggest**. The model proposes edits as structured **PatchOps** — no
regenerating files, no codegen drift. Click **Apply** and watch the preview update."

> Orchestrate Ollama: first edit warms the model. If a judge tilts at the pause,
> that's your line: *"first call loads the 3B model into RAM — every later call reuses it."*

## 1:30 — Step 3 · Step back (≈20s)

Click **"3 · Step back"** — Stitch opens, one keystroke unwinds the edit.

"Because every edit is a reversible **PatchOp**, **undo is free**. No guess-and-check
reconstruction — the tool rewinds exactly the operations it made. Collaborators can
open any prior state, and the whole session is a real inspectable log, not a black box."

## 1:50 — Edge AI is the whole point (≈40s)

"As an AI team, the pitch is honesty: we used a **3B on-device model** instead of
pretending everyone runs 70B. The trick is that most requests are simple, so a local
embedding **gate** answers fast and cheap — the heavy model wakes only when it matters.
That means:

- **Private by design** — source and edits never leave the machine.
- **Free undo** — AI is a structured editor, not a chat box.
- **Ships small** — a ~100 MB installer and two local models run on a laptop."

## 2:30 — Q&A cushion (30s)

- **"What AI is under it?"** — Ollama `qwen2.5:3b` for decisions + `nomic-embed-text`
  for the gate. No cloud.
- **"What was hard?"** — making a forgiving parser (never errors, "did you mean"
  diagnostics) and turning AI edits into reversible ops.
- **"Could it generate code?"** — yes, `export_project` → source/android templates
  (see Stitch bottom panel). Kotlin generation already exists in `packages/android`.

---

## Offline / fallback plan

| Failure | Fallback |
|---|---|
| Ollama not running | Demo still works: load/edit are shown as typed DSL + live preview; Stitch undo still runs; skip the "gate" beat |
| Embed model slow to load | Keep going — it caches after first call; lean on the "first call loads RAM" line |
| No HDMI / no mic | Walk the phone-camera, or just run the tour; the one-pager cheat-sheet carries it |
| Judges want a repo tour | Show `docs/claro-terms.md` (full reference) at the table |

---

*Tour wiring: `apps/ide/src/tour/` · demo screen: `demoScreen.ts` · cheat-sheet: `docs/claro-cheatsheet.md`*