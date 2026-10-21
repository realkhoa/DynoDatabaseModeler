# Multi-Theme System Design Specification

## 1. Overview & Objectives

DynoDbModeler is expanding from a single dark-mode aesthetic to a multi-theme architecture supporting four distinct visual themes:
1. **Dark (Default Dyno)**: The signature sleek dark aesthetic (`#1e1f22`, `#18191c`, accent `#3a82f7`).
2. **GitIngest (Warm / Amber)**: Inspired by GitIngest's warm parchment/cream background (`#faf8f5`), charcoal typography (`#1f2937`), warm borders (`#dfd7ca`), and amber/orange accents (`#ea580c`).
3. **GitHub Light**: Clean, modern high-contrast light theme (`#ffffff`, `#f6f8fa`, `#d0d7de`, accent `#0969da`).
4. **Midnight OLED**: Ultra-deep pitch black for OLED displays (`#000000`, `#08090d`, neon cyan `#00f0ff`).

### Core Requirements
- Global theme switching via a quick-access dropdown on the `HeaderBar`.
- Persistence of user theme choice in browser `localStorage` under `dyno_theme_preference`.
- Seamless DOM attribute synchronization (`data-theme="dark | gitingest | github-light | midnight"`).
- Synchronization with locally bundled Monaco Editor (`vs-dark` vs `vs` light).
- Synchronization with `@xyflow/react` ERD Canvas background and grid dots.
- 100% preservation of all existing 381 unit tests without breaking changes to existing JSX markup or class names.

---

## 2. Architecture & Data Model

### 2.1 Types (`src/types/theme.ts`)

```typescript
export type AppTheme = 'dark' | 'gitingest' | 'github-light' | 'midnight';

export interface ThemeMeta {
  id: AppTheme;
  label: string;
  description: string;
  type: 'dark' | 'light';
  previewColor: string;
  monacoTheme: 'vs-dark' | 'vs';
  canvasBg: string;
  canvasDots: string;
  accentColor: string;
}

export const THEMES: Record<AppTheme, ThemeMeta> = {
  dark: {
    id: 'dark',
    label: 'Dark (Default)',
    description: 'Modern sleek dark theme with blue accents',
    type: 'dark',
    previewColor: '#1e1f22',
    monacoTheme: 'vs-dark',
    canvasBg: '#1e1f22',
    canvasDots: '#35373c',
    accentColor: '#3a82f7',
  },
  gitingest: {
    id: 'gitingest',
    label: 'GitIngest',
    description: 'Warm cream paper aesthetic with amber accents',
    type: 'light',
    previewColor: '#faf8f5',
    monacoTheme: 'vs',
    canvasBg: '#faf8f5',
    canvasDots: '#d5cec2',
    accentColor: '#ea580c',
  },
  'github-light': {
    id: 'github-light',
    label: 'GitHub Light',
    description: 'Clean crisp light theme with blue highlights',
    type: 'light',
    previewColor: '#ffffff',
    monacoTheme: 'vs',
    canvasBg: '#ffffff',
    canvasDots: '#d0d7de',
    accentColor: '#0969da',
  },
  midnight: {
    id: 'midnight',
    label: 'Midnight OLED',
    description: 'True black high-contrast OLED mode with neon cyan',
    type: 'dark',
    previewColor: '#000000',
    monacoTheme: 'vs-dark',
    canvasBg: '#000000',
    canvasDots: '#1c1f2e',
    accentColor: '#00f0ff',
  },
};
```

### 2.2 Theme Manager (`src/utils/themeManager.ts`)

- `getSavedTheme(): AppTheme`: Reads `dyno_theme_preference` from `localStorage` with fallback to `'dark'`.
- `setSavedTheme(theme: AppTheme): void`: Saves preference to `localStorage`.
- `applyTheme(theme: AppTheme): void`:
  - Sets `data-theme` attribute on `document.documentElement`.
  - Sets `color-scheme` CSS style property (`dark` or `light`).
  - Dispatches `CustomEvent('dyno-theme-changed', { detail: { theme } })`.
- `initTheme(): AppTheme`: Initializes theme on app startup.

---

## 3. Styling & CSS Architecture (`src/index.css`)

CSS variable overrides and class mappings per `data-theme`:

```css
/* Base Dark Theme (Default) */
:root, [data-theme="dark"] {
  --color-bg-base: #1e1f22;
  --color-bg-sidebar: #18191c;
  --color-bg-toolbar: #26282d;
  --color-bg-surface: #2b2d30;
  --color-border-subtle: #35373c;
  --color-text-main: #e6e8ea;
  --color-text-muted: #8c919a;
  --color-accent-blue: #3a82f7;
  color-scheme: dark;
}

/* GitIngest Warm Cream Theme */
[data-theme="gitingest"] {
  --color-bg-base: #faf8f5;
  --color-bg-sidebar: #f4f0ea;
  --color-bg-toolbar: #ede7de;
  --color-bg-surface: #ffffff;
  --color-border-subtle: #dfd7ca;
  --color-text-main: #1f2937;
  --color-text-muted: #78716c;
  --color-accent-blue: #ea580c;
  color-scheme: light;
}

/* GitHub Light Theme */
[data-theme="github-light"] {
  --color-bg-base: #ffffff;
  --color-bg-sidebar: #f6f8fa;
  --color-bg-toolbar: #f3f4f6;
  --color-bg-surface: #ffffff;
  --color-border-subtle: #d0d7de;
  --color-text-main: #1f2328;
  --color-text-muted: #656d76;
  --color-accent-blue: #0969da;
  color-scheme: light;
}

/* Midnight OLED Theme */
[data-theme="midnight"] {
  --color-bg-base: #000000;
  --color-bg-sidebar: #08090d;
  --color-bg-toolbar: #0e1017;
  --color-bg-surface: #141724;
  --color-border-subtle: #1c1f2e;
  --color-text-main: #f1f3f9;
  --color-text-muted: #7982a9;
  --color-accent-blue: #00f0ff;
  color-scheme: dark;
}
```

Dynamic class overrides for light themes (`gitingest`, `github-light`):
- Map background classes: `.bg-\[\#1e1f22\]`, `.bg-\[\#18191c\]`, `.bg-\[\#26282d\]`, `.bg-\[\#2b2d30\]`, `.bg-\[\#141517\]`, `.bg-\[\#222429\]`.
- Map text classes: `.text-\[\#e6e8ea\]`, `.text-\[\#8c919a\]`.
- Map border classes: `.border-\[\#35373c\]`, `.border-\[\#2c2e34\]`.
- Map accent buttons and hover effects.

---

## 4. UI Components Integration

1. **HeaderBar (`src/components/HeaderBar.tsx`)**:
   - Add theme switcher button with icon (`Palette` / `Sun` / `Moon`).
   - Popover dropdown listing all 4 themes with circular color badges and checkmark indicator.
   - Click-outside detection to auto-close dropdown.

2. **Monaco Editor (`src/components/query/QueryEditorTab.tsx`)**:
   - Read current theme or listen to `dyno-theme-changed` event.
   - Set Monaco `theme` prop to `vs` when `gitingest` or `github-light`, and `vs-dark` when `dark` or `midnight`.

3. **ERD Canvas (`src/components/canvas/ErdCanvas.tsx`)**:
   - Update `<Background />` color and dot styling based on active theme meta.

4. **App Initialization (`src/App.tsx` or `src/main.tsx`)**:
   - Invoke `initTheme()` on mount to restore saved theme preference immediately.

---

## 5. Verification & Testing

1. **Unit Tests**:
   - `src/utils/themeManager.test.ts`: Test `getSavedTheme`, `setSavedTheme`, `applyTheme`, and event broadcasting.
   - `src/components/HeaderBar.test.tsx`: Test theme switcher button click, dropdown rendering, and theme selection.
2. **Regression Testing**:
   - Run `bun test` across all 36+ test files (381+ tests must pass).
   - Run `cargo test` for backend verification.
   - Run `bun run build` (`tsc && vite build`) with zero errors.
3. **Static Code Review**:
   - Execute deterministic review via MCP `knowledge_code_review` (zero errors, 100% Doxygen/TSDoc).
