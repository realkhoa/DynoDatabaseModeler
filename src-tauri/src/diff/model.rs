//! @file model.rs
//! @brief Data models representing structural database schema differences.
//! @details Defines structured types for capturing added, dropped, and altered tables,
//! columns, and foreign key relationships between current and desired schemas.

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

/// @brief Complete structured diff between current live and desired target schemas.
/// @details Captures tables to create, tables to drop, columns to add/drop/alter,
/// and foreign keys to add/drop for migration generation and inspection.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SchemaDiff {
    /// @brief Tables that exist in desired schema but not in current schema.
    pub tables_to_create: Vec<TableSchema>,
    /// @brief Names of tables that exist in current schema but not in desired schema.
    pub tables_to_drop: Vec<String>,
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
}

impl SchemaDiff {
    /// @brief Checks whether the schema diff contains no structural changes.
    /// @return Returns `true` if all change collections are empty; `false` otherwise.
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
