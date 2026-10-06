# DBeaver-Inspired Advanced Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the top high-impact features inspired by DBeaver into DynoDbModeler: Inline Editable Data Grid with cell mutation and dirty-state tracking, Cell Value Inspector, Data Import/Export wizard (CSV, JSON, SQL INSERT, Markdown), Crow's Foot ERD notations, Virtual Foreign Keys, Sticky Notes & Schema Grouping, Visual EXPLAIN Plan viewer, Query History persistence, SSH Tunneling, and DuckDB driver support.

**Architecture:** Build on DynoDbModeler's Tauri v2 + Rust backend and React 19 frontend. Extend the Rust backend with transactional row update commands, query EXPLAIN plan parsers, SSH port tunneling, local SQLite query history, and DuckDB driver adapter; expand the React frontend with an editable tabular grid, Monaco-based cell inspector, custom React Flow Crow's Foot edges, sticky notes, visual query execution tree, and export modals.

**Tech Stack:** Tauri v2, Rust 1.80+, Tokio, `sqlx`, `duckdb-rs`, `russh` / `ssh2`, React 19, TypeScript, Vite, Tailwind CSS v4, `@xyflow/react`, `@monaco-editor/react`, `lucide-react`, Vitest.

## Global Constraints

- **Language Protocol:** All code, comments, symbols, documentation, unit tests, commit messages, and schemas MUST be written strictly in English. User communication in chat MUST be in Vietnamese.
- **Documentation:** Complete Doxygen / TSDoc comments (`@brief`, `@param`, `@return`) for every struct, enum, function, interface, and React component.
- **Verification Gate:** Every task must end with automated tests passing with exit code 0 (`cargo test` / `bun test` / `bun run build`).
- **Zero Trademark Conflicts:** Use neutral, descriptive terminology throughout (e.g., "Modern Minimalist Theme", "Universal Database Management").

---

## Roadmap Overview & Phases

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Phase 1: Core Data Operations & Mutation                                               │
│  ├─ Task 1: Backend Row Update Command & Transactional Mutation                        │
│  ├─ Task 2: Frontend Inline Editable Data Grid & Dirty-Cell Tracking                   │
│  ├─ Task 3: Cell Value Inspector Drawer (JSON, XML, Long Text, Image)                  │
│  └─ Task 4: Multi-Format Data Transfer Wizard (CSV, JSON, Markdown, SQL INSERT)        │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Phase 2: Advanced ERD Modeling Engine                                                  │
│  ├─ Task 5: Crow's Foot Cardinality Edge Notations                                     │
│  ├─ Task 6: Virtual Relationships & Logical Foreign Keys                               │
│  └─ Task 7: Sticky Notes, Group Containers & Schema Filtering                          │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Phase 3: SQL Workspace & Query Optimizer                                               │
│  ├─ Task 8: Visual EXPLAIN Query Execution Plan Analyzer                               │
│  └─ Task 9: Persistent Query History & Saved Snippets                                  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Phase 4: Connectivity & Modern Analytical Drivers                                      │
│  ├─ Task 10: SSH Bastion Tunnel Port Forwarding                                        │
│  └─ Task 11: DuckDB Embedded Analytical Database Driver                                │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### Task 1: Backend Row Update Command & Transactional Mutation

**Files:**
- Modify: `src-tauri/src/driver/mod.rs`
- Modify: `src-tauri/src/driver/sqlite.rs`
- Modify: `src-tauri/src/driver/postgres.rs`
- Modify: `src-tauri/src/driver/mysql.rs`
- Modify: `src-tauri/src/driver/mssql.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/driver/mutation_test.rs`
- Create: `src-tauri/src/driver/mutation_model.rs`

**Interfaces:**
- Produces: `RowUpdatePayload { table: String, primary_keys: HashMap<String, Value>, updated_values: HashMap<String, Value> }`
- Produces: `DatabaseDriver::update_rows(&self, updates: Vec<RowUpdatePayload>) -> Result<u64, AppError>`
- Produces: Tauri command `cmd_update_rows(payload: Vec<RowUpdatePayload>) -> Result<u64, AppError>`

- [ ] **Step 1: Define `RowUpdatePayload` model and mutation test**

Create `src-tauri/src/driver/mutation_model.rs`:
```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// @brief Represents a single row mutation targeted by primary key values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RowUpdatePayload {
    /// @brief Name of the table being updated.
    pub table: String,
    /// @brief Key-value pairs identifying the unique row by primary keys.
    pub primary_keys: HashMap<String, serde_json::Value>,
    /// @brief Key-value pairs of changed columns and their new values.
    pub updated_values: HashMap<String, serde_json::Value>,
}
```

Create `src-tauri/src/driver/mutation_test.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::super::mutation_model::RowUpdatePayload;
    use crate::driver::sqlite::SqliteDriver;
    use crate::driver::DatabaseDriver;
    use std::collections::HashMap;

    #[tokio::test]
    async fn test_sqlite_row_update_transaction() {
        let driver = SqliteDriver::new(":memory:".to_string());
        driver.test_connection().await.expect("connection failed");
        driver.execute_ddl(vec![
            "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);".to_string(),
            "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@test.com');".to_string(),
        ]).await.expect("ddl failed");

        let mut pk = HashMap::new();
        pk.insert("id".to_string(), serde_json::json!(1));

        let mut updates = HashMap::new();
        updates.insert("name".to_string(), serde_json::json!("Alice Updated"));
        updates.insert("email".to_string(), serde_json::json!("new@test.com"));

        let payload = RowUpdatePayload {
            table: "users".to_string(),
            primary_keys: pk,
            updated_values: updates,
        };

        let affected = driver.update_rows(vec![payload]).await.expect("update failed");
        assert_eq!(affected, 1);

        let query_res = driver.execute_query("SELECT name, email FROM users WHERE id = 1;").await.unwrap();
        assert_eq!(query_res.rows[0][0], serde_json::json!("Alice Updated"));
        assert_eq!(query_res.rows[0][1], serde_json::json!("new@test.com"));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_sqlite_row_update_transaction`
Expected: FAIL due to missing `update_rows` on `DatabaseDriver`.

- [ ] **Step 3: Implement `update_rows` in `DatabaseDriver` trait and driver implementations**

In `src-tauri/src/driver/mod.rs`:
```rust
pub mod mutation_model;
#[cfg(test)]
pub mod mutation_test;

#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    // ... existing methods ...
    /// @brief Executes a batch of row mutations within a single transaction.
    /// @param updates List of row update payloads containing target PKs and new column values.
    /// @return Number of total affected rows.
    async fn update_rows(&self, updates: Vec<mutation_model::RowUpdatePayload>) -> Result<u64, AppError>;
}
```

Implement `update_rows` across `SqliteDriver`, `PostgresDriver`, `MySqlDriver`, and `MssqlDriver` with dialect-specific parameterized `UPDATE` statements running inside transactions.

- [ ] **Step 4: Register `cmd_update_rows` Tauri command in `src-tauri/src/commands.rs` and `lib.rs`**

```rust
/// @brief Tauri command executing transactional row mutations.
#[tauri::command]
pub async fn cmd_update_rows(
    state: tauri::State<'_, AppState>,
    updates: Vec<crate::driver::mutation_model::RowUpdatePayload>,
) -> Result<u64, AppError> {
    let guard = state.driver.read().await;
    match guard.as_ref() {
        Some(driver) => driver.update_rows(updates).await,
        None => Err(AppError::NotConnected),
    }
}
```

- [ ] **Step 5: Run tests and verify exit code 0**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS with 48/48 tests ok.

- [ ] **Step 6: Commit backend mutation support**

```bash
git add src-tauri/
git commit -m "feat(driver): implement transactional row update mutations"
```

---

### Task 2: Frontend Inline Editable Data Grid & Dirty-Cell Tracking

**Files:**
- Create: `src/components/query/EditableDataGrid.tsx`
- Create: `src/components/query/EditableDataGrid.test.tsx`
- Modify: `src/components/query/QueryEditorTab.tsx`
- Modify: `src/api/ipc.ts`

**Interfaces:**
- Consumes: `api.updateRows(updates: RowUpdatePayload[]): Promise<number>`
- Produces: `EditableDataGrid` component rendering interactive cells, dirty state highlights, and "Save Changes" mutation commit bar.

- [ ] **Step 1: Write Vitest test for dirty cell tracking and payload calculation**

Create `src/components/query/EditableDataGrid.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditableDataGrid } from './EditableDataGrid';

describe('EditableDataGrid', () => {
  const columns = ['id', 'name', 'status'];
  const rows = [
    [1, 'Order 1', 'pending'],
    [2, 'Order 2', 'completed'],
  ];

  it('renders table data and allows cell editing with dirty highlight', () => {
    const onSave = vi.fn();
    render(
      <EditableDataGrid
        tableName="orders"
        primaryKeyColumns={['id']}
        columns={columns}
        rows={rows}
        onSave={onSave}
      />
    );

    expect(screen.getByText('Order 1')).toBeDefined();
    // Double click to edit cell
    fireEvent.doubleClick(screen.getByText('Order 1'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Order 1 Renamed' } });
    fireEvent.blur(input);

    expect(screen.getByText('Order 1 Renamed')).toBeDefined();
    expect(screen.getByText(/1 unsaved change/i)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test EditableDataGrid`
Expected: FAIL with component missing.

- [ ] **Step 3: Implement `EditableDataGrid.tsx` with dirty-cell state map**

Create `src/components/query/EditableDataGrid.tsx`:
- Tracks `dirtyCells: Map<string, any>` where key is `${rowIndex}_${colIndex}`.
- Displays inline input upon double click, commits value on Enter/blur, reverts on Escape.
- Highlights modified cells with amber outline (`border-amber-500/50 bg-amber-500/10`).
- Bottom toolbar displays count of unsaved changes, "Discard" button, and "Save Changes" button.
- When "Save Changes" is clicked, computes `RowUpdatePayload` for every dirty row grouped by primary key values and calls `onSave(payloads)`.

- [ ] **Step 4: Integrate `EditableDataGrid` into `QueryEditorTab.tsx`**

Replace static table in `QueryEditorTab.tsx` with `EditableDataGrid`.

- [ ] **Step 5: Run tests and verify clean pass**

Run: `bun run test`
Expected: PASS with 100% tests passing.

- [ ] **Step 6: Commit editable data grid**

```bash
git add src/
git commit -m "feat(ui): implement inline editable data grid with dirty state tracking"
```

---

### Task 3: Cell Value Inspector Drawer (JSON, XML, Long Text, Image)

**Files:**
- Create: `src/components/query/ValueInspectorDrawer.tsx`
- Create: `src/components/query/ValueInspectorDrawer.test.tsx`
- Modify: `src/components/query/QueryEditorTab.tsx`

**Interfaces:**
- Produces: `ValueInspectorDrawer` component showing formatted JSON tree, XML highlighter, raw text length, copy button, and image preview for Base64/data URLs.

- [ ] **Step 1: Write Vitest test for JSON detection and formatting**

Create `src/components/query/ValueInspectorDrawer.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ValueInspectorDrawer } from './ValueInspectorDrawer';

describe('ValueInspectorDrawer', () => {
  it('formats valid JSON and renders editor viewer', () => {
    const rawJson = '{"key":"value","count":123}';
    render(
      <ValueInspectorDrawer
        isOpen={true}
        columnName="metadata"
        value={rawJson}
        onClose={() => {}}
      />
    );
    expect(screen.getByText(/metadata/i)).toBeDefined();
    expect(screen.getByText(/JSON/i)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test ValueInspectorDrawer`
Expected: FAIL.

- [ ] **Step 3: Implement `ValueInspectorDrawer.tsx`**

- Analyzes cell value type: detects JSON object/array, XML strings (`<xml...`), image data URIs (`data:image/...`), numbers, and long text.
- If JSON, pretty prints with indentation and provides Monaco Editor viewer in read-only mode with language `json`.
- If image, renders high-res preview image tag.
- Includes quick "Copy formatted value" and "Copy minified value" buttons.

- [ ] **Step 4: Run tests and verify pass**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 5: Commit value inspector drawer**

```bash
git add src/
git commit -m "feat(ui): implement cell value inspector drawer for JSON, XML and long text"
```

---

### Task 4: Multi-Format Data Transfer Wizard (CSV, JSON, Markdown, SQL INSERT)

**Files:**
- Create: `src/utils/dataTransfer.ts`
- Create: `src/utils/dataTransfer.test.ts`
- Create: `src/components/query/ExportModal.tsx`
- Create: `src/components/query/ExportModal.test.tsx`
- Modify: `src/components/query/QueryEditorTab.tsx`

**Interfaces:**
- Produces: `exportAsCsv(columns: string[], rows: any[][], delimiter?: string): string`
- Produces: `exportAsJson(columns: string[], rows: any[][]): string`
- Produces: `exportAsMarkdown(columns: string[], rows: any[][]): string`
- Produces: `exportAsSqlInserts(tableName: string, columns: string[], rows: any[][]): string`
- Produces: `ExportModal` dialog with preview, format picker, and file download.

- [ ] **Step 1: Write Vitest tests for all export formatters**

Create `src/utils/dataTransfer.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { exportAsCsv, exportAsJson, exportAsMarkdown, exportAsSqlInserts } from './dataTransfer';

describe('dataTransfer utility', () => {
  const cols = ['id', 'name'];
  const rows = [[1, 'Alice'], [2, 'Bob, Jr.']];

  it('escapes and formats CSV correctly', () => {
    const csv = exportAsCsv(cols, rows);
    expect(csv).toBe('id,name\n1,Alice\n2,"Bob, Jr."');
  });

  it('formats valid JSON array of objects', () => {
    const json = exportAsJson(cols, rows);
    expect(JSON.parse(json)).toEqual([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob, Jr.' },
    ]);
  });

  it('formats clean Markdown table', () => {
    const md = exportAsMarkdown(cols, rows);
    expect(md).toContain('| id | name |');
    expect(md).toContain('| 1 | Alice |');
  });

  it('generates parameterized SQL INSERT statements', () => {
    const sql = exportAsSqlInserts('users', cols, rows);
    expect(sql).toContain("INSERT INTO users (id, name) VALUES (1, 'Alice');");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test dataTransfer`
Expected: FAIL.

- [ ] **Step 3: Implement `src/utils/dataTransfer.ts` and `ExportModal.tsx`**

Implement CSV delimiter handling, quote escaping, NULL values formatting, JSON indentation, Markdown table alignment, and SQL quoting.

- [ ] **Step 4: Run tests and verify pass**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 5: Commit data transfer wizard**

```bash
git add src/
git commit -m "feat(transfer): implement multi-format data export wizard for CSV, JSON, Markdown and SQL"
```

---

### Task 5: Crow's Foot Cardinality Edge Notations

**Files:**
- Create: `src/components/canvas/CrowsFootEdge.tsx`
- Create: `src/components/canvas/CrowsFootEdge.test.tsx`
- Modify: `src/components/canvas/ErdCanvas.tsx`
- Modify: `src/types/database.ts`

**Interfaces:**
- Produces: `CardinalityType = 'one-to-one' | 'one-to-many' | 'many-to-many'`
- Produces: `CrowsFootEdge` custom React Flow edge component rendering SVG Crow's Foot end markers (`||`, `|<`, `o<`).

- [ ] **Step 1: Write Vitest test for Crow's foot cardinality path generation**

Create `src/components/canvas/CrowsFootEdge.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CrowsFootEdge } from './CrowsFootEdge';

describe('CrowsFootEdge', () => {
  it('renders SVG path with crows foot marker attributes', () => {
    const { container } = render(
      <svg>
        <CrowsFootEdge
          id="e1"
          sourceX={10}
          sourceY={10}
          targetX={100}
          targetY={100}
          sourcePosition="right" as any
          targetPosition="left" as any
          data={{ cardinality: 'one-to-many' }}
        />
      </svg>
    );
    expect(container.querySelector('path')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test CrowsFootEdge`
Expected: FAIL.

- [ ] **Step 3: Implement `CrowsFootEdge.tsx` and register edge types in `ErdCanvas.tsx`**

- Draw bezier curve connecting source and target.
- At the target end, render the classic Crow's Foot three-pronged fork symbol.
- At the source end, render double bar `||` indicating mandatory one.
- Register `edgeTypes={{ crowsFoot: CrowsFootEdge }}` in `ReactFlow` inside `ErdCanvas.tsx`.

- [ ] **Step 4: Run tests and verify pass**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 5: Commit Crow's foot edge notations**

```bash
git add src/
git commit -m "feat(erd): implement Crow's Foot cardinality edge notations"
```

---

### Task 6: Virtual Relationships & Logical Foreign Keys

**Files:**
- Modify: `src/types/database.ts`
- Modify: `src/components/canvas/ErdCanvas.tsx`
- Create: `src/utils/virtualRelations.ts`
- Create: `src/utils/virtualRelations.test.ts`

**Interfaces:**
- Produces: `VirtualRelationship { id: string, sourceTable: string, sourceColumn: string, targetTable: string, targetColumn: string, note?: string }`
- Produces: `saveVirtualRelationships(workspaceId: string, rels: VirtualRelationship[]): void`
- Produces: Option on edge context menu: "Convert Virtual Relation to Real Database Constraint".

- [ ] **Step 1: Write test for virtual relationship serialization and storage**

Create `src/utils/virtualRelations.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { saveVirtualRelationships, loadVirtualRelationships } from './virtualRelations';

describe('virtualRelations', () => {
  beforeEach(() => localStorage.clear());

  it('saves and loads virtual relations per database connection', () => {
    const rels = [{
      id: 'vr-1',
      sourceTable: 'orders',
      sourceColumn: 'customer_id',
      targetTable: 'customers',
      targetColumn: 'id',
    }];
    saveVirtualRelationships('conn-test', rels);
    expect(loadVirtualRelationships('conn-test')).toEqual(rels);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test virtualRelations`
Expected: FAIL.

- [ ] **Step 3: Implement `virtualRelations.ts` and connect canvas onConnect handler**

When a user drags from column handle to column handle on the ERD canvas, prompt modal: "Create Virtual Relationship (Diagram Only) or Physical Constraint (Generate DDL Migration)".

- [ ] **Step 4: Run tests and verify pass**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 5: Commit virtual relationships**

```bash
git add src/
git commit -m "feat(erd): support virtual relationships and logical foreign keys"
```

---

### Task 7: Sticky Notes, Group Containers & Schema Filtering

**Files:**
- Create: `src/components/canvas/StickyNoteNode.tsx`
- Create: `src/components/canvas/GroupNode.tsx`
- Modify: `src/components/canvas/ErdCanvas.tsx`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Produces: `StickyNoteNode` with editable markdown text and color swatch (yellow, blue, green, purple).
- Produces: `GroupNode` bounding container grouping related tables by domain/module.
- Produces: Drag-and-drop table from Sidebar into Canvas for selective diagramming.

- [ ] **Step 1: Write tests for StickyNoteNode and GroupNode rendering**

- [ ] **Step 2: Implement node types and register in `ErdCanvas.tsx`**

- [ ] **Step 3: Run Vitest tests and verify pass**

- [ ] **Step 4: Commit sticky notes and group containers**

```bash
git add src/
git commit -m "feat(erd): implement sticky notes and domain group containers"
```

---

### Task 8: Visual EXPLAIN Query Execution Plan Analyzer

**Files:**
- Modify: `src-tauri/src/driver/mod.rs`
- Modify: `src-tauri/src/driver/postgres.rs`
- Modify: `src-tauri/src/driver/sqlite.rs`
- Modify: `src-tauri/src/driver/mysql.rs`
- Modify: `src-tauri/src/commands.rs`
- Create: `src-tauri/src/driver/explain_test.rs`
- Create: `src/components/query/ExplainPlanModal.tsx`
- Create: `src/components/query/ExplainPlanModal.test.tsx`
- Modify: `src/components/query/QueryEditorTab.tsx`

**Interfaces:**
- Produces: `ExecutionPlanNode { node_type: String, relation_name: Option<String>, cost: f64, actual_time_ms: Option<f64>, rows: u64, children: Vec<ExecutionPlanNode> }`
- Produces: Tauri command `cmd_explain_query(query: String) -> Result<ExecutionPlanNode, AppError>`
- Produces: Visual tree UI highlighting cost bottlenecks and table scans in red/amber.

- [ ] **Step 1: Write backend tests for EXPLAIN JSON parsing across dialects**

- [ ] **Step 2: Implement `explain_query` in `DatabaseDriver` and driver adapters**

- [ ] **Step 3: Implement `ExplainPlanModal.tsx` displaying the tree graph with cost percentages**

- [ ] **Step 4: Verify with `cargo test` and `bun run test`**

- [ ] **Step 5: Commit visual EXPLAIN plan**

```bash
git add src/ src-tauri/
git commit -m "feat(query): implement visual EXPLAIN query execution plan analyzer"
```

---

### Task 9: Persistent Query History & Saved Snippets

**Files:**
- Create: `src-tauri/src/storage/mod.rs`
- Create: `src-tauri/src/storage/history.rs`
- Create: `src-tauri/src/storage/history_test.rs`
- Modify: `src-tauri/src/commands.rs`
- Create: `src/components/query/QueryHistoryModal.tsx`
- Modify: `src/components/query/QueryEditorTab.tsx`

**Interfaces:**
- Produces: `QueryHistoryRecord { id: i64, query_text: String, executed_at: String, duration_ms: u64, rows_count: u64, status: String, is_favorite: bool }`
- Produces: Commands `cmd_get_query_history()`, `cmd_toggle_favorite_query()`, `cmd_clear_history()`
- Produces: Searchable query history modal with filter by date/favorite and one-click "Re-run in Editor".

- [ ] **Step 1: Write test for history persistence in local SQLite AppData**

- [ ] **Step 2: Implement storage and Tauri commands**

- [ ] **Step 3: Implement `QueryHistoryModal.tsx` in React frontend**

- [ ] **Step 4: Run tests and verify exit code 0**

- [ ] **Step 5: Commit query history**

```bash
git add src/ src-tauri/
git commit -m "feat(history): implement persistent query history and favorite snippets"
```

---

### Task 10: SSH Bastion Tunnel Port Forwarding

**Files:**
- Create: `src-tauri/src/driver/tunnel.rs`
- Create: `src-tauri/src/driver/tunnel_test.rs`
- Modify: `src-tauri/src/model/mod.rs` (`ConnectionConfig` adds `ssh_tunnel: Option<SshTunnelConfig>`)
- Modify: `src-tauri/src/driver/factory.rs`
- Modify: `src/components/ConnectionModal.tsx`

**Interfaces:**
- Produces: `SshTunnelConfig { host: String, port: u16, user: String, auth_type: SshAuthType, private_key_path: Option<String>, passphrase: Option<String> }`
- Produces: `SshTunnel::establish(config: &SshTunnelConfig, remote_db_port: u16) -> Result<u16, AppError>` binding local loopback port.

- [ ] **Step 1: Define SSH configuration and mock test**

- [ ] **Step 2: Implement SSH tunnel lifecycle manager**

- [ ] **Step 3: Update `ConnectionModal.tsx` with "SSH Tunnel" tab**

- [ ] **Step 4: Verify compilation and tests**

- [ ] **Step 5: Commit SSH tunneling**

```bash
git add src/ src-tauri/
git commit -m "feat(network): implement SSH tunnel port forwarding for database connections"
```

---

### Task 11: DuckDB Embedded Analytical Database Driver

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `duckdb = { version = "1.1", features = ["bundled"] }`)
- Create: `src-tauri/src/driver/duckdb.rs`
- Create: `src-tauri/src/driver/duckdb_test.rs`
- Modify: `src-tauri/src/driver/factory.rs`
- Modify: `src/types/database.ts` (add `'DuckDb'` to `DatabaseType`)
- Modify: `src/components/ConnectionModal.tsx`

**Interfaces:**
- Produces: `DuckDbDriver` supporting local in-memory or `.duckdb` file paths, schema introspection via `duckdb_tables()` / `information_schema`, and fast analytical SQL queries.

- [ ] **Step 1: Add dependency and write `DuckDbDriver` tests**

- [ ] **Step 2: Implement `DuckDbDriver` and register in `DriverFactory`**

- [ ] **Step 3: Update frontend connection selector with DuckDB badge and file picker**

- [ ] **Step 4: Run full regression test suite (`bun run test` & `cargo test`)**

- [ ] **Step 5: Commit DuckDB driver**

```bash
git add src/ src-tauri/
git commit -m "feat(driver): add native DuckDB embedded analytical driver support"
```

---

## Final Verification Checklist

1. `bun run test` (All frontend Vitest unit & component tests pass).
2. `cargo test --manifest-path src-tauri/Cargo.toml` (All backend driver, diff, mutation, explain, and tunnel tests pass).
3. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` (0 warnings).
4. `bun run build` (Clean production bundling with code-split chunks).
5. `bun run tauri build` (Production release binary and installers).
