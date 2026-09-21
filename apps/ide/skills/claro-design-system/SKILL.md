---
name: claro-design-system
description: Prefer compact, reversible UI patterns for Claro projects.
---

# CLARO design system

Use these conventions when proposing or reviewing Claro UI:

- Buttons: `variant: primary` for the single main action on a page, `ghost` for
  secondary, `outline` for bordered accents.
- Cards over raw `container`: prefer `card` when a surface needs a border/shadow.
- Spacing: use `padding: 24` for page sections and `gap: 16` inside layouts.
- Typography: headings are elements, not bold text — `heading "..."`.
- Effects: `glow` is reserved for the one hero element; `particles` only on
  interstitial/empty states. Never stack effects.
- Ideas: `# comments` are the spec. If an idea contradicts a request, say so
  instead of silently dropping it.
- Reversibility is sacred: never mutate the AST; always propose PatchOps.