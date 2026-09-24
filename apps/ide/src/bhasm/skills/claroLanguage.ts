import {
  getLanguageKnowledge,
  type LanguageKnowledge,
  type PropKind,
} from "@project/contracts";

const PROP_KINDS: Record<PropKind, string> = {
  number: "number (with optional unit)",
  string: "string",
  color: "hex color",
  boolean: "true|false",
  enum: "one of",
  tuple: "space-separated list (shorthand)",
  list: "[ ... ] bracketed list",
};

function formatKind(kind: PropKind, units?: string[], values?: string[]): string {
  const parts: string[] = [`kind=${kind}`];
  if (units && units.length) parts.push(`units=${units.join("|")}`);
  if (values) parts.push(`allowed=[${values.join("|")}]`);
  return parts.join(", ");
}

function renderElements(k: LanguageKnowledge): string {
  const lines: string[] = [];
  for (const el of k.elements) {
    lines.push(`### ${el.type}`);
    if (el.doc) lines.push(el.doc);
    if (el.textContent) lines.push(`- Renders text content: \`${el.type} "My title"\``);
    if (el.isComponent) lines.push("- Component instance (defined in `.cl` component files)");
    if (el.props.length) {
      lines.push("Props:");
      for (const p of el.props) {
        const detail = formatKind(p.kind, p.units, p.values);
        const doc = p.doc ? ` — ${p.doc}` : "";
        const required = p.required ? " (required)" : "";
        lines.push(`  - \`${p.name}\` — ${detail}${required}${doc}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function renderSynonyms(k: LanguageKnowledge): string {
  return Object.entries(k.synonyms)
    .map(([from, to]) => `- \`${from}\` → \`${to}\``)
    .join("\n");
}

function renderEnums(k: LanguageKnowledge): string {
  const named = [
    ["align", "align"],
    ["justify", "justify"],
    ["text.align", "text align"],
    ["weight", "font weight"],
    ["effect", "effects"],
    ["animation", "animations"],
    ["button.variant", "button variant"],
    ["badge.variant", "badge variant"],
    ["input.type", "input type"],
  ] as const;
  return named
    .map(([key, label]) => `- ${label}: ${(k.enums[key] ?? []).join(" | ")}`)
    .join("\n");
}

function renderPatchVocabulary(k: LanguageKnowledge): string {
  return k.patchOps.map((op) => `- ${op.shape} — ${op.doc}`).join("\n");
}

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
 * The claro-language skill — generated IN-MEMORY from getLanguageKnowledge()
 * (contracts/dsl-schema.ts), the single source of truth. It can never drift
 * from the real grammar because it IS the real grammar. Auto-attached to every
 * BHASM code/ask call.
 */
export function buildClaroLanguageSkill(): string {
  const k = getLanguageKnowledge();
  return `# Claro language reference

${k.blurb}

Claro (.cl) comments use \`#\` to the end of line and are the project's "ideas" —
treat them as authoritative product intent.

## Value types

${k.valueTypes.map((v) => `- ${v.type} — written as \`${v.writtenAs}\`; ${v.usedFor} (${v.note})`).join("\n")}

## Elements

${renderElements(k)}

## Synonyms (aliases resolved at parse time)

${renderSynonyms(k)}

## Global enumerations

${renderEnums(k)}

## PropValue kinds
${Object.entries(PROP_KINDS).map(([kind, v]) => `- ${kind}: ${v}`).join("\n")}

## PatchOp vocabulary (the ONLY way to modify a project)
${renderPatchVocabulary(k)}

All PatchOps are validated by the engine before they apply; a nodeId must exist and every
property must be legal for the target element's schema. Prefer set_property/set_text for
small changes (updates are the most common request).

## Example
${EXAMPLES}
`;
}