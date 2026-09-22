# @project/ide — owned by Agent 2 (Puneeth)

CLARO Workbench: the IDE. Electron + Vite + React 18 + TypeScript + Monaco.

Read `docs/CONTRACTS.md` first, then follow the Agent-2 prompt (issued separately).
Do not modify `contracts/` or other packages — code against them.

## First milestone
3-pane graphite shell (Explorer | Monaco | Preview) → `.cl` token highlighting →
fixture AST renders in preview with `data-node-id` → click selects + outlines →
drag changes semantic props → typecheck + tests green.

## Rules
No fake success states. Build against a local fixture AST until `@project/dsl` lands on
`main`, then wire the real parser/generator/patcher.