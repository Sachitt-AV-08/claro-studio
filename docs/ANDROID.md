# Android (Jetpack Compose) Codegen — Agent 4

Claro -> Android is the mirror of the HTML renderer: same DSF traversal of the
A4 AST, emitted as a single self-contained `.kt` file that compiles against
Jetpack Compose.

## Entry point

```ts
import { buildAndroid, androidSignature } from "@project/android";

const kt: string = buildAndroid(project);         // full Kotlin file
const sig: string = androidSignature(project);     // structural fingerprint
```

`buildAndroid` is deterministic and idempotent for the same AST: the page and
every component become top-level `@Composable fun`s, and component instances
render through a generated `componentRegistry` so names resolve.

## Element -> Composable mapping

See `packages/android/src/contract.ts` (`COMPOSE_ELEMENT`). Built-ins:

| Claro element | Compose composable | Notes |
| --- | --- | --- |
| `page`        | `Column`            | root screen wrapper |
| `section`     | `Box`               | semantic region |
| `container`   | `Column`            | generic block |
| `row` / `flex`| `Row`               | horizontal flex |
| `stack` / `column` | `Column`       | vertical flex |
| `grid`        | `Column`            | `columns` accepted, layout is vertical stack |
| `overlay`     | `Box`               | stacked layer |
| `heading`     | `Text`              | `fontWeight = SemiBold` default; `fontSize` in `.sp` |
| `text`        | `Text`              | body text; `.sp` for `size` |
| `button`      | `Button { Text(..) }` | label becomes inner `Text` |
| `card`        | `Box`               | `modifier` carries padding/background/radius |
| `navbar`      | `Row`               | top bar container |
| `input`       | `Text`              | `label`/`type` accepted but rendered inline (no Material `OutlinedTextField` in single-file subset) |
| `textarea`    | `Box`               | surface pass-through |
| `form`        | `Column`            | layout container |
| `modal`       | `Box`               | dialog surface (no Overlay in subset) |
| `image`       | `Image`             | `src`/`alt` accepted; no painter in subset |
| `spacer`      | `Spacer`            | `size` ignored (flexible blank space) |
| `divider`     | `Divider`           | `color`/`thickness` not yet wired |
| `badge`       | `Text`              | pill as styled text |
| unknown       | `Box`               | pass-through surface |

## Prop -> Kotlin mapping

| Prop | Kotlin emitted |
| --- | --- |
| `padding: 16`        | `Modifier.padding(16.dp)` |
| `width`/`height`     | `Modifier.width(...)` / `.height(...)` (units: `dp`; `%` -> `doubleToDp`; `em`/`rem` -> `sp`) |
| `background: #rgb`   | `Modifier.background(Color(0xFFRRGGBB))` (`#abc` -> `#aabbcc`) |
| `radius: 8`          | `.clip(RoundedCornerShape(8.dp))` |
| `gap: 24`            | `Arrangement.spacedBy(24.dp)` (row/stack only) |
| `color` (text)       | `color = Color(...)` |
| `size` (text)        | `fontSize = 24.sp` |
| `weight` (text)      | `fontWeight = FontWeight.SemiBold` |
| `align` (text)       | `textAlign = TextAlign.Center` (`left`->`Start`, `right`->`End`), etc. |
| `variant: primary` on button | accepted, currently no visual change |
| `effect`/`animation` | accepted, no Kotlin effect emitted |

Named CSS colors resolve through `COLOR_NAMES` (`red`, `blue`, `transparent`, …);
hex, 3-digit hex, and `rgb()/rgba()` are supported. Unresolvable colors are
omitted rather than emitting invalid Kotlin.

## Structure signature (`androidSignature`)

A DFS fingerprint in the same shape emitted by the HTML renderer
(`apps/ide/src/export/renderHtml.ts`): `Kind:text(children…)`. Text-bearing
leaves contribute `Text:hello`; Button folds its inner label as `Button:Get Started`.
Used to assert codegen/preview structural parity in
`packages/android/test/android.test.ts` without depending on exact Kotlin style.

## Scripts

```sh
npm run test --workspace=@project/android      # vitest (parity + structure)
npm run typecheck --workspace=@project/android  # tsc --noEmit
```

## Roadmap (not in this session)

- `OutlinedTextField` for `input`, `AlertDialog` for `modal`, `Icon`/painter for `image`.
- `Screen` scaffolding: explicit `Modifier.fillMaxSize()`, `Arrangement`/spacer for `grid` columns.
- Wire the generated `.kt` into the IDE export menu (`apps/ide/src/export`) so a
  "Generate Android" button outputs `screen.kt` next to `index.html`.
- Optional adb/gradle pipeline on device (see `packages/android/README.md`).