# Multi-Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a multi-theme system supporting Dark (Default), GitIngest (Warm/Amber), GitHub Light, and Midnight OLED with HeaderBar quick-switching, localStorage persistence, and Monaco / Canvas synchronization.

**Architecture:** A lightweight dynamic attribute mapping system (`data-theme`) on the document root that drives CSS variables and Tailwind utility class overrides in `src/index.css`. Theme state is managed via a dedicated `themeManager` module that syncs with `localStorage` and broadcasts changes to Monaco Editor and `@xyflow/react` ERD Canvas.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Monaco Editor, Lucide React, Vitest.

## Global Constraints

- Mandatory Doxygen / TSDoc coverage (`@brief`, `@param`, `@return`) for 100% of functions and interfaces.
- Final user reports strictly in Vietnamese; all code, commits, and comments strictly in English.
- 100% test pass rate across all Vitest suites and Rust Cargo tests before completion.
- Zero unresolved static code review violations (`knowledge_code_review`).

---

### Task 1: Theme Types and Metadata Definition

**Files:**
- Create: `src/types/theme.ts`

**Interfaces:**
- Produces: `AppTheme`, `ThemeMeta`, `THEMES`, `DEFAULT_THEME`

- [ ] **Step 1: Create `src/types/theme.ts`**

Define `AppTheme` union type (`'dark' | 'gitingest' | 'github-light' | 'midnight'`), `ThemeMeta` interface, and the `THEMES` registry containing complete metadata (labels, descriptions, preview colors, monaco theme, canvas dots).

- [ ] **Step 2: Verify TypeScript compilation**

Run `bun run build` to ensure type definitions compile cleanly without errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/theme.ts; git commit -m "feat(theme): define AppTheme types and metadata registry"
```

---

### Task 2: Theme Manager Utility & Unit Test Suite

**Files:**
- Create: `src/utils/themeManager.ts`
- Create: `src/utils/themeManager.test.ts`

**Interfaces:**
- Consumes: `src/types/theme.ts` (`AppTheme`, `THEMES`, `DEFAULT_THEME`)
- Produces: `getSavedTheme()`, `setSavedTheme()`, `applyTheme()`, `initTheme()`, `onThemeChange()`

- [ ] **Step 1: Write unit tests in `src/utils/themeManager.test.ts`**

Cover:
- Reading saved theme from `localStorage` (and fallback to default `'dark'`).
- Saving theme to `localStorage`.
- Applying theme to `document.documentElement` (`data-theme` and `color-scheme`).
- Dispatching `dyno-theme-changed` CustomEvent.

- [ ] **Step 2: Run test to confirm failure**

```bash
bun test src/utils/themeManager.test.ts
```

- [ ] **Step 3: Implement `src/utils/themeManager.ts`**

Implement `getSavedTheme`, `setSavedTheme`, `applyTheme`, `initTheme`, and `onThemeChange` with full TSDoc documentation.

- [ ] **Step 4: Run test to confirm pass**

```bash
bun test src/utils/themeManager.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/utils/themeManager.ts src/utils/themeManager.test.ts; git commit -m "feat(theme): add themeManager utility and test suite"
```

---

### Task 3: CSS Theme Variables & Theme Stylesheet Layer

**Files:**
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `[data-theme="dark"]`, `[data-theme="gitingest"]`, `[data-theme="github-light"]`, `[data-theme="midnight"]`

- [ ] **Step 1: Update `src/index.css`**

Add theme definitions for:
- `:root, [data-theme="dark"]`: Default dark variables.
- `[data-theme="gitingest"]`: Warm paper cream (`#faf8f5`), sidebar (`#f4f0ea`), cards (`#ffffff`), borders (`#dfd7ca`), text (`#1f2937`), accent amber (`#ea580c`).
- `[data-theme="github-light"]`: Crisp light (`#ffffff`), sidebar (`#f6f8fa`), borders (`#d0d7de`), text (`#1f2328`), accent blue (`#0969da`).
- `[data-theme="midnight"]`: OLED pitch black (`#000000`), sidebar (`#08090d`), borders (`#1c1f2e`), text (`#f1f3f9`), accent neon (`#00f0ff`).
- Dynamic class overrides for light themes (`.bg-\[\#1e1f22\]`, `.text-\[\#e6e8ea\]`, etc.) ensuring seamless light rendering across existing components.

- [ ] **Step 2: Verify Vitest regression suite**

```bash
bun run test
```

- [ ] **Step 3: Commit**

```bash
git add src/index.css; git commit -m "style(theme): add CSS variables and theme rules for GitIngest, Light, and Midnight"
```

---

### Task 4: HeaderBar Theme Switcher Dropdown & Unit Tests

**Files:**
- Modify: `src/components/HeaderBar.tsx`
- Modify: `src/components/HeaderBar.test.tsx`

**Interfaces:**
- Consumes: `src/types/theme.ts`, `src/utils/themeManager.ts`
- Produces: HeaderBar theme dropdown button and selection triggers

- [ ] **Step 1: Write test case in `src/components/HeaderBar.test.tsx`**

Test:
- Theme switcher button renders with active theme indicator.
- Clicking button opens dropdown listing all 4 themes.
- Selecting a theme triggers theme change and closes dropdown.

- [ ] **Step 2: Update `src/components/HeaderBar.tsx`**

Add:
- Theme switcher button next to Settings / New Connection.
- Popover dropdown with preview color badges and checkmark.
- Click-outside detection.

- [ ] **Step 3: Run Vitest on `HeaderBar.test.tsx`**

```bash
bun test src/components/HeaderBar.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git add src/components/HeaderBar.tsx src/components/HeaderBar.test.tsx; git commit -m "feat(theme): add theme switcher dropdown to HeaderBar"
```

---

### Task 5: Synchronize Monaco Editor, ERD Canvas & App Root

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/canvas/ErdCanvas.tsx`
- Modify: `src/components/query/QueryEditorTab.tsx`

**Interfaces:**
- Consumes: `src/utils/themeManager.ts` (`initTheme`, `onThemeChange`)

- [ ] **Step 1: Update `src/App.tsx`**

Invoke `initTheme()` on mount to initialize the saved theme and listen for theme updates.

- [ ] **Step 2: Update `src/components/canvas/ErdCanvas.tsx`**

Sync `<Background />` color and dots color with current theme (`THEMES[currentTheme].canvasDots` and `canvasBg`).

- [ ] **Step 3: Update `src/components/query/QueryEditorTab.tsx`**

Sync Monaco Editor `theme` prop (`vs` for GitIngest & GitHub Light, `vs-dark` for Dark & Midnight).

- [ ] **Step 4: Run full Vitest suite**

```bash
bun run test
```

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/canvas/ErdCanvas.tsx src/components/query/QueryEditorTab.tsx; git commit -m "feat(theme): synchronize Monaco editor and ERD canvas with active theme"
```

---

### Task 6: Final Verification, Documentation & Static Review

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update `README.md`**

Document the new Multi-Theme System, including the 4 themes (Dark, GitIngest, GitHub Light, Midnight OLED).

- [ ] **Step 2: Run deterministic code review**

Execute MCP `knowledge_code_review` and ensure 0 errors and 0 warnings.

- [ ] **Step 3: Run full build and test suites**

```bash
bun run test
bun run build
cargo test --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 4: Commit and push**

```bash
git add README.md; git commit -m "docs: document multi-theme system capabilities"
git push origin master
```
