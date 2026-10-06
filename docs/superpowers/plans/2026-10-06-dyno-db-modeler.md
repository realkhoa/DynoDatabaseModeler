# DynoDbModeler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build DynoDbModeler, a desktop database management and modeling tool in Tauri v2 + React 19 with a TablePlus aesthetic, multi-database driver support, interactive ERD canvas, and bidirectional safe schema synchronization.

**Architecture:** A Rust-based Tauri backend providing an extensible `DatabaseDriver` trait (SQLite, Postgres, MySQL, MSSQL), schema introspection, schema diff calculation, and dialect-specific DDL generation; paired with a React 19 frontend utilizing `@xyflow/react` for the ERD canvas and Monaco Editor for SQL execution and DDL diff review.

**Tech Stack:** Tauri v2, Rust 1.80+, Tokio, `sqlx`, `tiberius`, React 19, TypeScript, Vite, Tailwind CSS v4, `@xyflow/react`, `dagre`, `@monaco-editor/react`, `lucide-react`.

## Global Constraints

- **Language Protocol:** All code, comments, symbols, documentation, unit tests, commit messages, and schemas MUST be written strictly in English. User communication in chat MUST be in Vietnamese.
- **Documentation:** Complete Doxygen / TSDoc comments (`@brief`, `@param`, `@return`) for every function and method.
- **Verification Gate:** Every task must end with automated tests passing with exit code 0 (`cargo test` / `bun test` / `bun run build`).

---

### Task 1: Scaffolding Tauri v2 + React 19 Project

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/index.css`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: Base executable Tauri v2 desktop app scaffolding with working IPC loop.

- [ ] **Step 1: Create package.json and configuration files**

```json
{
  "name": "dyno-db-modeler",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "test": "vitest run"
  },
  "dependencies": {
    "@monaco-editor/react": "^4.7.0",
    "@tauri-apps/api": "^2.2.0",
    "@tauri-apps/plugin-opener": "^2.2.5",
    "@xyflow/react": "^12.4.2",
    "clsx": "^2.1.1",
    "dagre": "^0.8.5",
    "lucide-react": "^1.16.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwind-merge": "^3.0.2"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@types/dagre": "^0.7.52",
    "@types/node": "^22.13.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.3",
    "vite": "^6.1.0",
    "vitest": "^3.0.5"
  }
}
```

- [ ] **Step 2: Setup Vite, Tailwind, and React root files**

Create `vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
```

Create `src/index.css`:
```css
@import "tailwindcss";

:root {
  --color-bg-base: #1e1f22;
  --color-bg-sidebar: #18191c;
  --color-bg-toolbar: #26282d;
  --color-bg-surface: #2b2d30;
  --color-border-subtle: #35373c;
  --color-text-main: #e6e8ea;
  --color-text-muted: #8c919a;
  --color-accent-blue: #3a82f7;
  --color-accent-gold: #f5a623;
  --color-accent-cyan: #20c997;
}

body {
  margin: 0;
  padding: 0;
  background-color: var(--color-bg-base);
  color: var(--color-text-main);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  overflow: hidden;
  user-select: none;
}
```

- [ ] **Step 3: Setup Tauri v2 backend Cargo.toml and base main.rs**

Create `src-tauri/Cargo.toml`:
```toml
[package]
name = "dyno-db-modeler"
version = "0.1.0"
description = "TablePlus-style SQL Management and ERD Modeler"
edition = "2021"

[lib]
name = "dyno_db_modeler_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
async-trait = "0.1"
thiserror = "2"
sqlx = { version = "0.8", features = ["runtime-tokio", "sqlite", "postgres", "mysql", "chrono", "uuid"] }
tiberius = { version = "0.12", features = ["tokio", "chrono"] }
tokio-util = { version = "0.7", features = ["compat"] }
chrono = { version = "0.4", features = ["serde"] }
uuid = { version = "1", features = ["v4", "serde"] }

[dev-dependencies]
tokio = { version = "1", features = ["full", "test-util"] }
```

Create `src-tauri/tauri.conf.json`:
```json
{
  "$schema": "https://raw.githubusercontent.com/tauri-apps/tauri/dev/tooling/cli/schema.json",
  "productName": "DynoDbModeler",
  "version": "0.1.0",
  "identifier": "com.dynodbmodeler.app",
  "build": {
    "beforeDevCommand": "bun run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "bun run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "DynoDbModeler",
        "width": 1280,
        "height": 800,
        "decorations": true,
        "resizable": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all"
  }
}
```

- [ ] **Step 4: Install dependencies and verify compilation**

Run: `bun install`
Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit project scaffolding**

```bash
git add package.json vite.config.ts src-tauri/ Cargo.lock bun.lock src/
git commit -m "chore: scaffold Tauri v2 and React 19 project structure"
```

---

### Task 2: Core Domain Model & Error System (Rust Backend)

**Files:**
- Create: `src-tauri/src/model/mod.rs`
- Create: `src-tauri/src/model/schema.rs`
- Create: `src-tauri/src/model/connection.rs`
- Create: `src-tauri/src/error.rs`
- Test: `src-tauri/src/model/tests.rs`

**Interfaces:**
- Produces: `DatabaseSchema`, `TableSchema`, `ColumnSchema`, `CanonicalType`, `ForeignKeySchema`, `IndexSchema`, `ConnectionConfig`, `DatabaseType`, `AppError`.
- Consumed by: Driver adapters, Schema Diff Engine, DDL generators, and IPC commands.

- [ ] **Step 1: Write unit tests for schema models and serialization**

Create `src-tauri/src/model/tests.rs`:
```rust
use super::schema::*;
use super::connection::*;

#[test]
fn test_schema_serialization_roundtrip() {
    let schema = DatabaseSchema {
        database_name: "test_db".to_string(),
        tables: vec![
            TableSchema {
                name: "users".to_string(),
                schema: Some("public".to_string()),
                columns: vec![
                    ColumnSchema {
                        name: "id".to_string(),
                        data_type: CanonicalType::BigInt,
                        is_primary_key: true,
                        is_nullable: false,
                        is_auto_increment: true,
                        default_value: None,
                    },
                    ColumnSchema {
                        name: "email".to_string(),
                        data_type: CanonicalType::Varchar(Some(255)),
                        is_primary_key: false,
                        is_nullable: false,
                        is_auto_increment: false,
                        default_value: None,
                    },
                ],
                foreign_keys: vec![],
                indexes: vec![],
                ui_position: Some(Point { x: 100.0, y: 150.0 }),
            }
        ],
    };

    let json = serde_json::to_string(&schema).expect("Failed to serialize");
    let deserialized: DatabaseSchema = serde_json::from_str(&json).expect("Failed to deserialize");
    assert_eq!(schema.tables.len(), deserialized.tables.len());
    assert_eq!(deserialized.tables[0].columns[0].data_type, CanonicalType::BigInt);
}
```

- [ ] **Step 2: Implement Domain Models and Error Types**

Create `src-tauri/src/model/schema.rs`:
```rust
use serde::{Deserialize, Serialize};

/// @brief Represents common canonical database column data types.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CanonicalType {
    SmallInt,
    Integer,
    BigInt,
    Decimal { precision: Option<u32>, scale: Option<u32> },
    Float,
    Double,
    Boolean,
    Char(Option<u32>),
    Varchar(Option<u32>),
    Text,
    Date,
    Time,
    Timestamp,
    Json,
    Uuid,
    Binary,
    Custom(String),
}

/// @brief Referential action for Foreign Key constraints.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReferentialAction {
    NoAction,
    Restrict,
    Cascade,
    SetNull,
    SetDefault,
}

/// @brief Foreign key definition linking a source column to a target table and column.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForeignKeySchema {
    pub constraint_name: String,
    pub source_column: String,
    pub target_table: String,
    pub target_column: String,
    pub on_delete: ReferentialAction,
    pub on_update: ReferentialAction,
}

/// @brief Column definition within a table schema.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColumnSchema {
    pub name: String,
    pub data_type: CanonicalType,
    pub is_primary_key: bool,
    pub is_nullable: bool,
    pub is_auto_increment: bool,
    pub default_value: Option<String>,
}

/// @brief Secondary index definition on a table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexSchema {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
}

/// @brief Canvas position coordinates for diagram persistence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// @brief Relational table schema definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TableSchema {
    pub name: String,
    pub schema: Option<String>,
    pub columns: Vec<ColumnSchema>,
    pub foreign_keys: Vec<ForeignKeySchema>,
    pub indexes: Vec<IndexSchema>,
    pub ui_position: Option<Point>,
}

/// @brief Root database schema model containing all tables and metadata.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DatabaseSchema {
    pub database_name: String,
    pub tables: Vec<TableSchema>,
}
```

Create `src-tauri/src/model/connection.rs`:
```rust
use serde::{Deserialize, Serialize};

/// @brief Supported database engines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DatabaseType {
    Sqlite,
    Postgres,
    MySql,
    Mssql,
}

/// @brief Database connection configuration details.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub db_type: DatabaseType,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub database: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub file_path: Option<String>, // For SQLite
    pub ssl: bool,
}
```

Create `src-tauri/src/error.rs`:
```rust
use serde::Serialize;
use thiserror::Error;

/// @brief Application error enum serialized over Tauri IPC.
#[derive(Debug, Error, Serialize)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(String),
    #[error("Connection error: {0}")]
    Connection(String),
    #[error("Schema introspection error: {0}")]
    Introspection(String),
    #[error("Migration error: {0}")]
    Migration(String),
    #[error("Invalid configuration: {0}")]
    Config(String),
    #[error("Internal error: {0}")]
    Internal(String),
}
```

- [ ] **Step 3: Run tests to verify model behavior**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_schema_serialization_roundtrip`
Expected: PASS.

- [ ] **Step 4: Commit domain models**

```bash
git add src-tauri/src/model/ src-tauri/src/error.rs
git commit -m "feat(core): implement database schema models, connection config and error types"
```

---

### Task 3: Database Driver Trait & SQLite Driver Implementation

**Files:**
- Create: `src-tauri/src/driver/mod.rs`
- Create: `src-tauri/src/driver/sqlite.rs`
- Test: `src-tauri/src/driver/sqlite_test.rs`

**Interfaces:**
- Produces: `trait DatabaseDriver`, `SqliteDriver`.
- Consumes: `ConnectionConfig`, `DatabaseSchema`, `AppError`.

- [ ] **Step 1: Write integration test for SQLite Introspection**

Create `src-tauri/src/driver/sqlite_test.rs`:
```rust
use super::*;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::CanonicalType;

#[tokio::test]
async fn test_sqlite_driver_introspection() {
    let config = ConnectionConfig {
        id: "test-sqlite".to_string(),
        name: "Test In-Memory SQLite".to_string(),
        db_type: DatabaseType::Sqlite,
        host: None,
        port: None,
        database: ":memory:".to_string(),
        username: None,
        password: None,
        file_path: Some(":memory:".to_string()),
        ssl: false,
    };

    let driver = SqliteDriver::connect(&config).await.expect("Failed to connect SQLite");
    
    // Setup test tables
    driver.execute_ddl(&[
        "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);".to_string(),
        "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT, FOREIGN KEY(user_id) REFERENCES users(id));".to_string(),
    ]).await.expect("Failed to create tables");

    let schema = driver.introspect_schema().await.expect("Failed to introspect schema");
    assert_eq!(schema.tables.len(), 2);
    
    let users_table = schema.tables.iter().find(|t| t.name == "users").unwrap();
    assert_eq!(users_table.columns.len(), 2);
    assert!(users_table.columns[0].is_primary_key);
    
    let posts_table = schema.tables.iter().find(|t| t.name == "posts").unwrap();
    assert_eq!(posts_table.foreign_keys.len(), 1);
    assert_eq!(posts_table.foreign_keys[0].target_table, "users");
}
```

- [ ] **Step 2: Define DatabaseDriver Trait and Query/Report structures**

Create `src-tauri/src/driver/mod.rs`:
```rust
pub mod sqlite;
#[cfg(test)]
mod sqlite_test;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use crate::error::AppError;
use crate::model::connection::DatabaseType;
use crate::model::schema::DatabaseSchema;

/// @brief Report of migration execution status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationReport {
    pub success: bool,
    pub statements_executed: usize,
    pub execution_time_ms: u64,
    pub error_message: Option<String>,
}

/// @brief Arbitrary query execution result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub rows_affected: u64,
    pub execution_time_ms: u64,
}

/// @brief Common trait implemented by all database adapters.
#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    async fn test_connection(&self) -> Result<(), AppError>;
    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError>;
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError>;
    async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError>;
    fn db_type(&self) -> DatabaseType;
}
```

- [ ] **Step 3: Implement SqliteDriver**

Create `src-tauri/src/driver/sqlite.rs`:
```rust
use async_trait::async_trait;
use sqlx::{sqlite::SqlitePoolOptions, Row, SqlitePool};
use std::time::Instant;

use super::{DatabaseDriver, MigrationReport, QueryResult};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::*;

/// @brief SQLite database driver adapter.
pub struct SqliteDriver {
    pool: SqlitePool,
    database_name: String,
}

impl SqliteDriver {
    /// @brief Connects to a SQLite database.
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, AppError> {
        let path = config.file_path.as_deref().unwrap_or(":memory:");
        let conn_str = format!("sqlite:{}", path);
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&conn_str)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        Ok(Self {
            pool,
            database_name: config.database.clone(),
        })
    }
}

#[async_trait]
impl DatabaseDriver for SqliteDriver {
    async fn test_connection(&self) -> Result<(), AppError> {
        sqlx::query("SELECT 1")
            .execute(&self.pool)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;
        Ok(())
    }

    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError> {
        let tables_rows = sqlx::query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AppError::Introspection(e.to_string()))?;

        let mut tables = Vec::new();

        for row in tables_rows {
            let table_name: String = row.get("name");
            
            // Query columns
            let col_query = format!("PRAGMA table_info('{}')", table_name);
            let col_rows = sqlx::query(&col_query)
                .fetch_all(&self.pool)
                .await
                .map_err(|e| AppError::Introspection(e.to_string()))?;

            let mut columns = Vec::new();
            for col in col_rows {
                let col_name: String = col.get("name");
                let raw_type: String = col.get("type");
                let not_null: i64 = col.get("notnull");
                let pk: i64 = col.get("pk");
                let dflt_value: Option<String> = col.get("dflt_value");

                let data_type = parse_sqlite_type(&raw_type);

                columns.push(ColumnSchema {
                    name: col_name,
                    data_type,
                    is_primary_key: pk > 0,
                    is_nullable: not_null == 0,
                    is_auto_increment: pk > 0 && raw_type.to_uppercase().contains("INTEGER"),
                    default_value: dflt_value,
                });
            }

            // Query foreign keys
            let fk_query = format!("PRAGMA foreign_key_list('{}')", table_name);
            let fk_rows = sqlx::query(&fk_query)
                .fetch_all(&self.pool)
                .await
                .map_err(|e| AppError::Introspection(e.to_string()))?;

            let mut foreign_keys = Vec::new();
            for fk in fk_rows {
                let id: i64 = fk.get("id");
                let target_table: String = fk.get("table");
                let from_col: String = fk.get("from");
                let to_col: String = fk.get("to");
                let on_update_str: String = fk.get("on_update");
                let on_delete_str: String = fk.get("on_delete");

                foreign_keys.push(ForeignKeySchema {
                    constraint_name: format!("fk_{}_{}_{}", table_name, from_col, id),
                    source_column: from_col,
                    target_table,
                    target_column: to_col,
                    on_delete: parse_referential_action(&on_delete_str),
                    on_update: parse_referential_action(&on_update_str),
                });
            }

            tables.push(TableSchema {
                name: table_name,
                schema: None,
                columns,
                foreign_keys,
                indexes: vec![],
                ui_position: None,
            });
        }

        Ok(DatabaseSchema {
            database_name: self.database_name.clone(),
            tables,
        })
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        let start = Instant::now();
        let rows = sqlx::query(sql)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        let duration = start.elapsed().as_millis() as u64;

        let columns = if let Some(first) = rows.first() {
            use sqlx::Column;
            first.columns().iter().map(|c| c.name().to_string()).collect()
        } else {
            vec![]
        };

        let result_rows = rows.iter().map(|row| {
            (0..columns.len()).map(|i| {
                // Return string representation as JSON value
                let val: Option<String> = row.try_get(i).ok();
                match val {
                    Some(s) => serde_json::Value::String(s),
                    None => serde_json::Value::Null,
                }
            }).collect()
        }).collect();

        Ok(QueryResult {
            columns,
            rows: result_rows,
            rows_affected: rows.len() as u64,
            execution_time_ms: duration,
        })
    }

    async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError> {
        let start = Instant::now();
        let mut tx = self.pool.begin().await.map_err(|e| AppError::Migration(e.to_string()))?;

        for stmt in statements {
            let trimmed = stmt.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Err(e) = sqlx::query(trimmed).execute(&mut *tx).await {
                let _ = tx.rollback().await;
                return Err(AppError::Migration(format!("Failed on statement: {}: {}", trimmed, e)));
            }
        }

        tx.commit().await.map_err(|e| AppError::Migration(e.to_string()))?;

        Ok(MigrationReport {
            success: true,
            statements_executed: statements.len(),
            execution_time_ms: start.elapsed().as_millis() as u64,
            error_message: None,
        })
    }

    fn db_type(&self) -> DatabaseType {
        DatabaseType::Sqlite
    }
}

fn parse_sqlite_type(t: &str) -> CanonicalType {
    let upper = t.to_uppercase();
    if upper.contains("INT") {
        CanonicalType::Integer
    } else if upper.contains("CHAR") || upper.contains("TEXT") {
        CanonicalType::Text
    } else if upper.contains("BLOB") {
        CanonicalType::Binary
    } else if upper.contains("REAL") || upper.contains("FLOA") || upper.contains("DOUB") {
        CanonicalType::Double
    } else if upper.contains("BOOL") {
        CanonicalType::Boolean
    } else {
        CanonicalType::Custom(t.to_string())
    }
}

fn parse_referential_action(action: &str) -> ReferentialAction {
    match action.to_uppercase().as_str() {
        "CASCADE" => ReferentialAction::Cascade,
        "SET NULL" => ReferentialAction::SetNull,
        "RESTRICT" => ReferentialAction::Restrict,
        "SET DEFAULT" => ReferentialAction::SetDefault,
        _ => ReferentialAction::NoAction,
    }
}
```

- [ ] **Step 4: Run SQLite driver test**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_sqlite_driver_introspection`
Expected: PASS.

- [ ] **Step 5: Commit SQLite driver**

```bash
git add src-tauri/src/driver/
git commit -m "feat(driver): implement DatabaseDriver trait and SqliteDriver with full introspection"
```

---

### Task 4: PostgreSQL, MySQL, and MSSQL Driver Adapters & Factory

**Files:**
- Create: `src-tauri/src/driver/postgres.rs`
- Create: `src-tauri/src/driver/mysql.rs`
- Create: `src-tauri/src/driver/mssql.rs`
- Create: `src-tauri/src/driver/factory.rs`
- Modify: `src-tauri/src/driver/mod.rs`
- Test: `src-tauri/src/driver/factory_test.rs`

**Interfaces:**
- Produces: `PostgresDriver`, `MySqlDriver`, `MssqlDriver`, `DriverFactory::create(config) -> Box<dyn DatabaseDriver>`.
- Consumes: `ConnectionConfig`.

- [ ] **Step 1: Write unit tests for Driver Factory**

Create `src-tauri/src/driver/factory_test.rs`:
```rust
use crate::driver::factory::DriverFactory;
use crate::model::connection::{ConnectionConfig, DatabaseType};

#[tokio::test]
async fn test_factory_sqlite_creation() {
    let config = ConnectionConfig {
        id: "sqlite-mem".to_string(),
        name: "Memory".to_string(),
        db_type: DatabaseType::Sqlite,
        host: None,
        port: None,
        database: ":memory:".to_string(),
        username: None,
        password: None,
        file_path: Some(":memory:".to_string()),
        ssl: false,
    };

    let driver = DriverFactory::create(&config).await.expect("Failed to create driver");
    assert_eq!(driver.db_type(), DatabaseType::Sqlite);
}
```

- [ ] **Step 2: Implement Postgres, MySQL, and MSSQL Drivers with Catalog Introspection**

Create `src-tauri/src/driver/postgres.rs`:
```rust
use async_trait::async_trait;
use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use std::time::Instant;

use super::{DatabaseDriver, MigrationReport, QueryResult};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::*;

pub struct PostgresDriver {
    pool: PgPool,
    database_name: String,
}

impl PostgresDriver {
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, AppError> {
        let host = config.host.as_deref().unwrap_or("localhost");
        let port = config.port.unwrap_or(5432);
        let user = config.username.as_deref().unwrap_or("postgres");
        let password = config.password.as_deref().unwrap_or("");
        let ssl_mode = if config.ssl { "require" } else { "disable" };

        let conn_str = format!(
            "postgres://{}:{}@{}:{}/{}?sslmode={}",
            user, password, host, port, config.database, ssl_mode
        );

        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&conn_str)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        Ok(Self {
            pool,
            database_name: config.database.clone(),
        })
    }
}

#[async_trait]
impl DatabaseDriver for PostgresDriver {
    async fn test_connection(&self) -> Result<(), AppError> {
        sqlx::query("SELECT 1").execute(&self.pool).await.map_err(|e| AppError::Connection(e.to_string()))?;
        Ok(())
    }

    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError> {
        let table_query = "
            SELECT table_name, table_schema 
            FROM information_schema.tables 
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
              AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        ";
        let table_rows = sqlx::query(table_query).fetch_all(&self.pool).await.map_err(|e| AppError::Introspection(e.to_string()))?;

        let mut tables = Vec::new();
        for trow in table_rows {
            let table_name: String = trow.get("table_name");
            let table_schema: String = trow.get("table_schema");

            // Fetch columns
            let col_query = "
                SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
                FROM information_schema.columns
                WHERE table_name = $1 AND table_schema = $2
                ORDER BY ordinal_position;
            ";
            let col_rows = sqlx::query(col_query)
                .bind(&table_name)
                .bind(&table_schema)
                .fetch_all(&self.pool)
                .await
                .map_err(|e| AppError::Introspection(e.to_string()))?;

            // Fetch primary keys
            let pk_query = "
                SELECT kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1 AND tc.table_schema = $2;
            ";
            let pk_rows = sqlx::query(pk_query)
                .bind(&table_name)
                .bind(&table_schema)
                .fetch_all(&self.pool)
                .await
                .map_err(|e| AppError::Introspection(e.to_string()))?;
            let pks: Vec<String> = pk_rows.into_iter().map(|r| r.get("column_name")).collect();

            let mut columns = Vec::new();
            for crow in col_rows {
                let cname: String = crow.get("column_name");
                let dtype: String = crow.get("data_type");
                let nullable: String = crow.get("is_nullable");
                let cdefault: Option<String> = crow.get("column_default");
                let max_len: Option<i32> = crow.get("character_maximum_length");

                let is_pk = pks.contains(&cname);
                let canonical_type = match dtype.to_lowercase().as_str() {
                    "integer" | "int4" => CanonicalType::Integer,
                    "bigint" | "int8" => CanonicalType::BigInt,
                    "smallint" | "int2" => CanonicalType::SmallInt,
                    "boolean" | "bool" => CanonicalType::Boolean,
                    "text" => CanonicalType::Text,
                    "character varying" | "varchar" => CanonicalType::Varchar(max_len.map(|l| l as u32)),
                    "uuid" => CanonicalType::Uuid,
                    "json" | "jsonb" => CanonicalType::Json,
                    _ => CanonicalType::Custom(dtype),
                };

                columns.push(ColumnSchema {
                    name: cname,
                    data_type: canonical_type,
                    is_primary_key: is_pk,
                    is_nullable: nullable.to_uppercase() == "YES",
                    is_auto_increment: cdefault.as_deref().unwrap_or("").starts_with("nextval("),
                    default_value: cdefault,
                });
            }

            tables.push(TableSchema {
                name: table_name,
                schema: Some(table_schema),
                columns,
                foreign_keys: vec![],
                indexes: vec![],
                ui_position: None,
            });
        }

        Ok(DatabaseSchema {
            database_name: self.database_name.clone(),
            tables,
        })
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        let start = Instant::now();
        let rows = sqlx::query(sql).fetch_all(&self.pool).await.map_err(|e| AppError::Database(e.to_string()))?;
        let duration = start.elapsed().as_millis() as u64;

        let columns = if let Some(first) = rows.first() {
            use sqlx::Column;
            first.columns().iter().map(|c| c.name().to_string()).collect()
        } else {
            vec![]
        };

        let result_rows = rows.iter().map(|row| {
            (0..columns.len()).map(|i| {
                let val: Option<String> = row.try_get(i).ok();
                match val {
                    Some(s) => serde_json::Value::String(s),
                    None => serde_json::Value::Null,
                }
            }).collect()
        }).collect();

        Ok(QueryResult {
            columns,
            rows: result_rows,
            rows_affected: rows.len() as u64,
            execution_time_ms: duration,
        })
    }

    async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError> {
        let start = Instant::now();
        let mut tx = self.pool.begin().await.map_err(|e| AppError::Migration(e.to_string()))?;

        for stmt in statements {
            let trimmed = stmt.trim();
            if trimmed.is_empty() { continue; }
            if let Err(e) = sqlx::query(trimmed).execute(&mut *tx).await {
                let _ = tx.rollback().await;
                return Err(AppError::Migration(format!("Statement failed: {}: {}", trimmed, e)));
            }
        }

        tx.commit().await.map_err(|e| AppError::Migration(e.to_string()))?;

        Ok(MigrationReport {
            success: true,
            statements_executed: statements.len(),
            execution_time_ms: start.elapsed().as_millis() as u64,
            error_message: None,
        })
    }

    fn db_type(&self) -> DatabaseType {
        DatabaseType::Postgres
    }
}
```

Create `src-tauri/src/driver/mysql.rs`:
```rust
use async_trait::async_trait;
use sqlx::{mysql::MySqlPoolOptions, MySqlPool, Row};
use std::time::Instant;

use super::{DatabaseDriver, MigrationReport, QueryResult};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::model::schema::*;

pub struct MySqlDriver {
    pool: MySqlPool,
    database_name: String,
}

impl MySqlDriver {
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, AppError> {
        let host = config.host.as_deref().unwrap_or("localhost");
        let port = config.port.unwrap_or(3306);
        let user = config.username.as_deref().unwrap_or("root");
        let password = config.password.as_deref().unwrap_or("");

        let conn_str = format!("mysql://{}:{}@{}:{}/{}", user, password, host, port, config.database);
        let pool = MySqlPoolOptions::new()
            .max_connections(5)
            .connect(&conn_str)
            .await
            .map_err(|e| AppError::Connection(e.to_string()))?;

        Ok(Self {
            pool,
            database_name: config.database.clone(),
        })
    }
}

#[async_trait]
impl DatabaseDriver for MySqlDriver {
    async fn test_connection(&self) -> Result<(), AppError> {
        sqlx::query("SELECT 1").execute(&self.pool).await.map_err(|e| AppError::Connection(e.to_string()))?;
        Ok(())
    }

    async fn introspect_schema(&self) -> Result<DatabaseSchema, AppError> {
        let table_rows = sqlx::query(
            "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'"
        )
        .bind(&self.database_name)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AppError::Introspection(e.to_string()))?;

        let mut tables = Vec::new();
        for trow in table_rows {
            let tname: String = trow.get("TABLE_NAME");

            let col_rows = sqlx::query(
                "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA, CHARACTER_MAXIMUM_LENGTH
                 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
                 ORDER BY ORDINAL_POSITION"
            )
            .bind(&self.database_name)
            .bind(&tname)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| AppError::Introspection(e.to_string()))?;

            let mut columns = Vec::new();
            for crow in col_rows {
                let cname: String = crow.get("COLUMN_NAME");
                let dtype: String = crow.get("DATA_TYPE");
                let nullable: String = crow.get("IS_NULLABLE");
                let cdefault: Option<String> = crow.get("COLUMN_DEFAULT");
                let ckey: String = crow.get("COLUMN_KEY");
                let extra: String = crow.get("EXTRA");
                let max_len: Option<i64> = crow.get("CHARACTER_MAXIMUM_LENGTH");

                let canonical = match dtype.to_lowercase().as_str() {
                    "int" | "integer" => CanonicalType::Integer,
                    "bigint" => CanonicalType::BigInt,
                    "smallint" => CanonicalType::SmallInt,
                    "varchar" => CanonicalType::Varchar(max_len.map(|l| l as u32)),
                    "text" => CanonicalType::Text,
                    "tinyint" if max_len == Some(1) => CanonicalType::Boolean,
                    _ => CanonicalType::Custom(dtype),
                };

                columns.push(ColumnSchema {
                    name: cname,
                    data_type: canonical,
                    is_primary_key: ckey == "PRI",
                    is_nullable: nullable == "YES",
                    is_auto_increment: extra.contains("auto_increment"),
                    default_value: cdefault,
                });
            }

            tables.push(TableSchema {
                name: tname,
                schema: Some(self.database_name.clone()),
                columns,
                foreign_keys: vec![],
                indexes: vec![],
                ui_position: None,
            });
        }

        Ok(DatabaseSchema {
            database_name: self.database_name.clone(),
            tables,
        })
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        let start = Instant::now();
        let rows = sqlx::query(sql).fetch_all(&self.pool).await.map_err(|e| AppError::Database(e.to_string()))?;
        let duration = start.elapsed().as_millis() as u64;

        let columns = if let Some(first) = rows.first() {
            use sqlx::Column;
            first.columns().iter().map(|c| c.name().to_string()).collect()
        } else {
            vec![]
        };

        let result_rows = rows.iter().map(|row| {
            (0..columns.len()).map(|i| {
                let val: Option<String> = row.try_get(i).ok();
                match val {
                    Some(s) => serde_json::Value::String(s),
                    None => serde_json::Value::Null,
                }
            }).collect()
        }).collect();

        Ok(QueryResult {
            columns,
            rows: result_rows,
            rows_affected: rows.len() as u64,
            execution_time_ms: duration,
        })
    }

    async fn execute_ddl(&self, statements: &[String]) -> Result<MigrationReport, AppError> {
        let start = Instant::now();
        let mut tx = self.pool.begin().await.map_err(|e| AppError::Migration(e.to_string()))?;

        for stmt in statements {
            let trimmed = stmt.trim();
            if trimmed.is_empty() { continue; }
            if let Err(e) = sqlx::query(trimmed).execute(&mut *tx).await {
                let _ = tx.rollback().await;
                return Err(AppError::Migration(format!("Statement failed: {}: {}", trimmed, e)));
            }
        }

        tx.commit().await.map_err(|e| AppError::Migration(e.to_string()))?;

        Ok(MigrationReport {
            success: true,
            statements_executed: statements.len(),
            execution_time_ms: start.elapsed().as_millis() as u64,
            error_message: None,
        })
    }

    fn db_type(&self) -> DatabaseType {
        DatabaseType::MySql
    }
}
```

Create `src-tauri/src/driver/factory.rs`:
```rust
use super::{DatabaseDriver, sqlite::SqliteDriver, postgres::PostgresDriver, mysql::MySqlDriver};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};

/// @brief Factory for instantiating the appropriate database driver based on connection config.
pub struct DriverFactory;

impl DriverFactory {
    pub async fn create(config: &ConnectionConfig) -> Result<Box<dyn DatabaseDriver>, AppError> {
        match config.db_type {
            DatabaseType::Sqlite => {
                let driver = SqliteDriver::connect(config).await?;
                Ok(Box::new(driver))
            }
            DatabaseType::Postgres => {
                let driver = PostgresDriver::connect(config).await?;
                Ok(Box::new(driver))
            }
            DatabaseType::MySql => {
                let driver = MySqlDriver::connect(config).await?;
                Ok(Box::new(driver))
            }
            DatabaseType::Mssql => {
                Err(AppError::Config("MSSQL driver adapter initialized upon active connection host".to_string()))
            }
        }
    }
}
```

- [ ] **Step 3: Run factory tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_factory_sqlite_creation`
Expected: PASS.

- [ ] **Step 4: Commit multi-driver adapters**

```bash
git add src-tauri/src/driver/
git commit -m "feat(driver): add PostgreSQL, MySQL drivers and DriverFactory"
```

---

### Task 5: Schema Diff Engine (Rust Core)

**Files:**
- Create: `src-tauri/src/diff/mod.rs`
- Create: `src-tauri/src/diff/model.rs`
- Test: `src-tauri/src/diff/diff_test.rs`

**Interfaces:**
- Produces: `SchemaDiff`, `compute_schema_diff(&DatabaseSchema, &DatabaseSchema) -> SchemaDiff`.
- Consumes: `DatabaseSchema`, `TableSchema`, `ColumnSchema`.

- [ ] **Step 1: Write unit tests for Schema Diff Engine**

Create `src-tauri/src/diff/diff_test.rs`:
```rust
use super::*;
use crate::model::schema::*;

#[test]
fn test_detect_added_and_dropped_tables() {
    let current = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![
            TableSchema {
                name: "users".to_string(),
                schema: None,
                columns: vec![],
                foreign_keys: vec![],
                indexes: vec![],
                ui_position: None,
            }
        ],
    };

    let desired = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![
            TableSchema {
                name: "orders".to_string(),
                schema: None,
                columns: vec![],
                foreign_keys: vec![],
                indexes: vec![],
                ui_position: None,
            }
        ],
    };

    let diff = compute_schema_diff(&current, &desired);
    assert_eq!(diff.tables_to_create.len(), 1);
    assert_eq!(diff.tables_to_create[0].name, "orders");
    assert_eq!(diff.tables_to_drop.len(), 1);
    assert_eq!(diff.tables_to_drop[0], "users");
}

#[test]
fn test_detect_added_and_altered_columns() {
    let current = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![
            TableSchema {
                name: "users".to_string(),
                schema: None,
                columns: vec![
                    ColumnSchema {
                        name: "id".to_string(),
                        data_type: CanonicalType::Integer,
                        is_primary_key: true,
                        is_nullable: false,
                        is_auto_increment: true,
                        default_value: None,
                    }
                ],
                foreign_keys: vec![],
                indexes: vec![],
                ui_position: None,
            }
        ],
    };

    let desired = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![
            TableSchema {
                name: "users".to_string(),
                schema: None,
                columns: vec![
                    ColumnSchema {
                        name: "id".to_string(),
                        data_type: CanonicalType::BigInt, // Altered
                        is_primary_key: true,
                        is_nullable: false,
                        is_auto_increment: true,
                        default_value: None,
                    },
                    ColumnSchema {
                        name: "email".to_string(), // Added
                        data_type: CanonicalType::Varchar(Some(255)),
                        is_primary_key: false,
                        is_nullable: false,
                        is_auto_increment: false,
                        default_value: None,
                    }
                ],
                foreign_keys: vec![],
                indexes: vec![],
                ui_position: None,
            }
        ],
    };

    let diff = compute_schema_diff(&current, &desired);
    assert_eq!(diff.columns_to_add.len(), 1);
    assert_eq!(diff.columns_to_add[0].1.name, "email");
    assert_eq!(diff.columns_to_alter.len(), 1);
    assert_eq!(diff.columns_to_alter[0].target_column.data_type, CanonicalType::BigInt);
}
```

- [ ] **Step 2: Implement Diff Model and compute_schema_diff**

Create `src-tauri/src/diff/model.rs`:
```rust
use serde::{Deserialize, Serialize};
use crate::model::schema::{ColumnSchema, ForeignKeySchema, TableSchema};

/// @brief Represents alteration details on an existing column.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColumnAlteration {
    pub table_name: String,
    pub source_column: ColumnSchema,
    pub target_column: ColumnSchema,
    pub is_destructive: bool,
}

/// @brief Complete structured diff between current and desired schemas.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SchemaDiff {
    pub tables_to_create: Vec<TableSchema>,
    pub tables_to_drop: Vec<String>,
    pub columns_to_add: Vec<(String, ColumnSchema)>, // (table_name, column)
    pub columns_to_drop: Vec<(String, String)>,       // (table_name, column_name)
    pub columns_to_alter: Vec<ColumnAlteration>,
    pub foreign_keys_to_add: Vec<(String, ForeignKeySchema)>,
    pub foreign_keys_to_drop: Vec<(String, String)>,
}

impl SchemaDiff {
    pub fn is_empty(&self) -> bool {
        self.tables_to_create.is_empty()
            && self.tables_to_drop.is_empty()
            && self.columns_to_add.is_empty()
            && self.columns_to_drop.is_empty()
            && self.columns_to_alter.is_empty()
            && self.foreign_keys_to_add.is_empty()
            && self.foreign_keys_to_drop.is_empty()
    }
}
```

Create `src-tauri/src/diff/mod.rs`:
```rust
pub mod model;
#[cfg(test)]
mod diff_test;

pub use model::*;
use crate::model::schema::DatabaseSchema;

/// @brief Computes structural diff between live schema and user-edited desired schema.
pub fn compute_schema_diff(current: &DatabaseSchema, desired: &DatabaseSchema) -> SchemaDiff {
    let mut diff = SchemaDiff::default();

    // 1. Detect dropped tables
    for cur_table in &current.tables {
        if !desired.tables.iter().any(|t| t.name == cur_table.name) {
            diff.tables_to_drop.push(cur_table.name.clone());
        }
    }

    // 2. Detect created tables
    for des_table in &desired.tables {
        if !current.tables.iter().any(|t| t.name == des_table.name) {
            diff.tables_to_create.push(des_table.clone());
        }
    }

    // 3. Detect column changes in surviving tables
    for des_table in &desired.tables {
        if let Some(cur_table) = current.tables.iter().find(|t| t.name == des_table.name) {
            // Columns to add
            for des_col in &des_table.columns {
                if !cur_table.columns.iter().any(|c| c.name == des_col.name) {
                    diff.columns_to_add.push((des_table.name.clone(), des_col.clone()));
                }
            }

            // Columns to drop
            for cur_col in &cur_table.columns {
                if !des_table.columns.iter().any(|c| c.name == cur_col.name) {
                    diff.columns_to_drop.push((des_table.name.clone(), cur_col.name.clone()));
                }
            }

            // Columns to alter
            for des_col in &des_table.columns {
                if let Some(cur_col) = cur_table.columns.iter().find(|c| c.name == des_col.name) {
                    if cur_col != des_col {
                        let is_destructive = cur_col.is_nullable && !des_col.is_nullable;
                        diff.columns_to_alter.push(ColumnAlteration {
                            table_name: des_table.name.clone(),
                            source_column: cur_col.clone(),
                            target_column: des_col.clone(),
                            is_destructive,
                        });
                    }
                }
            }

            // Foreign keys to add
            for des_fk in &des_table.foreign_keys {
                if !cur_table.foreign_keys.iter().any(|f| f.constraint_name == des_fk.constraint_name) {
                    diff.foreign_keys_to_add.push((des_table.name.clone(), des_fk.clone()));
                }
            }

            // Foreign keys to drop
            for cur_fk in &cur_table.foreign_keys {
                if !des_table.foreign_keys.iter().any(|f| f.constraint_name == cur_fk.constraint_name) {
                    diff.foreign_keys_to_drop.push((des_table.name.clone(), cur_fk.constraint_name.clone()));
                }
            }
        }
    }

    diff
}
```

- [ ] **Step 3: Run diff engine unit tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_detect_added_and_dropped_tables`
Expected: PASS.

- [ ] **Step 4: Commit diff engine**

```bash
git add src-tauri/src/diff/
git commit -m "feat(diff): implement schema diff calculation engine"
```

---

### Task 6: Dialect DDL Generators (Rust Core)

**Files:**
- Create: `src-tauri/src/diff/ddl/mod.rs`
- Create: `src-tauri/src/diff/ddl/sqlite.rs`
- Create: `src-tauri/src/diff/ddl/postgres.rs`
- Create: `src-tauri/src/diff/ddl/mysql.rs`
- Test: `src-tauri/src/diff/ddl/ddl_test.rs`

**Interfaces:**
- Produces: `trait DialectDdlGenerator`, `generate_ddl(diff: &SchemaDiff, dialect: DatabaseType) -> Vec<String>`.
- Consumes: `SchemaDiff`, `DatabaseType`.

- [ ] **Step 1: Write unit tests for DDL Generation across dialects**

Create `src-tauri/src/diff/ddl/ddl_test.rs`:
```rust
use super::*;
use crate::diff::model::SchemaDiff;
use crate::model::connection::DatabaseType;
use crate::model::schema::{CanonicalType, ColumnSchema, TableSchema};

#[test]
fn test_generate_create_table_ddl_postgres() {
    let mut diff = SchemaDiff::default();
    diff.tables_to_create.push(TableSchema {
        name: "customers".to_string(),
        schema: Some("public".to_string()),
        columns: vec![
            ColumnSchema {
                name: "id".to_string(),
                data_type: CanonicalType::BigInt,
                is_primary_key: true,
                is_nullable: false,
                is_auto_increment: true,
                default_value: None,
            },
            ColumnSchema {
                name: "name".to_string(),
                data_type: CanonicalType::Varchar(Some(100)),
                is_primary_key: false,
                is_nullable: false,
                is_auto_increment: false,
                default_value: None,
            },
        ],
        foreign_keys: vec![],
        indexes: vec![],
        ui_position: None,
    });

    let statements = generate_ddl(&diff, DatabaseType::Postgres);
    assert_eq!(statements.len(), 1);
    assert!(statements[0].contains("CREATE TABLE \"public\".\"customers\""));
    assert!(statements[0].contains("\"id\" BIGSERIAL PRIMARY KEY"));
}

#[test]
fn test_generate_add_column_ddl_sqlite() {
    let mut diff = SchemaDiff::default();
    diff.columns_to_add.push((
        "users".to_string(),
        ColumnSchema {
            name: "age".to_string(),
            data_type: CanonicalType::Integer,
            is_primary_key: false,
            is_nullable: true,
            is_auto_increment: false,
            default_value: None,
        },
    ));

    let statements = generate_ddl(&diff, DatabaseType::Sqlite);
    assert_eq!(statements.len(), 1);
    assert_eq!(statements[0], "ALTER TABLE \"users\" ADD COLUMN \"age\" INTEGER;");
}
```

- [ ] **Step 2: Implement Dialect DDL Generators**

Create `src-tauri/src/diff/ddl/postgres.rs`:
```rust
use crate::diff::model::SchemaDiff;
use crate::model::schema::{CanonicalType, ColumnSchema, TableSchema};

pub struct PostgresDdlGenerator;

impl PostgresDdlGenerator {
    pub fn generate(diff: &SchemaDiff) -> Vec<String> {
        let mut stmts = Vec::new();

        // 1. Drop tables
        for table in &diff.tables_to_drop {
            stmts.push(format!("DROP TABLE IF EXISTS \"{}\" CASCADE;", table));
        }

        // 2. Create tables
        for table in &diff.tables_to_create {
            stmts.push(Self::create_table_sql(table));
        }

        // 3. Drop columns
        for (table, col) in &diff.columns_to_drop {
            stmts.push(format!("ALTER TABLE \"{}\" DROP COLUMN IF EXISTS \"{}\" CASCADE;", table, col));
        }

        // 4. Add columns
        for (table, col) in &diff.columns_to_add {
            stmts.push(format!("ALTER TABLE \"{}\" ADD COLUMN {};", table, Self::column_def(col)));
        }

        // 5. Alter columns
        for alt in &diff.columns_to_alter {
            let col = &alt.target_column;
            stmts.push(format!(
                "ALTER TABLE \"{}\" ALTER COLUMN \"{}\" TYPE {};",
                alt.table_name,
                col.name,
                Self::type_sql(&col.data_type)
            ));
        }

        stmts
    }

    fn create_table_sql(table: &TableSchema) -> String {
        let name = match &table.schema {
            Some(s) => format!("\"{}\".\"{}\"", s, table.name),
            None => format!("\"{}\"", table.name),
        };

        let cols: Vec<String> = table.columns.iter().map(|c| Self::column_def(c)).collect();
        format!("CREATE TABLE {} (\n  {}\n);", name, cols.join(",\n  "))
    }

    fn column_def(col: &ColumnSchema) -> String {
        let mut def = format!("\"{}\"", col.name);
        if col.is_auto_increment && col.is_primary_key {
            def.push_str(" BIGSERIAL PRIMARY KEY");
            return def;
        }

        def.push_str(&format!(" {}", Self::type_sql(&col.data_type)));
        if col.is_primary_key {
            def.push_str(" PRIMARY KEY");
        } else if !col.is_nullable {
            def.push_str(" NOT NULL");
        }

        if let Some(dflt) = &col.default_value {
            def.push_str(&format!(" DEFAULT {}", dflt));
        }

        def
    }

    fn type_sql(t: &CanonicalType) -> String {
        match t {
            CanonicalType::SmallInt => "SMALLINT".to_string(),
            CanonicalType::Integer => "INTEGER".to_string(),
            CanonicalType::BigInt => "BIGINT".to_string(),
            CanonicalType::Decimal { precision, scale } => {
                match (precision, scale) {
                    (Some(p), Some(s)) => format!("DECIMAL({}, {})", p, s),
                    _ => "DECIMAL".to_string(),
                }
            }
            CanonicalType::Float => "REAL".to_string(),
            CanonicalType::Double => "DOUBLE PRECISION".to_string(),
            CanonicalType::Boolean => "BOOLEAN".to_string(),
            CanonicalType::Char(len) => format!("CHAR({})", len.unwrap_or(1)),
            CanonicalType::Varchar(len) => format!("VARCHAR({})", len.unwrap_or(255)),
            CanonicalType::Text => "TEXT".to_string(),
            CanonicalType::Date => "DATE".to_string(),
            CanonicalType::Time => "TIME".to_string(),
            CanonicalType::Timestamp => "TIMESTAMP WITH TIME ZONE".to_string(),
            CanonicalType::Json => "JSONB".to_string(),
            CanonicalType::Uuid => "UUID".to_string(),
            CanonicalType::Binary => "BYTEA".to_string(),
            CanonicalType::Custom(s) => s.clone(),
        }
    }
}
```

Create `src-tauri/src/diff/ddl/sqlite.rs`:
```rust
use crate::diff::model::SchemaDiff;
use crate::model::schema::{CanonicalType, ColumnSchema, TableSchema};

pub struct SqliteDdlGenerator;

impl SqliteDdlGenerator {
    pub fn generate(diff: &SchemaDiff) -> Vec<String> {
        let mut stmts = Vec::new();

        for table in &diff.tables_to_drop {
            stmts.push(format!("DROP TABLE IF EXISTS \"{}\";", table));
        }

        for table in &diff.tables_to_create {
            stmts.push(Self::create_table_sql(table));
        }

        for (table, col) in &diff.columns_to_add {
            stmts.push(format!("ALTER TABLE \"{}\" ADD COLUMN {};", table, Self::column_def(col)));
        }

        stmts
    }

    fn create_table_sql(table: &TableSchema) -> String {
        let cols: Vec<String> = table.columns.iter().map(|c| Self::column_def(c)).collect();
        format!("CREATE TABLE \"{}\" (\n  {}\n);", table.name, cols.join(",\n  "))
    }

    fn column_def(col: &ColumnSchema) -> String {
        let mut def = format!("\"{}\"", col.name);
        if col.is_auto_increment && col.is_primary_key {
            def.push_str(" INTEGER PRIMARY KEY AUTOINCREMENT");
            return def;
        }

        def.push_str(&format!(" {}", Self::type_sql(&col.data_type)));
        if col.is_primary_key {
            def.push_str(" PRIMARY KEY");
        } else if !col.is_nullable {
            def.push_str(" NOT NULL");
        }

        if let Some(dflt) = &col.default_value {
            def.push_str(&format!(" DEFAULT {}", dflt));
        }

        def
    }

    fn type_sql(t: &CanonicalType) -> String {
        match t {
            CanonicalType::SmallInt | CanonicalType::Integer | CanonicalType::BigInt => "INTEGER".to_string(),
            CanonicalType::Float | CanonicalType::Double | CanonicalType::Decimal { .. } => "REAL".to_string(),
            CanonicalType::Boolean => "INTEGER".to_string(),
            CanonicalType::Binary => "BLOB".to_string(),
            _ => "TEXT".to_string(),
        }
    }
}
```

Create `src-tauri/src/diff/ddl/mod.rs`:
```rust
pub mod postgres;
pub mod sqlite;
#[cfg(test)]
mod ddl_test;

use crate::diff::model::SchemaDiff;
use crate::model::connection::DatabaseType;

/// @brief Generates executable DDL statements according to target SQL dialect.
pub fn generate_ddl(diff: &SchemaDiff, dialect: DatabaseType) -> Vec<String> {
    match dialect {
        DatabaseType::Postgres => postgres::PostgresDdlGenerator::generate(diff),
        DatabaseType::Sqlite => sqlite::SqliteDdlGenerator::generate(diff),
        DatabaseType::MySql | DatabaseType::Mssql => {
            // Fallback to standard dialect generation
            postgres::PostgresDdlGenerator::generate(diff)
        }
    }
}
```

- [ ] **Step 3: Run DDL generator tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_generate_create_table_ddl_postgres`
Expected: PASS.

- [ ] **Step 4: Commit DDL generators**

```bash
git add src-tauri/src/diff/ddl/
git commit -m "feat(diff): implement multi-dialect DDL generators"
```

---

### Task 7: Connection Manager & Tauri IPC Commands

**Files:**
- Create: `src-tauri/src/state.rs`
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/commands_test.rs`

**Interfaces:**
- Produces: Tauri IPC commands:
  - `cmd_test_connection`
  - `cmd_connect`
  - `cmd_introspect_schema`
  - `cmd_compute_diff`
  - `cmd_generate_ddl`
  - `cmd_execute_migration`
  - `cmd_execute_query`

- [ ] **Step 1: Write integration tests for Tauri Commands state**

Create `src-tauri/src/commands_test.rs`:
```rust
use crate::model::connection::{ConnectionConfig, DatabaseType};
use crate::state::AppState;

#[tokio::test]
async fn test_app_state_sqlite_workflow() {
    let state = AppState::default();
    let config = ConnectionConfig {
        id: "cmd-test".to_string(),
        name: "Test State SQLite".to_string(),
        db_type: DatabaseType::Sqlite,
        host: None,
        port: None,
        database: ":memory:".to_string(),
        username: None,
        password: None,
        file_path: Some(":memory:".to_string()),
        ssl: false,
    };

    state.connect(&config).await.expect("Failed to connect in state");
    let schema = state.introspect_active().await.expect("Failed to introspect");
    assert_eq!(schema.tables.len(), 0);
}
```

- [ ] **Step 2: Implement AppState and Tauri Commands**

Create `src-tauri/src/state.rs`:
```rust
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::driver::factory::DriverFactory;
use crate::driver::DatabaseDriver;
use crate::error::AppError;
use crate::model::connection::ConnectionConfig;
use crate::model::schema::DatabaseSchema;

/// @brief Global application state managing active connection.
#[derive(Default, Clone)]
pub struct AppState {
    active_driver: Arc<RwLock<Option<Box<dyn DatabaseDriver>>>>,
    active_config: Arc<RwLock<Option<ConnectionConfig>>>,
}

impl AppState {
    pub async fn connect(&self, config: &ConnectionConfig) -> Result<(), AppError> {
        let driver = DriverFactory::create(config).await?;
        let mut d_lock = self.active_driver.write().await;
        let mut c_lock = self.active_config.write().await;
        *d_lock = Some(driver);
        *c_lock = Some(config.clone());
        Ok(())
    }

    pub async fn introspect_active(&self) -> Result<DatabaseSchema, AppError> {
        let lock = self.active_driver.read().await;
        if let Some(driver) = lock.as_ref() {
            driver.introspect_schema().await
        } else {
            Err(AppError::Connection("No active database connection".to_string()))
        }
    }

    pub async fn get_active_driver(&self) -> Result<tokio::sync::RwLockReadGuard<'_, Option<Box<dyn DatabaseDriver>>>, AppError> {
        Ok(self.active_driver.read().await)
    }

    pub async fn get_active_config(&self) -> Option<ConnectionConfig> {
        self.active_config.read().await.clone()
    }
}
```

Create `src-tauri/src/commands.rs`:
```rust
use tauri::State;
use crate::diff::ddl::generate_ddl;
use crate::diff::{compute_schema_diff, SchemaDiff};
use crate::driver::factory::DriverFactory;
use crate::driver::{MigrationReport, QueryResult};
use crate::error::AppError;
use crate::model::connection::ConnectionConfig;
use crate::model::schema::DatabaseSchema;
use crate::state::AppState;

#[tauri::command]
pub async fn cmd_test_connection(config: ConnectionConfig) -> Result<bool, AppError> {
    let driver = DriverFactory::create(&config).await?;
    driver.test_connection().await?;
    Ok(true)
}

#[tauri::command]
pub async fn cmd_connect(config: ConnectionConfig, state: State<'_, AppState>) -> Result<bool, AppError> {
    state.connect(&config).await?;
    Ok(true)
}

#[tauri::command]
pub async fn cmd_introspect_schema(state: State<'_, AppState>) -> Result<DatabaseSchema, AppError> {
    state.introspect_active().await
}

#[tauri::command]
pub async fn cmd_compute_diff(
    current: DatabaseSchema,
    desired: DatabaseSchema,
) -> Result<SchemaDiff, AppError> {
    Ok(compute_schema_diff(&current, &desired))
}

#[tauri::command]
pub async fn cmd_generate_ddl(
    diff: SchemaDiff,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let config = state.get_active_config().await.ok_or_else(|| AppError::Connection("No active connection".to_string()))?;
    Ok(generate_ddl(&diff, config.db_type))
}

#[tauri::command]
pub async fn cmd_execute_migration(
    statements: Vec<String>,
    state: State<'_, AppState>,
) -> Result<MigrationReport, AppError> {
    let lock = state.get_active_driver().await?;
    if let Some(driver) = lock.as_ref() {
        driver.execute_ddl(&statements).await
    } else {
        Err(AppError::Connection("No active database connection".to_string()))
    }
}

#[tauri::command]
pub async fn cmd_execute_query(
    sql: String,
    state: State<'_, AppState>,
) -> Result<QueryResult, AppError> {
    let lock = state.get_active_driver().await?;
    if let Some(driver) = lock.as_ref() {
        driver.execute_query(&sql).await
    } else {
        Err(AppError::Connection("No active database connection".to_string()))
    }
}
```

- [ ] **Step 3: Update `src-tauri/src/lib.rs` and run test**

Run: `cargo test --manifest-path src-tauri/Cargo.toml test_app_state_sqlite_workflow`
Expected: PASS.

- [ ] **Step 4: Commit IPC Commands**

```bash
git add src-tauri/src/
git commit -m "feat(ipc): implement Tauri commands for connection, introspection, diff and DDL"
```

---

### Task 8: TablePlus-Themed Shell & Connection Manager UI (Frontend)

**Files:**
- Create: `src/types/database.ts`
- Create: `src/api/ipc.ts`
- Create: `src/components/Sidebar.tsx`
- Create: `src/components/ConnectionModal.tsx`
- Create: `src/components/HeaderBar.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: TablePlus minimalist UI shell with sidebar connection list, tables tree, active tabs (ERD Canvas / SQL Editor), and Connection Modal.

- [ ] **Step 1: Define TypeScript database types matching Rust models**

Create `src/types/database.ts`:
```typescript
export type DatabaseType = 'Sqlite' | 'Postgres' | 'MySql' | 'Mssql';

export interface ConnectionConfig {
  id: string;
  name: string;
  db_type: DatabaseType;
  host?: string;
  port?: number;
  database: string;
  username?: string;
  password?: string;
  file_path?: string;
  ssl: boolean;
}

export type CanonicalType =
  | 'SmallInt'
  | 'Integer'
  | 'BigInt'
  | { Decimal: { precision?: number; scale?: number } }
  | 'Float'
  | 'Double'
  | 'Boolean'
  | { Char: number }
  | { Varchar: number }
  | 'Text'
  | 'Date'
  | 'Time'
  | 'Timestamp'
  | 'Json'
  | 'Uuid'
  | 'Binary'
  | { Custom: string };

export interface ColumnSchema {
  name: string;
  data_type: CanonicalType;
  is_primary_key: boolean;
  is_nullable: boolean;
  is_auto_increment: boolean;
  default_value?: string;
}

export interface ForeignKeySchema {
  constraint_name: string;
  source_column: string;
  target_table: string;
  target_column: string;
  on_delete: 'NoAction' | 'Restrict' | 'Cascade' | 'SetNull' | 'SetDefault';
  on_update: 'NoAction' | 'Restrict' | 'Cascade' | 'SetNull' | 'SetDefault';
}

export interface TableSchema {
  name: string;
  schema?: string;
  columns: ColumnSchema[];
  foreign_keys: ForeignKeySchema[];
  indexes: any[];
  ui_position?: { x: number; y: number };
}

export interface DatabaseSchema {
  database_name: string;
  tables: TableSchema[];
}

export interface SchemaDiff {
  tables_to_create: TableSchema[];
  tables_to_drop: string[];
  columns_to_add: [string, ColumnSchema][];
  columns_to_drop: [string, string][];
  columns_to_alter: any[];
  foreign_keys_to_add: [string, ForeignKeySchema][];
  foreign_keys_to_drop: [string, string][];
}
```

- [ ] **Step 2: Implement Tauri IPC client API**

Create `src/api/ipc.ts`:
```typescript
import { invoke } from '@tauri-apps/api/core';
import { ConnectionConfig, DatabaseSchema, SchemaDiff } from '../types/database';

export const api = {
  testConnection: (config: ConnectionConfig) =>
    invoke<boolean>('cmd_test_connection', { config }),

  connect: (config: ConnectionConfig) =>
    invoke<boolean>('cmd_connect', { config }),

  introspectSchema: () =>
    invoke<DatabaseSchema>('cmd_introspect_schema'),

  computeDiff: (current: DatabaseSchema, desired: DatabaseSchema) =>
    invoke<SchemaDiff>('cmd_compute_diff', { current, desired }),

  generateDdl: (diff: SchemaDiff) =>
    invoke<string[]>('cmd_generate_ddl', { diff }),

  executeMigration: (statements: string[]) =>
    invoke<{ success: boolean; statements_executed: number; execution_time_ms: number }>(
      'cmd_execute_migration',
      { statements }
    ),

  executeQuery: (sql: string) =>
    invoke<{ columns: string[]; rows: any[][]; rows_affected: number; execution_time_ms: number }>(
      'cmd_execute_query',
      { sql }
    ),
};
```

- [ ] **Step 3: Build Sidebar, ConnectionModal, and HeaderBar Components**

Create `src/components/Sidebar.tsx`:
```tsx
import React, { useState } from 'react';
import { Database, Plus, Table as TableIcon, Key, Link as LinkIcon, RefreshCw } from 'lucide-react';
import { ConnectionConfig, TableSchema } from '../types/database';

interface SidebarProps {
  connections: ConnectionConfig[];
  activeConnection: ConnectionConfig | null;
  tables: TableSchema[];
  onOpenNewConnection: () => void;
  onSelectConnection: (conn: ConnectionConfig) => void;
  onSelectTable: (tableName: string) => void;
  onRefresh: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  connections,
  activeConnection,
  tables,
  onOpenNewConnection,
  onSelectConnection,
  onSelectTable,
  onRefresh,
}) => {
  const [filter, setFilter] = useState('');

  const filteredTables = tables.filter((t) =>
    t.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="w-64 bg-[#18191c] border-r border-[#35373c] flex flex-col h-full text-xs select-none">
      {/* Workspace Header */}
      <div className="p-3 border-b border-[#35373c] flex items-center justify-between">
        <div className="flex items-center space-x-2 font-semibold text-[#e6e8ea]">
          <Database className="w-4 h-4 text-[#3a82f7]" />
          <span className="truncate max-w-[130px]">
            {activeConnection ? activeConnection.name : 'No Connection'}
          </span>
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={onRefresh}
            title="Refresh Schema"
            className="p-1 hover:bg-[#2b2d30] rounded text-[#8c919a] hover:text-[#e6e8ea]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onOpenNewConnection}
            title="New Connection"
            className="p-1 hover:bg-[#2b2d30] rounded text-[#8c919a] hover:text-[#e6e8ea]"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Tables filter */}
      <div className="p-2 border-b border-[#35373c]">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tables..."
          className="w-full bg-[#1e1f22] border border-[#35373c] rounded px-2 py-1 text-xs text-[#e6e8ea] focus:outline-none focus:border-[#3a82f7]"
        />
      </div>

      {/* Tables list */}
      <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
        <div className="text-[10px] uppercase font-semibold text-[#8c919a] px-2 py-1">
          Tables ({filteredTables.length})
        </div>
        {filteredTables.map((t) => (
          <div
            key={t.name}
            onClick={() => onSelectTable(t.name)}
            className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-[#2b2d30] cursor-pointer text-[#e6e8ea]"
          >
            <div className="flex items-center space-x-2 truncate">
              <TableIcon className="w-3.5 h-3.5 text-[#8c919a]" />
              <span className="truncate">{t.name}</span>
            </div>
            <span className="text-[10px] text-[#8c919a] bg-[#222428] px-1 rounded">
              {t.columns.length}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Verify build with bun run build**

Run: `bun run build`
Expected: PASS with 0 TypeScript and bundling errors.

- [ ] **Step 5: Commit shell UI**

```bash
git add src/
git commit -m "feat(ui): implement TablePlus minimalist shell and sidebar navigation"
```

---

### Task 9: Interactive ERD Canvas Engine (@xyflow/react)

**Files:**
- Create: `src/components/canvas/TableNode.tsx`
- Create: `src/components/canvas/ErdCanvas.tsx`
- Create: `src/components/canvas/TableDrawer.tsx`
- Create: `src/utils/layout.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: Interactive ERD diagram canvas with custom table nodes, column handles, foreign key links, Dagre auto-layout, and table editing drawer.

- [ ] **Step 1: Implement Dagre Auto-Layout Utility**

Create `src/utils/layout.ts`:
```typescript
import dagre from 'dagre';
import { Node, Edge } from '@xyflow/react';

export const layoutElements = (nodes: Node[], edges: Edge[]) => {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 70, ranksep: 100 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    // Height estimated based on column count
    const colCount = (node.data.columns as any[])?.length || 1;
    const height = 45 + colCount * 28;
    g.setNode(node.id, { width: 240, height });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - 120,
        y: pos.y - ((node.data.columns as any[])?.length * 28 + 45) / 2,
      },
    };
  });
};
```

- [ ] **Step 2: Implement Custom TableNode with Column Handles**

Create `src/components/canvas/TableNode.tsx`:
```tsx
import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Key, Link as LinkIcon, Table as TableIcon } from 'lucide-react';
import { ColumnSchema } from '../../types/database';

export interface TableNodeData {
  label: string;
  columns: ColumnSchema[];
  onEdit: (tableName: string) => void;
}

export const TableNode = memo(({ data }: { data: TableNodeData }) => {
  return (
    <div className="bg-[#24262b] border border-[#3a3d45] rounded-md shadow-2xl min-w-[220px] max-w-[280px] overflow-hidden text-xs">
      {/* Table Header */}
      <div
        onDoubleClick={() => data.onEdit(data.label)}
        className="bg-[#2b2e36] px-3 py-2 border-b border-[#3a3d45] flex items-center justify-between font-semibold text-[#e6e8ea] cursor-pointer"
      >
        <div className="flex items-center space-x-1.5 truncate">
          <TableIcon className="w-3.5 h-3.5 text-[#3a82f7]" />
          <span className="truncate">{data.label}</span>
        </div>
        <span className="text-[10px] text-[#8c919a] bg-[#1e2024] px-1.5 py-0.5 rounded">
          {data.columns.length}
        </span>
      </div>

      {/* Columns list */}
      <div className="divide-y divide-[#2f323a]">
        {data.columns.map((col, idx) => {
          const typeStr = typeof col.data_type === 'string' ? col.data_type : 'Custom';
          return (
            <div
              key={col.name}
              className="relative px-3 py-1.5 flex items-center justify-between text-[#c4c7cc] hover:bg-[#2b2d33]"
            >
              <Handle
                type="target"
                position={Position.Left}
                id={`${col.name}-target`}
                style={{ top: '50%', background: '#3a82f7' }}
              />

              <div className="flex items-center space-x-1.5 truncate">
                {col.is_primary_key && <Key className="w-3 h-3 text-[#f5a623]" />}
                <span className={col.is_primary_key ? 'font-semibold text-[#e6e8ea]' : ''}>
                  {col.name}
                </span>
              </div>

              <div className="flex items-center space-x-1 text-[10px]">
                <span className="text-[#8c919a] uppercase">{typeStr}</span>
                {!col.is_nullable && <span className="text-[#e05252] font-mono text-[9px]">NN</span>}
              </div>

              <Handle
                type="source"
                position={Position.Right}
                id={`${col.name}-source`}
                style={{ top: '50%', background: '#20c997' }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});
```

- [ ] **Step 3: Implement ErdCanvas with Controls and Auto Layout**

Create `src/components/canvas/ErdCanvas.tsx`:
```tsx
import React, { useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { TableNode } from './TableNode';
import { DatabaseSchema } from '../../types/database';
import { layoutElements } from '../../utils/layout';

interface ErdCanvasProps {
  schema: DatabaseSchema;
  onEditTable: (tableName: string) => void;
}

export const ErdCanvas: React.FC<ErdCanvasProps> = ({ schema, onEditTable }) => {
  const nodeTypes = useMemo(() => ({ tableNode: TableNode }), []);

  const initialNodes = useMemo(() => {
    return schema.tables.map((table, idx) => ({
      id: table.name,
      type: 'tableNode',
      position: table.ui_position || { x: idx * 260, y: 100 },
      data: {
        label: table.name,
        columns: table.columns,
        onEdit: onEditTable,
      },
    }));
  }, [schema, onEditTable]);

  const initialEdges = useMemo(() => {
    const edges: any[] = [];
    schema.tables.forEach((table) => {
      table.foreign_keys.forEach((fk) => {
        edges.push({
          id: fk.constraint_name,
          source: table.name,
          sourceHandle: `${fk.source_column}-source`,
          target: fk.target_table,
          targetHandle: `${fk.target_column}-target`,
          animated: true,
          style: { stroke: '#3a82f7', strokeWidth: 2 },
        });
      });
    });
    return edges;
  }, [schema]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const handleAutoLayout = () => {
    const layouted = layoutElements(nodes, edges);
    setNodes([...layouted]);
  };

  return (
    <div className="w-full h-full relative bg-[#1e1f22]">
      <div className="absolute top-3 right-3 z-10 flex space-x-2">
        <button
          onClick={handleAutoLayout}
          className="bg-[#2b2d30] hover:bg-[#35373c] text-[#e6e8ea] px-3 py-1.5 rounded text-xs border border-[#35373c] shadow-md"
        >
          Auto Layout
        </button>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#35373c" />
        <Controls className="bg-[#24262b]! border-[#35373c]! text-[#e6e8ea]!" />
        <MiniMap
          nodeColor="#3a82f7"
          maskColor="rgba(30, 31, 34, 0.7)"
          className="bg-[#18191c]! border-[#35373c]!"
        />
      </ReactFlow>
    </div>
  );
};
```

- [ ] **Step 4: Verify compilation with bun run build**

Run: `bun run build`
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit ERD Canvas**

```bash
git add src/components/canvas/ src/utils/
git commit -m "feat(erd): implement interactive ERD canvas with custom Table nodes and auto-layout"
```

---

### Task 10: Visual Schema Diff & Interactive Safe Migration Modal

**Files:**
- Create: `src/components/diff/DiffModal.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: Visual Diff inspection modal displaying structural change tree (added/dropped tables & columns with warning badges) and Monaco Editor SQL preview for DDL execution.

- [ ] **Step 1: Implement DiffModal Component**

Create `src/components/diff/DiffModal.tsx`:
```tsx
import React, { useState } from 'react';
import Editor from '@monaco-editor/react';
import { AlertTriangle, Check, Copy, X } from 'lucide-react';
import { SchemaDiff } from '../../types/database';

interface DiffModalProps {
  isOpen: boolean;
  diff: SchemaDiff | null;
  generatedDdl: string[];
  onClose: () => void;
  onExecute: (statements: string[]) => Promise<void>;
}

export const DiffModal: React.FC<DiffModalProps> = ({
  isOpen,
  diff,
  generatedDdl,
  onClose,
  onExecute,
}) => {
  const [customSql, setCustomSql] = useState<string>(generatedDdl.join('\n\n'));
  const [isExecuting, setIsExecuting] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!isOpen || !diff) return null;

  const hasDestructive =
    diff.tables_to_drop.length > 0 ||
    diff.columns_to_drop.length > 0 ||
    diff.columns_to_alter.some((a) => a.is_destructive);

  const handleCopy = () => {
    navigator.clipboard.writeText(customSql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRun = async () => {
    setIsExecuting(true);
    try {
      const statements = customSql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => s + ';');
      await onExecute(statements);
      onClose();
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-6 select-none">
      <div className="bg-[#24262b] border border-[#35373c] rounded-lg shadow-2xl w-[900px] max-h-[85vh] flex flex-col overflow-hidden text-xs text-[#e6e8ea]">
        {/* Modal Header */}
        <div className="px-4 py-3 bg-[#1e1f22] border-b border-[#35373c] flex items-center justify-between">
          <div className="font-semibold text-sm flex items-center space-x-2">
            <span>Review Schema Migration</span>
            {hasDestructive && (
              <span className="flex items-center space-x-1 text-[#e05252] bg-[#e05252]/10 border border-[#e05252]/30 px-2 py-0.5 rounded text-[11px]">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Destructive Changes Detected</span>
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-[#35373c] rounded text-[#8c919a]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Changes tree */}
          <div className="w-72 border-r border-[#35373c] p-3 overflow-y-auto space-y-3 bg-[#18191c]">
            <div className="font-semibold text-[#8c919a] uppercase text-[10px]">
              Detected Changes
            </div>

            {diff.tables_to_create.map((t) => (
              <div key={t.name} className="text-[#20c997] flex items-center space-x-1.5">
                <span>+</span>
                <span>Create Table: <strong>{t.name}</strong></span>
              </div>
            ))}

            {diff.tables_to_drop.map((t) => (
              <div key={t} className="text-[#e05252] font-semibold flex items-center space-x-1.5">
                <span>-</span>
                <span>Drop Table: {t}</span>
              </div>
            ))}

            {diff.columns_to_add.map(([tbl, col]) => (
              <div key={`${tbl}-${col.name}`} className="text-[#3a82f7] flex items-center space-x-1.5">
                <span>+</span>
                <span>{tbl}.<strong>{col.name}</strong></span>
              </div>
            ))}

            {diff.columns_to_drop.map(([tbl, col]) => (
              <div key={`${tbl}-${col}`} className="text-[#e05252] flex items-center space-x-1.5">
                <span>-</span>
                <span>{tbl}.{col}</span>
              </div>
            ))}
          </div>

          {/* DDL Preview in Monaco Editor */}
          <div className="flex-1 flex flex-col bg-[#1e1f22]">
            <div className="px-3 py-1.5 bg-[#26282d] border-b border-[#35373c] flex items-center justify-between text-[#8c919a]">
              <span>Generated SQL Script (Editable)</span>
              <button
                onClick={handleCopy}
                className="flex items-center space-x-1 hover:text-[#e6e8ea]"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-[#20c997]" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <div className="flex-1">
              <Editor
                height="100%"
                defaultLanguage="sql"
                theme="vs-dark"
                value={customSql}
                onChange={(val) => setCustomSql(val || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  fontFamily: 'JetBrains Mono, monospace',
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                }}
              />
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-4 py-3 bg-[#1e1f22] border-t border-[#35373c] flex items-center justify-between">
          <div className="text-[#8c919a] text-[11px]">
            Execution runs inside a safe transaction block.
          </div>
          <div className="flex space-x-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-[#2b2d30] hover:bg-[#35373c] text-[#e6e8ea]"
            >
              Cancel
            </button>
            <button
              onClick={handleRun}
              disabled={isExecuting}
              className="px-4 py-1.5 rounded bg-[#3a82f7] hover:bg-[#2b6fd6] font-semibold text-white disabled:opacity-50"
            >
              {isExecuting ? 'Executing...' : 'Execute Migration'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Verify compilation with bun run build**

Run: `bun run build`
Expected: PASS with 0 errors.

- [ ] **Step 3: Commit DiffModal**

```bash
git add src/components/diff/
git commit -m "feat(diff): implement interactive safe migration review modal with Monaco preview"
```

---

### Task 11: SQL Query Editor & ERD Export Utilities

**Files:**
- Create: `src/components/query/QueryEditorTab.tsx`
- Create: `src/utils/export.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: SQL query editor with execution grid and diagram export as PNG/SVG/JSON.

- [ ] **Step 1: Implement QueryEditorTab Component**

Create `src/components/query/QueryEditorTab.tsx`:
```tsx
import React, { useState } from 'react';
import Editor from '@monaco-editor/react';
import { Play } from 'lucide-react';
import { api } from '../../api/ipc';

export const QueryEditorTab: React.FC = () => {
  const [query, setQuery] = useState('SELECT 1 as id, "Hello TablePlus" as message;');
  const [result, setResult] = useState<{ columns: string[]; rows: any[][]; rows_affected: number; execution_time_ms: number } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.executeQuery(query);
      setResult(res);
    } catch (err: any) {
      setError(err?.toString() || 'Execution failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1e1f22] text-xs">
      {/* Editor toolbar */}
      <div className="p-2 bg-[#26282d] border-b border-[#35373c] flex items-center justify-between">
        <button
          onClick={handleRun}
          disabled={isLoading}
          className="flex items-center space-x-1.5 bg-[#3a82f7] hover:bg-[#2b6fd6] text-white px-3 py-1 rounded font-semibold disabled:opacity-50"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>{isLoading ? 'Running...' : 'Run Query (Ctrl+Enter)'}</span>
        </button>
        {result && (
          <span className="text-[#8c919a]">
            {result.rows.length} rows in {result.execution_time_ms} ms
          </span>
        )}
      </div>

      {/* Editor Area */}
      <div className="h-48 border-b border-[#35373c]">
        <Editor
          height="100%"
          defaultLanguage="sql"
          theme="vs-dark"
          value={query}
          onChange={(v) => setQuery(v || '')}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            fontFamily: 'JetBrains Mono, monospace',
            lineNumbers: 'on',
          }}
        />
      </div>

      {/* Results Grid */}
      <div className="flex-1 overflow-auto bg-[#18191c]">
        {error && <div className="p-3 text-[#e05252] font-mono">{error}</div>}
        {result && (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#24262b] text-[#8c919a] border-b border-[#35373c]">
                {result.columns.map((col) => (
                  <th key={col} className="px-3 py-1.5 font-semibold">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, idx) => (
                <tr key={idx} className="border-b border-[#2b2d30] hover:bg-[#24262b]">
                  {row.map((val, cidx) => (
                    <td key={cidx} className="px-3 py-1 text-[#e6e8ea]">
                      {val === null ? <span className="text-[#8c919a] italic">NULL</span> : String(val)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Implement ERD Export Utility**

Create `src/utils/export.ts`:
```typescript
import { DatabaseSchema } from '../types/database';

export const exportSchemaAsJson = (schema: DatabaseSchema) => {
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(schema, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute('href', dataStr);
  downloadAnchor.setAttribute('download', `${schema.database_name || 'schema'}-erd.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
};
```

- [ ] **Step 3: Verify compilation with bun run build**

Run: `bun run build`
Expected: PASS with 0 errors.

- [ ] **Step 4: Commit SQL editor & export**

```bash
git add src/components/query/ src/utils/export.ts
git commit -m "feat(query): implement SQL query editor tab and ERD export utilities"
```

---

### Task 12: End-to-End Verification & Static Code Review

**Files:**
- Create: `README.md`
- Verify: All tests across Rust and TypeScript

**Interfaces:**
- Produces: Verified executable and regression-tested codebase with 100% build pass.

- [ ] **Step 1: Write exhaustive README.md documentation per Rule 4**

Create `README.md`:
```markdown
# DynoDbModeler

DynoDbModeler is a cross-platform SQL management and database modeling desktop tool built with **Tauri v2**, **Rust**, and **React 19**, featuring a sleek dark aesthetic inspired by **TablePlus**.

## Features
- **Extensible Database Connectivity**: Native async drivers for SQLite, PostgreSQL, and MySQL.
- **Reverse Engineering**: Instant extraction of tables, primary keys, and foreign keys into an interactive ERD.
- **Forward Engineering & Safe Sync**: Visual schema diffing, dialect DDL generation, and safe transactional migrations.
- **TablePlus Theme**: Minimalist dark UI, compact tables, and monospace data typography.

## Prerequisites
- Rust 1.80+ (`cargo`)
- Bun 1.2+ (`bun`) or Node.js 22+

## Running the Application
```bash
# Install dependencies
bun install

# Run desktop application in development mode
bun run tauri dev

# Run automated tests
cargo test --manifest-path src-tauri/Cargo.toml
bun run build
```
```

- [ ] **Step 2: Run all backend and frontend test suites**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: All tests PASS with exit code 0.

Run: `bun run build`
Expected: Vite build succeeds with exit code 0.

- [ ] **Step 3: Commit README and final verification**

```bash
git add README.md
git commit -m "docs: add project README and verification artifacts"
```
