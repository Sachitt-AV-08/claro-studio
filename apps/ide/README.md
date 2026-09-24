# @project/ide — owned by Agent 2 (Puneeth)

CLARO Workbench: the IDE. Electron + Vite + React 18 + TypeScript + Monaco.

Read `docs/CONTRACTS.md` first, then follow the Agent-2 prompt (issued separately).
Do not modify `contracts/` or other packages — code against them.

## What ships in this lane
- 3-pane graphite shell (Explorer | Monaco | Preview) with custom title bar,
  activity bar, tab strip, status bar groups, command palette, Problems panel.
- Reversible CODE ↔ AST ↔ PREVIEW loop on the Claro `.cl` source; `.cl` token
  highlighting, completion, idea-comment hover, diagnostics, Format (Ctrl+K).
- Multi-language workspace files: open/save real files (`.cl/.py/.kt/.ts/.js/
  .json/.html/.md/…`) via native dialog or Ctrl+S; dynamic tabs with dirty marks.
- BHASM bottom-docked agent (Ask / Code / Review / Explain-comment), streaming
  against local Ollama `qwen2.5:3b`, tool-call chips, Extensions + skills view,
  Stitch seam (Source A | B → Destination), team Tasks board, Settings/keybindings
  JSON, Git branch statusbar + terminal git toolbar, debug breakpoints (F9),
  live terminal (ConPTY), Python console + Kotlin Compose previews, iPhone frame
  preview, Build/package EXE, single-file HTML export.
- Live Settings.json → Monaco (`editor.fontSize`, `tabSize`, `wordWrap`) and
  terminal font family; saves apply instantly and persist to `settings/*.json`.

## Rules
No fake success states. Build against a local fixture AST until `@project/dsl` lands on
`main`, then wire the real parser/generator/patcher.