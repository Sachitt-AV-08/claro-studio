import type { PropValue } from "./ast.js";

/**
 * Claro element & property schema. Drives: parser validation, autocomplete,
 * the inspector UI, and AI structured patching. Agent 4 registers components here.
 */

export type PropGroup =
  | "layout"
  | "spacing"
  | "size"
  | "align"
  | "text"
  | "style"
  | "effects"
  | "behavior"
  | "grid";

export type PropKind =
  | "number"
  | "string"
  | "color"
  | "boolean"
  | "enum"
  | "tuple"
  | "list";

export interface PropSchema {
  kind: PropKind;
  /** allowed units for numbers */
  unit?: Array<"px" | "%" | "fr" | "em" | "rem">;
  /** allowed enum values */
  values?: string[];
  group: PropGroup;
  required?: boolean;
  default?: PropValue;
  doc?: string;
}

export interface ElementSchema {
  type: string;
  doc: string;
  /** element renders its string content (heading "x") */
  textContent?: boolean;
  /** component instance (defined in .cl component files) */
  isComponent?: boolean;
  props: Record<string, PropSchema>;
}

export const LAYOUTS = ["stack", "row", "grid", "overlay"] as const;
export const SYNONYMS: Record<string, string> = {
  column: "stack",
  flex: "row",
  line: "text",
  para: "text",
  separator: "divider",
};

export const ALIGN_VALUES = ["start", "center", "end", "stretch"] as const;
export const JUSTIFY_VALUES = ["start", "center", "end", "between", "around"] as const;
export const TEXT_ALIGN_VALUES = ["left", "center", "right", "justify"] as const;
export const FONT_WEIGHT_VALUES = ["regular", "medium", "semibold", "bold"] as const;

export const EFFECTS = ["aurora", "particles", "glow", "noise"] as const;
export const ANIMATIONS = ["fade-in", "float", "pulse", "rise"] as const;

const SPACING: Record<string, PropSchema> = {
  gap: { kind: "number", unit: ["px", "em", "rem"], group: "spacing", doc: "space between children" },
  padding: { kind: "tuple", group: "spacing", doc: "1-4 values: all | y x | top right bottom left" },
  margin: { kind: "tuple", group: "spacing", doc: "1-4 values: all | y x | top right bottom left" },
};

const SIZING: Record<string, PropSchema> = {
  width: { kind: "number", unit: ["px", "%", "fr", "em", "rem"], group: "size" },
  height: { kind: "number", unit: ["px", "%", "em", "rem"], group: "size" },
};

const ALIGN: Record<string, PropSchema> = {
  align: { kind: "enum", values: [...ALIGN_VALUES], group: "align", doc: "cross-axis of row/stack" },
  justify: { kind: "enum", values: [...JUSTIFY_VALUES], group: "align", doc: "main-axis distribution" },
};

const TEXT: Record<string, PropSchema> = {
  color: { kind: "color", group: "text" },
  size: { kind: "number", unit: ["px", "em", "rem"], group: "text" },
  weight: { kind: "enum", values: [...FONT_WEIGHT_VALUES], group: "text" },
  align: { kind: "enum", values: [...TEXT_ALIGN_VALUES], group: "text" },
  family: { kind: "string", group: "text" },
};

const SURFACE: Record<string, PropSchema> = {
  background: { kind: "color", group: "style" },
  color: { kind: "color", group: "style" },
  border: { kind: "tuple", group: "style", doc: "width style color" },
  radius: { kind: "number", unit: ["px", "%"], group: "style" },
  shadow: { kind: "tuple", group: "style", doc: "x y blur color" },
  opacity: { kind: "number", unit: [], group: "style", default: { t: "num", v: 1 } },
};

const EFFECTS_SCHEMA: Record<string, PropSchema> = {
  effect: { kind: "enum", values: [...EFFECTS], group: "effects" },
  animation: { kind: "enum", values: [...ANIMATIONS], group: "effects" },
};

const CONTAINER: ElementSchema = {
  type: "container",
  doc: "generic block; any props",
  props: { ...SPACING, ...SIZING, ...ALIGN, ...SURFACE, ...EFFECTS_SCHEMA },
};

export const ELEMENTS: Record<string, ElementSchema> = {
  page: {
    type: "page",
    doc: "a full page; roots the preview",
    props: { background: SURFACE.background, ...SPACING },
  },
  section: {
    type: "section",
    doc: "semantic page region",
    props: { ...SPACING, ...SIZING, ...ALIGN, ...SURFACE, ...EFFECTS_SCHEMA },
  },
  container: CONTAINER,
  row: {
    type: "row",
    doc: "horizontal flex layout (synonym: flex)",
    props: { ...SPACING, ...SIZING, ...ALIGN, ...SURFACE, gap: SPACING.gap },
  },
  column: {
    type: "column",
    doc: "vertical flex layout (canonical synonym: stack)",
    props: { ...SPACING, ...SIZING, ...ALIGN, ...SURFACE, gap: SPACING.gap },
  },
  stack: {
    type: "stack",
    doc: "vertical flex layout",
    props: { ...SPACING, ...SIZING, ...ALIGN, ...SURFACE },
  },
  grid: {
    type: "grid",
    doc: "CSS grid layout",
    props: {
      ...SPACING,
      ...SIZING,
      columns: { kind: "list", group: "grid", doc: "[1fr 2fr 1fr]" },
      rows: { kind: "list", group: "grid" },
      ...ALIGN,
    },
  },
  overlay: {
    type: "overlay",
    doc: "stacked / absolutely positioned layer",
    props: { ...SPACING, ...SIZING, ...ALIGN, ...SURFACE },
  },
  heading: {
    type: "heading",
    doc: "heading text",
    textContent: true,
    props: { ...TEXT, level: { kind: "number", unit: [], group: "text" } },
  },
  text: {
    type: "text",
    doc: "body text",
    textContent: true,
    props: TEXT,
  },
  button: {
    type: "button",
    doc: "clickable button",
    textContent: true,
    props: { ...SURFACE, ...EFFECTS_SCHEMA, variant: { kind: "enum", values: ["primary", "ghost", "outline"], group: "behavior" } },
  },
  card: {
    type: "card",
    doc: "surface card",
    props: { ...SPACING, ...SIZING, ...SURFACE, ...EFFECTS_SCHEMA },
  },
  navbar: {
    type: "navbar",
    doc: "top navigation bar",
    props: { ...SPACING, ...ALIGN, ...SURFACE },
  },
  input: {
    type: "input",
    doc: "text input",
    props: {
      label: { kind: "string", group: "behavior" },
      placeholder: { kind: "string", group: "behavior" },
      type: { kind: "enum", values: ["text", "password", "email", "number"], group: "behavior" },
      ...SURFACE,
    },
  },
  textarea: {
    type: "textarea",
    doc: "multi-line input",
    props: { label: { kind: "string", group: "behavior" }, placeholder: { kind: "string", group: "behavior" }, ...SURFACE },
  },
  form: {
    type: "form",
    doc: "form container",
    props: { ...SPACING, ...ALIGN, action: { kind: "string", group: "behavior" } },
  },
  modal: {
    type: "modal",
    doc: "modal overlay dialog",
    props: { ...SPACING, ...SIZING, ...SURFACE, title: { kind: "string", group: "behavior" } },
  },
  image: {
    type: "image",
    doc: "image element",
    props: {
      src: { kind: "string", group: "behavior" },
      alt: { kind: "string", group: "behavior" },
      ...SIZING,
      radius: SURFACE.radius,
    },
  },
  spacer: { type: "spacer", doc: "flexible blank space", props: { size: { kind: "number", unit: ["px"], group: "size" } } },
  divider: { type: "divider", doc: "horizontal rule", props: { color: SURFACE.color, thickness: { kind: "number", unit: ["px"], group: "size" } } },
  badge: {
    type: "badge",
    doc: "small status pill",
    textContent: true,
    props: { ...SURFACE, variant: { kind: "enum", values: ["neutral", "accent", "success", "warn", "danger"], group: "behavior" } },
  },
};

export function schemaFor(type: string): ElementSchema | undefined {
  return ELEMENTS[type] ?? ELEMENTS[SYNONYMS[type]];
}

export function canonicalType(type: string): string {
  return SYNONYMS[type] ?? type;
}

/** All known element type names (built-ins + synonyms). */
export function allTypeNames(): string[] {
  const set = new Set(Object.keys(ELEMENTS));
  for (const t of Object.values(SYNONYMS)) set.add(t);
  return [...set];
}