# Claro Language Reference (v1)

Claro is a tiny, typed, reversibly-editable UI language. The code and the
interface are the same program: editing source updates the preview, and editing
the preview updates the source (through patch ops, see `contracts/src/patches.ts`).

- Extension: `.cl`
- Parsing: whitespace-insensitive (indentation is display, never meaning)
- Every node carries a stable `nodeId` (see `contracts/src/ids.ts`)
- Unknown input degrades to diagnostics — the parser never fails hard

## 1. Structure

| Command | Shape | Use | Limitation |
|---|---|---|---|
| `page` | `page Home { ... }` | Declare a full page; roots the preview | Exactly one page per file in v1 |
| `component` | `component Hero(title: string, cta: string) { ... }` | Reusable composable | Params only; no state/logic |
| `@param` | `heading @title` | Reference a param in a body | Component bodies only |
| `name` | `button primary "Go"` | Give an element a name (id segment) | Must be unique in scope (auto `:n` otherwise) |
| comment | `// note` and `# note` | Inline explanation | Preserved on format; `#hex…` is a color, not a comment |

Example:

```claro
page Home {
  section Hero {
    layout: stack
    gap: 24
    padding: 48
    heading "Build differently"
    button primary "Get Started"
  }
}
```

## 2. Elements

All elements take a body `{ ... }`; elements marked **(text)** also take a
quoted string: `heading "Hello"`. Every element can carry a name: `button primary`.

| Element | Use | Limitation |
|---|---|---|
| `page` | Screen root | One instance |
| `section` | Semantic region | Grouping only |
| `container` | Generic block | Styling only |
| `row` | Horizontal layout (`flex` ≡) | No wrap control |
| `column` / `stack` | Vertical layout | Synonym normalizes to `stack` |
| `grid` | `columns` / `rows` layout | No named areas |
| `overlay` | Stacked / absolutely-positioned layer | Reviewer flags overuse |
| `heading` **(text)** | Title text | Text only |
| `text` **(text)** | Body text (`line`/`para` ≡) | Single font run per element |
| `button` **(text)** | Clickable control | Visual only; no events in v1 |
| `card` | Surface container | No behavior |
| `navbar` | Top navigation bar | No collapse logic |
| `input` | Text field | No data binding |
| `textarea` | Multi-line input | Same as input |
| `form` | Form container | No submit behavior in v1 |
| `modal` | Dialog surface | No open/close in v1 |
| `image` | `src`/`alt` image | URL strings only |
| `spacer` | Flexible blank space | Fixed or flexible only |
| `divider` | Horizontal rule (`separator` ≡) | Fixed orientation |
| `badge` **(text)** | Status pill | Text only |
| *(component)* | User-defined instance | Registered by Agent 4 |

## 3. Layout properties

| Property | Values | Use | Limitation |
|---|---|---|---|
| `layout` | `stack` `row` `grid` `overlay` | Choose child arrangement | Set per element |
| `gap` | number (+`px`/`em`/`rem`) | Space between siblings | Uniform gap only |
| `align` | `start` `center` `end` `stretch` | Cross-axis | No `baseline` |
| `justify` | `start` `center` `end` `between` `around` | Main-axis distribution | No `evenly` |
| `width` / `height` | number, `%`, `fr`, `em`/`rem` | Sizing | No min/max, no aspect-ratio |
| `columns` / `rows` | `[1fr 2fr 1fr]` | Grid template | No named areas |
| `padding` / `margin` | 1, 2, or 4 values | Spacing shorthand | No negative values |

## 4. Style properties

| Property | Values | Use | Limitation |
|---|---|---|---|
| `background` | color | Fill | Gradients via `effect` only |
| `color` | color | Text/border fill | Inherits unless set |
| `border` | `width style color` | Outline | No per-side control |
| `radius` | number (+`px`/`%`) | Rounded corners | Uniform corners |
| `shadow` | `x y blur color` | Depth | Single shadow only |
| `opacity` | number | Fade | 0–1 |
| `size` | number | Font size | text elements only |
| `weight` | `regular` `medium` `semibold` `bold` | Font weight | Preset weights |
| `family` | string | Font family | System fonts only |
| `effect` | `aurora` `particles` `glow` `noise` | Decorative layer | Fixed params; GPU cost flagged |
| `animation` | `fade-in` `float` `pulse` `rise` | Motion | Fixed timings |

## 5. Behavior properties (element-specific)

| Property | On | Use | Limitation |
|---|---|---|---|
| `variant` | button / badge | Presets (button: `primary` `ghost` `outline`; badge: `neutral` `accent` `success` `warn` `danger`) | Preset styles, not arbitrary |
| `level` | heading | 1–6 | Display only |
| `label` `placeholder` `type` | input / textarea | Form affordances | No validation/binding |
| `value` `action` | form / input | Input hints | No submit logic |
| `title` | modal | Dialog header | No open/close |
| `src` `alt` | image | Image source + alt text | URL strings |

## 6. Value types

| Type | Written as | Use | Limitation |
|---|---|---|---|
| number | `24`, `50%`, `2fr`, `1.5em` | sizes/spacing | No arithmetic |
| string | `"text"` (or `'text'`) | content/labels | Escapes: `\"` `\\` `\n` `\t` |
| color | `#aabbcc`, `#abc`, `rgb()`, `rgba()`, named | all color props | No HSL |
| boolean | `true` / `false` | toggles | Reserved |
| enum | bare word (schema-checked) | layout/align/effects | Declared values only |
| ref | `@param` | component params | Component bodies only |
| list | `[1fr 2fr 1fr]` | grid templates | Flattened values |

## 7. Language limitations (scope guardrail)

1. No logic — no loops, conditionals, variables, math, state, or I/O. Components are pure.
2. No events in v1 — buttons/forms/modals are visual placeholders.
3. No data binding — live data belongs to Path B (Android/real code).
4. One file per page in v1 (multi-file `use` is a roadmap item).
5. No raw CSS escape hatch — everything goes through the typed vocabulary.
6. Schema-typed only — unknown values parse + warn; exotic designs need a component.
7. Reduced flexibility by design — exact-CSS layouts (min/max, per-side borders, keyframes) are out of scope.