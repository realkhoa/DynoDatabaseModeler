//! @file model.rs
//! @brief Data models representing structural database schema differences.
//! @details Defines structured types for capturing added, dropped, and altered tables,
//! columns, foreign key relationships, table renames, and tables that require a full
//! rebuild on dialects without native `ALTER COLUMN` support (SQLite).

use crate::model::schema::{ColumnSchema, ForeignKeySchema, TableSchema};
use serde::{Deserialize, Serialize};

/// @brief Represents alteration details on an existing table column.
/// @details Encapsulates the source and target column definitions, table context,
/// and a flag indicating whether the alteration is potentially data-destructive
/// (e.g., relaxing nullability to NOT NULL or narrowing data types).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColumnAlteration {
    /// @brief Name of the table containing the column to alter.
    pub table_name: String,
    /// @brief Current live schema definition of the column.
    pub source_column: ColumnSchema,
    /// @brief Target desired schema definition of the column.
    pub target_column: ColumnSchema,
    /// @brief Indicates whether applying this alteration could cause data loss or validation failure.
    pub is_destructive: bool,
}

/// @brief A table rename to apply with `ALTER TABLE ... RENAME TO`.
/// @details Emitted instead of a destructive DROP + CREATE pair whenever the modeler records
/// the previous name of a table through `TableSchema::rename_from`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TableRename {
    /// @brief Current (live) table name, fully qualified when a schema is present.
    pub from: String,
    /// @brief Desired new table name, fully qualified when a schema is present.
    pub to: String,
}

/// @brief A table that must be rebuilt because the dialect cannot express the requested
/// change with in-place DDL (SQLite: column type/nullability/default/PK changes and
/// foreign key changes on existing tables).
/// @details Carries the complete target definition plus the intersection of column names that
/// can be copied from the existing table, so the rebuild preserves data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TableRebuild {
    /// @brief Name of the table to rebuild (fully qualified when a schema is present).
    pub table_name: String,
    /// @brief Complete desired definition of the table (columns, primary key, FKs, indexes).
    pub target: TableSchema,
    /// @brief Columns to copy from the existing table into the rebuilt one, in target order.
    pub copy_columns: Vec<String>,
}

/// @brief Complete structured diff between current live and desired target schemas.
/// @details Captures tables to create, drop, or rename, columns to add/drop/alter,
/// foreign keys to add/drop, and tables that require a destructive-safe rebuild.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SchemaDiff {
    /// @brief Tables that exist in desired schema but not in current schema.
    pub tables_to_create: Vec<TableSchema>,
    /// @brief Names of tables that exist in current schema but not in desired schema.
    pub tables_to_drop: Vec<String>,
    /// @brief Tables that exist in both schemas but were renamed by the user.
    #[serde(default)]
    pub tables_to_rename: Vec<TableRename>,
    /// @brief Tables whose changes require a full rebuild on dialects without ALTER COLUMN.
    #[serde(default)]
    pub tables_to_rebuild: Vec<TableRebuild>,
    /// @brief Tuples of `(table_name, column_schema)` for columns to add to existing tables.
    pub columns_to_add: Vec<(String, ColumnSchema)>,
    /// @brief Tuples of `(table_name, column_name)` for columns to drop from existing tables.
    pub columns_to_drop: Vec<(String, String)>,
    /// @brief Column modifications within existing tables.
    pub columns_to_alter: Vec<ColumnAlteration>,
    /// @brief Tuples of `(table_name, foreign_key_schema)` for foreign keys to add.
    pub foreign_keys_to_add: Vec<(String, ForeignKeySchema)>,
    /// @brief Tuples of `(table_name, constraint_name)` for foreign keys to drop.
    pub foreign_keys_to_drop: Vec<(String, String)>,
    /// @brief Tuples of `(table_name, index_schema)` for indexes to create.
    #[serde(default)]
    pub indexes_to_create: Vec<(String, crate::model::schema::IndexSchema)>,
    /// @brief Tuples of `(table_name, index_name)` for indexes to drop.
    #[serde(default)]
    pub indexes_to_drop: Vec<(String, String)>,
}

impl SchemaDiff {
    /// @brief Checks whether the schema diff contains no structural changes.
    /// @return Returns `true` if all change collections are empty; `false` otherwise.
    pub fn is_empty(&self) -> bool {
        self.tables_to_create.is_empty()
            && self.tables_to_drop.is_empty()
            && self.tables_to_rename.is_empty()
            && self.tables_to_rebuild.is_empty()
            && self.columns_to_add.is_empty()
            && self.columns_to_drop.is_empty()
            && self.columns_to_alter.is_empty()
            && self.foreign_keys_to_add.is_empty()
            && self.foreign_keys_to_drop.is_empty()
            && self.indexes_to_create.is_empty()
            && self.indexes_to_drop.is_empty()
    }

    /// @brief Total number of structural changes described by this diff.
    /// @return Count of individual change items.
    pub fn change_count(&self) -> usize {
        self.tables_to_create.len()
            + self.tables_to_drop.len()
            + self.tables_to_rename.len()
            + self.tables_to_rebuild.len()
            + self.columns_to_add.len()
            + self.columns_to_drop.len()
            + self.columns_to_alter.len()
            + self.foreign_keys_to_add.len()
            + self.foreign_keys_to_drop.len()
            + self.indexes_to_create.len()
            + self.indexes_to_drop.len()
    }
}
