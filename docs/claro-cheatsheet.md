# Claro in 60 seconds — one-page cheat-sheet

> Print this. Hand it to a judge. Then watch them type a screen in Claro.
> The parser is **forgiving**: case-insensitive, `a/an/the` and `and/then` are
> ignored, single quotes work, semicolons optional. Unknown input never errors —
> it turns into a "did you mean" diagnostic.

## 🔤 Step 1 — write a page

```cl
page Home {                    // one page per file (.cl)
    section hero {
        heading "Any screen you can imagine"
        button "Try Claro" { variant: primary }
    }
}
```

That's it. Type it on the left → it renders live on the right. No build step.

## 🧱 Step 2 — the 21 elements

`page` `section` `container` · three layout families (below) ·
`heading` `text` `button` `badge` `card` `navbar` `input` `textarea` `form`
`modal` `image` `spacer` `divider`

**Layouts** (change with one word): `stack` (vertical) · `row` (horizontal) ·
`grid` (columns `[1fr 2fr 1fr]`) · `overlay` (absolutely positioned)

**Synonyms you can also use:** `column`=stack · `flex`=row · `line`/`para`=text ·
`separator`=divider

## 🎨 Step 3 — style with props

| Prop | Example values |
|---|---|
| size / gap / padding / margin | `24` `48px` `1.5em` `50%` |
| color / background | `#87c1ff` `rgb(135, 193, 255)` `red` |
| align / justify | `start` `center` `end` `stretch` · `between` `around` |
| weight | `regular` `medium` `semibold` `bold` |
| width / height / radius | `360` `50%` `16` |
| border / shadow / opacity | `1 solid #333` · `0 8 24 rgba(0,0,0,.4)` · `0.8` |
| effect | `aurora` `particles` `glow` `noise` |
| animation | `fade-in` `float` `pulse` `rise` |

## 🔄 Step 4 — reuse & rebuild

**Reuse:** `component Hero(title: string, cta: string) { heading @title button @cta }`,
then `Hero "Hi" "Go"` anywhere. **Edit:** click any element → change props in the
inspector → it writes back to source. **Comment as idea:** `# make the hero pop`
double-click → BHASM executes it as a suggestion.

## ✨ Why this is special

- Source ⇄ preview round-trip **deterministically** — no codegen mismatches.
- Every AI edit is a **PatchOp** (`set_property`, `set_text`, `add_element`,
  `remove_element`, `move_element`, `set_layout`, `set_effects`, `clear_property`)
  → **undo/redo is free**.
- Everything runs **on-device** (Ollama `qwen2.5:3b`) — no cloud, no telemetry.
- A local **Claro Gate** decides which edits even need the model; easy ones are
  answered by embeddings (~ms), so the 3B model sleeps most of the time.

---

*Full reference & terms: `docs/claro-terms.md` · language schema: `contracts/src/dsl-schema.ts`*