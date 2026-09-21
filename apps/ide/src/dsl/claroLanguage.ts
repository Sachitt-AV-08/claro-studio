/**
 * Claro (.cl) language support for Monaco.
 * Registers the 'claro' language id + a graphite dark theme.
 * Call registerClaroLanguage() once at app start (before mounting Editor).
 */

import * as monaco from "monaco-editor";

declare module "react" {
  interface CSSProperties {
    WebkitAppRegion?: string;
  }
}

const KEYWORDS = [
  "page",
  "component",
  "section",
  "heading",
  "text",
  "badge",
  "button",
  "input",
  "toggle",
  "card",
  "image",
  "divider",
  "spacer",
  "nav",
  "footer",
  "hero",
  "stack",
  "row",
  "column",
  "grid",
  "overlay",
];

const LAYOUT_ENUMS = ["stack", "row", "grid", "overlay", "column", "flex"];

function toCaseInsensitive(arr: string[]): string {
  return arr.join("|");
}

export function registerClaroLanguage(): void {
  monaco.languages.register({ id: "claro" });

  monaco.languages.setMonarchTokensProvider("claro", {
    keywords: toCaseInsensitive(KEYWORDS),
    layoutEnums: toCaseInsensitive(LAYOUT_ENUMS),
    tokenizer: {
      root: [
        [
          /[a-zA-Z_][\w-]*/,
          {
            cases: {
              "@keywords": "keyword",
              "@layoutEnums": "type.identifier",
              "@default": "identifier",
            },
          },
        ],
        [/"(?:[^"\\]|\\.)*"/, "string"],
        [/'(?:[^'\\]|\\.)*'/, "string"],
        [/#[0-9a-fA-F]{3,8}\b/, "number.hex"],
        [/@[\w-]+/, "tag"],
        [/[{}\[\](),:]/, "delimiter"],
        [/\/\/.*$/, "comment"],
        [/[0-9]+(?:\.[0-9]+)?(px|%|fr|em|rem)?/, "number"],
        [/[ \t\r\n]+/, "white"],
      ],
    },
  });

  monaco.languages.setLanguageConfiguration("claro", {
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    folding: {
      markers: {
        start: /^\s*\/\*\s*region\b/,
        end: /^\s*\/\*\s*endregion\b/,
      },
    },
    wordPattern: /[a-zA-Z_][\w-]*/,
  });

  monaco.editor.defineTheme("claro-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "569CD6", fontStyle: "bold" },
      { token: "type.identifier", foreground: "4EC9B0" },
      { token: "identifier", foreground: "D4D4D4" },
      { token: "string", foreground: "CE9178" },
      { token: "number", foreground: "B5CEA8" },
      { token: "number.hex", foreground: "DCDCAA" },
      { token: "tag", foreground: "DCDCAA" },
      { token: "delimiter", foreground: "D4D4D4" },
      { token: "comment", foreground: "6A9955" },
      { token: "white", foreground: "FFFFFF00" },
    ],
    colors: {
      "editor.background": "#14141A",
      "editor.foreground": "#C8C8D0",
      "editor.lineHighlightBackground": "#1A1A24",
      "editorCursor.foreground": "#2A7ADE",
      "editor.selectionBackground": "#1E3A5F",
      "editor.inactiveSelectionBackground": "#1A2A3E",
      "editorWhitespace.foreground": "#2A2A3A",
      "editorIndentGuide.background": "#1E1E2A",
      "editorIndentGuide.activeBackground": "#2A7ADE",
      "editorLineNumber.foreground": "#7A7A8A",
      "editorLineNumber.activeForeground": "#C8C8D0",
      "editor.findMatchBackground": "#1A3A22",
      "editor.findMatchHighlightBackground": "#3A2A0A",
      "editorBracketMatch.background": "#1E3A5F",
      "editorBracketMatch.border": "#2A7ADE",
      "editorError.foreground": "#F85149",
      "editorWarning.foreground": "#D29922",
      "editorInfo.foreground": "#2A7ADE",
      "scrollbarSlider.background": "#2A2A3A",
      "scrollbarSlider.hoverBackground": "#3A3A4A",
      "scrollbarSlider.activeBackground": "#4A4A5A",
    },
  });
}

/** Get completion items for the Claro language (element names + their props). */
export function createClaroCompletionProvider(): monaco.languages.CompletionItemProvider {
  return {
    triggerCharacters: [":", " ", "{", "@"],
    provideCompletionItems(model, position) {
      const textUntil = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const items: monaco.languages.CompletionItem[] = [];

      // If inside braces after a key, suggest prop values
      const propMatch = textUntil.match(/(\w+):\s*$/);
      if (propMatch) {
        const propKey = propMatch[1];
        const propSuggestions: Record<string, string[]> = {
          size: ["12", "14", "16", "18", "20", "24", "32", "48", "64"],
          color: ["#000000", "#ffffff", "#2a7ade", "#f85149", "#2ea043", "#d29922"],
          background: ["#14141a", "#1a1a24", "#f5f5f5", "transparent"],
          layout: ["stack", "row", "grid", "overlay"],
          gap: ["8", "12", "16", "24", "32"],
          padding: ["8", "12", "16", "24", "32"],
          align: ["start", "center", "end", "stretch"],
          justify: ["start", "center", "end", "space-between", "space-around"],
          accent: ["true", "false"],
        };
        const vals = propSuggestions[propKey] ?? [];
        for (const v of vals) {
          items.push({
            label: v,
            kind: monaco.languages.CompletionItemKind.Value,
            insertText: v,
            detail: `value for ${propKey}`,
          } as monaco.languages.CompletionItem);
        }
      }

      // If at start of line or after whitespace, suggest element types
      if (textUntil.trim().length === 0 || /\s$/.test(textUntil)) {
        for (const kw of KEYWORDS) {
          items.push({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: kw + " ",
            detail: `Claro element: ${kw}`,
          } as monaco.languages.CompletionItem);
        }
      }

      return { suggestions: items };
    },
  };
}