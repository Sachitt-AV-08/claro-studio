# Claro Tolerance Contract (annoyance elimination)

Claro is engineered so the file can never be "stuck". Tolerances live in the
tokenizer/parser/formatter, not the runtime UX — every item below is
deterministic and tested.

## Decisions (locked)

1. **Case-insensitive types/keys/enums** — canonicalized to lowercase. String content stays case-sensitive.
2. **`'` is a string alias** alongside `"`.
3. **Duplicate properties = last-wins + warning** (CSS behavior).
4. **Markdown fenced code blocks strip at parse level** (```cl … ```) — AI paste slop cannot break a file.
5. Optional `;` accepted anywhere, stripped by the formatter.
6. AI markdown fences around whole files are stripped silently.

## Common pain → Claro answer

| Pain | Lived in | Claro answer |
|---|---|---|
| Indentation errors / tabs-vs-spaces | Python | Whitespace fully ignored; formatter re-indents to 4 spaces. Indentation is display, never meaning. |
| Case gotchas (`backgroundColor` vs `backgroundcolor`) | JS/CSS | Types & keys case-insensitive, canonicalized lowercase. One spelling, enforced silently. |
| Missing / extra braces or parens | JS/C | Error-tolerant parser: precise diagnostic at line:col, auto-recovers at next known boundary, never dies mid-file. |
| Missing / trailing commas | JSON/JS | Both accepted; formatter normalizes. |
| Semicolon wars + ASI bugs | JS | `;` optional anywhere, stripped by formatter. |
| Unterminated strings / wrong quotes | most | Precise error + recovery to statement end; `'` accepted as alias. |
| Typo keys (`pxxading`) | CSS/TS | Warning + deterministic "did you mean `padding`?" suggestion. |
| Wrong value types (`gap: "big"`) | TS | Typed error listing allowed types/units/enums. |
| Duplicate properties | CSS | Last wins + gentle warning. |
| Type/name shadowing (`component button`) | many | Clear error; built-in names reserved. |
| CRLF / LF / BOM / unicode | everywhere | BOM stripped; `\r\n`≡`\n`; identifiers ASCII; values keep full unicode. |
| AI pastes with markdown fences | the AI era | Parser strips surrounding fences. |
| Mixed tabs/spaces, trailing spaces | everywhere | Ignored; formatter strips. |
| Inline comments after values (`gap: 24 // note`) | many languages | Legal, preserved, harmless. |
| Empty file / blank page | everywhere | Auto-bootstraps `page Home {}`. |
| Git diff noise from reformatting | formatters everywhere | Canonical formatter is idempotent + deterministic → minimal diffs. |
| One error cascading into twenty | many compilers | Diagnostics deduped + capped; first error pins the file; no overwhelm. |

## Engine guarantees

- **Error-tolerant parse:** parse *always succeeds*; problems become `Diagnostic[]`
  (error/warning/info) each with `range` + `nodeId`. The preview renders the
  recoverable tree, broken elements outlined in red.
- **Canonical formatter:** `format(format(x)) ≡ format(x)`. Runs on save; fixes
  indentation, spacing, duplicates (last-wins), optional `;`, casing, fences.
- **Suggestion engine:** Levenshtein "did you mean" for keys, types, enums —
  for humans and the local AI alike.
- **Editor extras (Agent 2):** auto-close braces/quotes, brace-matching,
  hover tooltips, "format on save".

## "No hassle" promise

No indentation errors. No case errors. No punctuation errors. Determinism is
untouched because every tolerance is a parse/display convenience, not a semantic change.