# Claro Language — Complete Terms

Every keyword, element, property, value type, unit, enum, synonym, effect,
animation, and patch op in the Claro language (v1). Automatically derived from
the single source of truth: `contracts/src/dsl-schema.ts` and
`contracts/src/patches.ts`.

- Extension: `.cl`
- Parsing is whitespace-insensitive (indentation is never meaning)
- Every node carries a stable `nodeId`
- Unknown input degrades to diagnostics, never errors

---

## 1. Keywords (syntax)

| Term | Shape | Use |
|---|---|---|
| `page` | `page Home { ... }` | Declare a full page; roots the preview. Exactly one per file in v1 |
| `component` | `component Hero(title: string, cta: string) { ... }` | Reusable composable with typed params |
| `@param` | `heading @title` | Reference a component param in a body (component bodies only) |
| `name` | `button primary "Go"` | Give an element a named id segment (unique in scope; else auto `:n`) |
| `// note` | any line | Line comment |
| `# note` | any line | Idea comment (double-click to seed BHASM explain-comment); note `#hex…` is a color, not a comment |

---

## 2. Elements (27 built-ins + components)

Elements take a body `{ ... }`; elements marked **(text)** also take a quoted
string: `heading "Hello"`. Any element may carry a name.

| Element | Kind | Purpose |
|---|---|---|
| `page` | container | Screen root (one per file) |
| `section` | container | Semantic page region |
| `container` | container | Generic block; any props |
| `row` | layout | Horizontal flex layout (synonym: `flex`) |
| `column` | layout | Vertical flex layout (canonical synonym: `stack`) |
| `stack` | layout | Vertical flex layout |
| `grid` | layout | CSS grid layout (`columns` / `rows`) |
| `overlay` | layout | Stacked / absolutely positioned layer |
| `heading` **(text)** | content | Title text (`level` 1–6) |
| `text` **(text)** | content | Body text (synonyms: `line`, `para`) |
| `button` **(text)** | control | Clickable button (`variant: primary ghost outline`) — visual only, no events in v1 |
| `card` | container | Surface card |
| `navbar` | container | Top navigation bar |
| `input` | control | Text field (`label`, `placeholder`, `type`) — no data binding |
| `textarea` | control | Multi-line input |
| `form` | container | Form container (no submit behavior in v1) |
| `modal` | container | Dialog surface (`title`) — no open/close in v1 |
| `image` | media | `src`/`alt` image — URL strings only |
| `spacer` | spacing | Flexible blank space (`size`) |
| `divider` | media | Horizontal rule (synonym: `separator`) |
| `badge` **(text)** | control | Status pill (`variant: neutral accent success warn danger`) |
| *(component name)* | instance | User-defined instance (registered via `component`) |

---

## 3. Properties (by group)

### 3.1 Layout / spacing / size

| Property | Kind | Values | Applies to |
|---|---|---|---|
| `layout` | enum | `stack` `row` `grid` `overlay` | any element body |
| `gap` | number | `px` `em` `rem` | stack, row, column, grid, section, container, card, form, modal, overlay |
| `padding` | tuple | 1 / 2 / 4 values (`all` | `y x` | `top right bottom left`) | most containers |
| `margin` | tuple | 1 / 2 / 4 values | most containers |
| `width` | number | `px` `%` `fr` `em` `rem` | sized elements |
| `height` | number | `px` `%` `em` `rem` | sized elements |
| `columns` | list | `[1fr 2fr 1fr]` | grid |
| `rows` | list | `[1fr 2fr 1fr]` | grid |
| `size` | number | `px` | spacer |

### 3.2 Alignment

| Property | Kind | Values | Cross-axis / main-axis |
|---|---|---|---|
| `align` | enum | `start` `center` `end` `stretch` | cross-axis of a row/stack |
| `justify` | enum | `start` `center` `end` `between` `around` | main-axis distribution |

### 3.3 Text (text elements)

| Property | Kind | Values |
|---|---|---|
| `color` | color | any color |
| `size` | number | `px` `em` `rem` |
| `weight` | enum | `regular` `medium` `semibold` `bold` |
| `align` | enum | `left` `center` `right` `justify` |
| `family` | string | any font-family string (system fonts only) |
| `level` | number | 1–6 (`heading` only) |

### 3.4 Style / surface

| Property | Kind | Values |
|---|---|---|
| `background` | color | any color (gradients via `effect` only) |
| `color` | color | text/border fill |
| `border` | tuple | `width style color` (no per-side control) |
| `radius` | number | `px` `%` (uniform corners) |
| `shadow` | tuple | `x y blur color` (single shadow only) |
| `opacity` | number | 0–1 (default `1`) |

### 3.5 Effects

| Property | Kind | Values |
|---|---|---|
| `effect` | enum | `aurora` `particles` `glow` `noise` |
| `animation` | enum | `fade-in` `float` `pulse` `rise` |

### 3.6 Behavior (element-specific)

| Property | On | Values / notes |
|---|---|---|
| `variant` | button, badge | button: `primary` `ghost` `outline`; badge: `neutral` `accent` `success` `warn` `danger` |
| `level` | heading | `1`–`6` |
| `label` | input, textarea | string |
| `placeholder` | input, textarea | string |
| `type` | input | `text` `password` `email` `number` |
| `title` | modal | string |
| `action` | form | string |
| `src` / `alt` | image | string (URL / accessibility text) |

---

## 4. Value types

| Type | Written as | Used for | Note |
|---|---|---|---|
| `number` | `24`, `50%`, `2fr`, `1.5em` | sizes, spacing | no arithmetic |
| `string` | `"text"` or `'text'` | content, labels, `src` | escapes `\"` `\\` `\n` `\t` |
| `color` | `#aabbcc`, `#abc`, `rgb()`, `rgba()`, named | all color props | no HSL |
| `boolean` | `true` / `false` | toggles | reserved words |
| `enum` | bare word | layout / align / effects / weight | schema-checked values only |
| `ref` | `@paramName` | component params | component bodies only |
| `list` | `[1fr 2fr 1fr]` | grid templates | flattened values |

### Units

`px` `%` `fr` `em` `rem`

---

## 5. Named enums (flat list)

```
start        center        end           stretch
between      around        left          right
justify      regular       medium        semibold
bold         primary       ghost         outline
neutral      accent        success       warn
danger       text          password      email
number       aurora        particles     glow
noise        fade-in       float         pulse
rise
```

## 6. Synonyms (aliases → canonical)

| Alias | Canonical |
|---|---|
| `column` | `stack` |
| `flex` | `row` |
| `line` | `text` |
| `para` | `text` |
| `separator` | `divider` |

## 7. Effects & animations

- Effects: `aurora` `particles` `glow` `noise`
- Animations: `fade-in` `float` `pulse` `rise`

---

## 8. PatchOps (structured edit operations)

| Op | Shape | Purpose |
|---|---|---|
| `set_property` | `{ op, target, property, value }` | set or override a property on a node |
| `clear_property` | `{ op, target, property }` | remove a property (falls back to schema default) |
| `set_text` | `{ op, target, value }` | change element text content (heading/text/button/badge) |
| `add_element` | `{ op, parent, element, position, ref? }` | insert a child element |
| `remove_element` | `{ op, target }` | remove a node and its subtree |
| `move_element` | `{ op, target, position, ref? }` | reorder a node within its parent |
| `set_layout` | `{ op, target, layout }` | switch layout stack/row/grid/overlay |
| `set_effects` | `{ op, target, effect }` | apply a decorative effect |

---

## 9. Full vocabulary in one line

```
page component section container row column stack grid overlay heading text
button card navbar input textarea form modal image spacer divider badge
layout gap padding margin width height columns rows size align justify color
background border radius shadow opacity weight family level variant label
placeholder type title action src alt effect animation
stack flex line para separator @ref
start center end stretch between around left right justify regular medium
semibold bold primary ghost outline neutral accent success warn danger
text password email number aurora particles glow noise fade-in float pulse rise
px % fr em rem true false @paramName
set_property clear_property set_text add_element remove_element move_element
set_layout set_effects
```

---

*Generated for the VIT "Hack the Horizon 3.0" submission from
`contracts/src/dsl-schema.ts` (ELEMENTS, SYNONYMS, enums, effects, patch ops).*