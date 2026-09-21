# Claro IDE — Agent 2 Progress Tracker

**Branch:** `agent-2/ide` | **Target:** `main` via PR at coordination windows  
**Last Updated:** 2026-09-21  
**Status:** Phase 1 — Graphite UI Theme System (IN PROGRESS)

---

## Phase Status

| Phase | Feature | Status | Started | Completed | Notes |
|-------|---------|--------|---------|-----------|-------|
| 1 | Graphite UI (theme, variables, globals) | 🔄 IN PROGRESS | 2026-09-21 | — | `variables.css` created |
| 1 | Claro Workbench (AppLayout, ActivityBar, Splitters) | ⬜ Pending | — | — | |
| 1 | File Explorer (FS watcher, git badges) | ⬜ Pending | — | — | Watchman integration planned |
| 1 | Tab Strip (multi-file, dirty, split) | ⬜ Pending | — | — | |
| 1 | Bottom Panel (Problems, Terminal, Debug, Output) | ⬜ Pending | — | — | |
| 1 | Window Controls + Status Bar | ⬜ Pending | — | — | |
| 2 | Claro Editor (Monaco + .cl language) | ⬜ Pending | — | — | |
| 2 | Token colors, folding, brackets | ⬜ Pending | — | — | |
| 3 | Live Canvas (astToView, layouts, styleMapper) | ⬜ Pending | — | — | |
| 3 | Fixture AST (full element coverage) | ⬜ Pending | — | — | |
| 4 | Dual Cursor (selection sync, hover, decorations) | ⬜ Pending | — | — | |
| 5 | Visual Patch (drag handles, snap, patch ops) | ⬜ Pending | — | — | |
| 5 | Unified Timeline (undo stack) | ⬜ Pending | — | — | |
| 6 | Command Palette + Focus Modes | ⬜ Pending | — | — | |
| 7 | Git Bridge (diff, stage, commit, push, PR) | ⬜ Pending | — | — | |
| 7 | Smart Hints (packages, props, deprecations) | ⬜ Pending | — | — | |
| 7 | Claro Console (terminal redesign) | ⬜ Pending | — | — | |
| 7 | Diagnostics Panel | ⬜ Pending | — | — | |
| 7 | Extension Host (marketplace, local) | ⬜ Pending | — | — | |
| 7 | Tests + Typecheck (CI green) | ⬜ Pending | — | — | |

---

## Daily Log

### 2026-09-21
- [x] Repo cloned, branch `agent-2/ide` created
- [x] Monorepo structure with workspaces (`package.json` at root)
- [x] `apps/ide` package.json, tsconfig (main + electron), vite.config.ts
- [x] Electron main process (`src-electron/main.ts`) + preload (`src-electron/preload.ts`) + util
- [x] React entry point (`src/main.tsx`) + `index.html`
- [x] App icon copied from `~/Downloads/CW - APP ICON.png` → `apps/ide/public/icon.png`
- [x] Graphite UI variables.css created (complete theme token system)
- [ ] Global styles, theme.ts, AppLayout components — IN PROGRESS

---

## Definition of Done (per feature)

- [ ] TypeScript strict mode passes (`npm run typecheck`)
- [ ] Unit tests pass (`npx vitest run`)
- [ ] Manual verification: `npm run dev` boots in <3s
- [ ] No console errors
- [ ] Keyboard accessible
- [ ] Theme consistent (Graphite UI)

---

## Architecture Decisions Locked

| Area | Decision |
|------|----------|
| Preview rendering | Inline React tree + inline styles (no iframe) |
| Drag targets | Every node (virtualized handles on hover) |
| File watcher | Watchman (system-level, not chokidar) |
| Formatter | Prettier + custom Claro plugin (`@claro/formatter`) |
| Language Server | `vscode-languageserver-node` (`@claro/lsp`) |
| State | Zustand + Immer + Reselect |
| Theme | Dark-only, single accent `#2a7ade`, 4px grid |
| Fonts | JetBrains Mono (code) + Inter (UI) |