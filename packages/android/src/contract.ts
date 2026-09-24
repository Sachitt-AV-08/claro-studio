import type { Project, DslNode, PropValue } from "@project/contracts";

/**
 * Claro DslProject -> Android (Jetpack Compose) mapping table.
 * One element type -> one primary Composable; props -> modifiers/params.
 * Consumes exactly the contracts AST; never extends the language.
 *
 * Reference: docs/ANDROID.md, reference.md (element list).
 */

/** Primary Compose composable for each built-in Claro element. */
export const COMPOSE_ELEMENT: Record<string, string> = {
  page: "Column",
  section: "Box",
  container: "Column",
  row: "Row", // & flex
  stack: "Column", // & column
  grid: "Column",
  overlay: "Box",
  heading: "Text",
  text: "Text",
  button: "Button",
  card: "Box",
  navbar: "Row",
  input: "Text",
  textarea: "Box",
  form: "Column",
  modal: "Box",
  image: "Image",
  spacer: "Spacer",
  divider: "Divider",
  badge: "Text",
};

/** Claro elements that render their string content as text. */
export const TEXT_CONTENT: ReadonlySet<string> = new Set([
  "text",
  "heading",
  "button",
  "badge",
]);

/** Layouts rendered as a flex column. */
export const COLUMN_LAYOUTS: ReadonlySet<string> = new Set([
  "page",
  "stack",
  "column",
  "container",
  "grid",
  "form",
]);

/** Layouts rendered as a flex row. */
export const ROW_LAYOUTS: ReadonlySet<string> = new Set(["row", "flex", "navbar"]);

/** Elements rendered as a plain Box (stacked/surface). */
export const BOX_LAYOUTS: ReadonlySet<string> = new Set([
  "section",
  "overlay",
  "card",
  "textarea",
  "modal",
]);

/** Named colors (CSS) -> Android Color() with fixed values. */
export const COLOR_NAMES: Record<string, string> = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#F44336",
  green: "#4CAF50",
  blue: "#2196F3",
  yellow: "#FFEB3B",
  orange: "#FF9800",
  purple: "#9C27B0",
  pink: "#E91E63",
  gray: "#9E9E9E",
  grey: "#9E9E9E",
  cyan: "#00BCD4",
  magenta: "#E91E63",
  brown: "#795548",
  transparent: "Transparent",
  teal: "#009688",
  navy: "#1A237E",
  gold: "#FFD700",
  silver: "#C0C0C0",
  maroon: "#800000",
  olive: "#808000",
  lime: "#CDDC39",
  aqua: "#00FFFF",
};

export interface ComposeProp {
  /** the Kotlin form emitted for this prop ("" means omitted) */
  kotlin: string;
  /** text/color extracted mainly for the structure signature */
  text?: string;
  color?: string;
}

export interface ComposeNode {
  kind: string;
  text: string;
  /** args/kwargs in emit order (e.g. `modifier = Modifier.padding(16.dp)`) */
  args: string[];
  children: ComposeNode[];
  /** element name from the .cl source (for named slots in docs) */
  name?: string;
}

/** Unit-aware number literal: `24` -> `24.dp`, `48` -> `48.dp`, `%`/`fr` unresolvable -> "" */
export function unitDp(v: number, unit?: string): string {
  switch (unit) {
    case "%":
    case "fr":
      return "";
    case "em":
    case "rem":
      return `${v}sp`;
    default:
      return `${v}.dp`;
  }
}

/** Single value of `padding: 8` or first of a tuple. */
export function firstNum(p: Record<string, PropValue>, key: string): number | null {
  const v = p[key];
  if (!v) return null;
  if (v.t === "num") return v.v;
  if (v.t === "tuple" && v.v[0]?.t === "num") return (v.v[0] as { v: number }).v;
  return null;
}

/** Best-effort numeric (with optional unit) from a prop. */
export function numOf(p: Record<string, PropValue>, key: string): { v: number; unit?: string } | null {
  const v = p[key];
  if (v?.t === "num") return { v: v.v, unit: v.unit };
  return null;
}

export function enumOf(p: Record<string, PropValue>, key: string): string | null {
  const v = p[key];
  return v?.t === "enum" ? v.v : null;
}

export function strOf(p: Record<string, PropValue>, key: string): string | null {
  const v = p[key];
  return v?.t === "str" ? v.v : v?.t === "color" ? v.v : null;
}

/** `#aabbcc`, `#abc`, `rgb(1,2,3)`, or a named color -> Compose `Color(0xFFAABBCC)`. */
export function colorLiteral(v: string): string {
  const raw = v.trim();
  let hex = "";
  const m = raw.match(/^#([0-9a-f]{6})$/i);
  if (m) hex = m[1];
  else {
    const m3 = raw.match(/^#([0-9a-f]{3})$/i);
    if (m3) hex = m3[1].split("").map((c) => c + c).join("");
  }
  if (hex) return `Color(0xFF${hex.toUpperCase()})`;
  if (raw === "transparent") return "Color.Transparent";
  const rgb = raw.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, "0"));
    return `Color(0xFF${(r + g + b).toUpperCase()})`;
  }
  const named = COLOR_NAMES[raw.toLowerCase()];
  return named ? colorLiteral(named) : "";
}