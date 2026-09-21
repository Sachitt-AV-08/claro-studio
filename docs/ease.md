# Claro Ease-of-Use Contract

Thesis: **Claro is the language where the code and the interface are the same
program — so easy that a beginner builds a real screen in five minutes, and the
AI edits the program, not the text, all offline.**

Claro borrows Python's good sense, reads like English, and removes the
overwhelming.

## The 7 promises (measurable, demo-able)

| # | Promise | Proof |
|---|---|---|
| E1 | **Learn in 5 minutes** | One-screen cheat sheet: 2 statement shapes + ~20 elements + ~24 keys. Printed. |
| E2 | **First screen in 60 seconds** | Type `page Home {}`, a heading, a button → preview is live immediately. |
| E3 | **Zero syntax anxiety** | Whitespace-insensitive; scrambled or AI output still parses. Unknowns degrade to warnings. |
| E4 | **No new concepts for components** | A component uses the exact syntax of usage. One concept, two places. |
| E5 | **Reversible = zero tool-switching** | Drag preview → source updates; edit source → preview updates; undo both ways. |
| E6 | **The AI speaks plain English** | "Make the CTA centered and compact" → structured diff → accept. No prompt engineering. |
| E7 | **Quiet surface** | Whole vocabulary fits one screen; advanced props hide until needed. |

## Anti-overwhelm engine

| Lever | How Claro applies it |
|---|---|
| Vocabulary budget | Hard caps: ~20 built-ins, ~24 property keys, one cheat sheet. Additions displace existing items. |
| Progressive disclosure | Beginner sees 6 everyday keys; advanced props collapse behind "Show more". |
| No dunder / no rare paths | No `__private__`, no gotchas, no "five ways to do it"; one spelling enforced. |
| Always explainable | Deterministic model → IDE answers "why does this look like this?" pointing at the exact prop. |
| The AI is the tour guide | Type English → structured diff → accept; AI teaches the language by doing. |

## Story: Python sense + English reading

English-affordance grammar (tolerant mode, stripped at generation):

- Ignorable articles — `the button "Go"`, `an image ""` — accepted and normalized away.
- Ignorable conjunctions — `gap: 24 and align: center` — accepted and stripped.

```claro
page Home {
  section Hero {
    layout: stack
    gap: 24
    padding: 48
    heading "Build differently"
    text "A local-first development environment."
    button primary "Get Started"
  }
}
```

Reads as: *"Page Home. Section Hero. Stack its contents, gap twenty-four, padding
forty-eight. A heading that says Build differently, a text, a primary button that
says Get Started."*

## Rules (governance, locked)

1. Every keyword is a common English word, one spelling only.
2. Defaults make every element render sensibly with zero props.
3. Vocabulary caps above; additions displace existing items.
4. Any unknown input degrades to a warning, never a crash.
5. "Why is this here?" is always one click away.
6. Reading the `.cl` source aloud makes sense to a non-programmer.

## Rationale for keeping braces (not Python indentation)

Python makes indentation meaningful; we deliberately don't. Whitespace-insensitive
parsing is what keeps AI-generated and human-scrambled files unbreakable. The
formatter makes it *look* Python-indented; it just never *depends* on it.