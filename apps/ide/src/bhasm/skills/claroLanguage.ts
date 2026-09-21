import {
  ELEMENTS,
  SYNONYMS,
  ALIGN_VALUES,
  JUSTIFY_VALUES,
  TEXT_ALIGN_VALUES,
  FONT_WEIGHT_VALUES,
  EFFECTS,
  ANIMATIONS,
  type PropSchema,
} from "@project/contracts";

const PROP_KINDS: Record<string, string> = {
  number: "number (with optional unit)",
  string: "string",
  color: "hex color",
  boolean: "true|false",
  enum: "one of",
  tuple: "space-separated list (shorthand)",
  list: "[ ... ] bracketed list",
};

function formatProp(p: PropSchema): string {
  const parts: string[] = [];
  parts.push(`kind=${p.kind}`);
  if (p.unit && p.unit.length) parts.push(`units=${p.unit.join("|")}`);
  if (p.values) parts.push(`allowed=[${p.values.join("|")}]`);
  parts.push(`group=${p.group}`);
  if (p.required) parts.push("required");
  const doc = p.doc ? ` — ${p.doc}` : "";
  return `${parts.join(", ")}${doc}`;
}

function renderElements(): string {
  const lines: string[] = [];
  for (const [name, el] of Object.entries(ELEMENTS)) {
    lines.push(`### ${name}`);
    if (el.doc) lines.push(el.doc);
    if (el.textContent) lines.push(`- Renders text content: \`${name} "My title"\``);
    if (el.isComponent) lines.push("- Component instance (defined in `.cl` component files)");
    const props = Object.entries(el.props);
    if (props.length) {
      lines.push("Props:");
      for (const [propName, prop] of props) {
        lines.push(`  - \`${propName}\` — ${formatProp(prop)}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function renderSynonyms(): string {
  return Object.entries(SYNONYMS)
    .map(([from, to]) => `- \`${from}\` → \`${to}\``)
    .join("\n");
}

const PATCH_VOCABULARY = `- {"op":"set_property","target":"<nodeId>","property":"<prop>","value":<PropValue>}
- {"op":"clear_property","target":"<nodeId>","property":"<prop>"}
- {"op":"set_text","target":"<nodeId>","value":"<string>"}
- {"op":"add_element","parent":"<nodeId>","element":<DslNode>,"position":"last"}
- {"op":"remove_element","target":"<nodeId>"}
- {"op":"move_element","target":"<nodeId>","position":"first|last","ref":"<nodeId>"}
- {"op":"set_layout","target":"<nodeId>","layout":"stack|row|grid|overlay"}
- {"op":"set_effects","target":"<nodeId>","effect":"aurora|particles|glow|noise"}`;

const EXAMPLES = `\`\`\`
page Home {
    section hero {
        heading "Welcome to CLARO" {
            size: 48
        }
        text "Reversible, AI-native UI. Write it, preview it, undo it." {
            color: #c8c8d0
            size: 18
        }
        button "Get Started"
    }
}
\`\`\`

PropValue forms: {"t":"num","v":18} · {"t":"str","v":"hi"} · {"t":"color","v":"#c8c8d0"} · {"t":"bool","v":true} · {"t":"enum","v":"center"}
Tuples: padding: 8 16 → top-bottom left-right. border: 1 solid #fff. shadow: 0 2 8 rgba(0,0,0,.2)`;

/**
 * The claro-language skill — generated IN-MEMORY from contracts/dsl-schema.ts,
 * the single source of truth. It can never drift from the real grammar because
 * it IS the real grammar. Auto-attached to every BHASM code/ask call.
 */
export function buildClaroLanguageSkill(): string {
  return `# Claro language reference

Claro (.cl) is a reversible, AI-native markup language. Comments use \`#\` to the end of line
and are the project's "ideas" — treat them as authoritative product intent.

## Elements

${renderElements()}

## Synonyms (aliases resolved at parse time)

${renderSynonyms()}

## Global enumerations

- align: ${ALIGN_VALUES.join(" | ")}
- justify: ${JUSTIFY_VALUES.join(" | ")}
- text align: ${TEXT_ALIGN_VALUES.join(" | ")}
- font weight: ${FONT_WEIGHT_VALUES.join(" | ")}
- effects: ${EFFECTS.join(" | ")}
- animations: ${ANIMATIONS.join(" | ")}

## PropValue kinds
${Object.entries(PROP_KINDS).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

## PatchOp vocabulary (the ONLY way to modify a project)
${PATCH_VOCABULARY}

All PatchOps are validated by the engine before they apply; a nodeId must exist and every
property must be legal for the target element's schema. Prefer set_property/set_text for
small changes (updates are the most common request).

## Example
${EXAMPLES}
`;
}