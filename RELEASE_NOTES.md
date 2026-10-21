# DynoDbModeler v0.3.1 Release Notes

### 🚀 Major Highlights

#### 1. High-Performance Virtual Windowing Data Grid Engine
- **Ultra-Fast Row Windowing (`useVirtualRows`)**: Replaced full dataset DOM mounting with mathematical virtual windowing at a fixed $28\text{px}$ row height (with optional `rowHeight` override).
- **60 FPS Scrolling**: Effortlessly scrolls datasets with **500 to 100,000+ rows**, mounting only 25–35 DOM `<tr>` elements in the active viewport with dynamic top and bottom spacer offsets.
- **Flawless Editing & Dirty Cell Tracking**: Cell mutations, selection coordinates, dirty tracking (`dirtyRowsMap`), and single-row batch save payloads are mapped strictly by `originalIndex`, ensuring zero data desynchronization during virtual scrolling and filtering.
- **Debounced Search (`useDebouncedValue`)**: Added 150ms input debouncing to data grid quick filters and schema search, eliminating keystroke latency and unnecessary in-memory array filtering.

#### 2. ERD Canvas Viewport Frustum Culling
- **Viewport Culling**: Enabled `onlyRenderVisibleElements={true}` on the React Flow ERD canvas, automatically skipping DOM node rendering and Crow's Foot SVG foreign key path calculations for tables situated outside the camera frustum.
- **Minimalist Floating Pill Toolbar**: Replaced cluttered top-right action panels with an ergonomic, semi-transparent floating pill toolbar (`top-4 left-4`, `backdrop-blur-md bg-[#24262b]/85 border border-[#35373c]`) featuring micro-buttons and accessible tooltips.

#### 3. Minimalist UI & Zen Mode (Distraction-Free Workspace)
- **Tri-State Responsive Sidebar (`Sidebar`)**:
  - `expanded` (256px): Full table tree, column counts, and debounced schema filter.
  - `rail` (48px): Micro-icon vertical rail showing active database engine, connection status dot, quick search, refresh, and expand triggers.
  - `zen` (0px): Completely hidden sidebar maximizing canvas or query editor real estate.
- **Global Keyboard Shortcut (`Ctrl+B` / `Cmd+B`)**: Quick toggle between expanded and rail modes with intelligent suppression when typing inside inputs, textareas, contentEditable elements, or Monaco SQL Editor.
- **Ultra-Clean HeaderBar**: Reduced height to a sleek 40px (`h-10`) with dynamic sidebar toggle icons (`PanelLeftClose` / `PanelLeftOpen`) and an unobtrusive micro-status connection dot (emerald pulsing dot when connected, muted gray when disconnected).

---
### 📦 Verification & Quality Evidence
- **Frontend**: 39 test files, 429/429 Vitest tests pass cleanly (`bun run test`).
- **Backend**: 90/90 Rust unit tests pass cleanly (`cargo test`).
- **Production Build**: `tsc && vite build` and local Tauri release packaging complete with zero errors (exit code 0).
- **Desktop Installers (Windows)**:
  - NSIS Setup Installer: `DynoDbModeler_0.3.1_x64-setup.exe`
  - MSI Package: `DynoDbModeler_0.3.1_x64_en-US.msi`
