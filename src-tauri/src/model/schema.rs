//! @file schema.rs
//! @brief Core database schema domain models for tables, columns, indexes, and relations.
//! @details Defines canonical representations of database entities used for introspection,
//! diagram rendering, and migration generation.

use serde::{Deserialize, Serialize};

/// @brief Represents common canonical database column data types across all supported engines.
/// @details Normalizes engine-specific dialect types (e.g. Postgres INT8, MySQL BIGINT, SQLite INTEGER)
/// into a unified type system for cross-engine modeling and ERD visualization.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CanonicalType {
    /// @brief 16-bit signed integer.
    SmallInt,
    /// @brief 32-bit signed integer.
    Integer,
    /// @brief 64-bit signed integer.
    BigInt,
    /// @brief Fixed-point exact decimal with optional precision and scale.
    Decimal {
        /// @brief Total count of significant digits.
        precision: Option<u32>,
        /// @brief Number of digits to the right of the decimal point.
        scale: Option<u32>,
    },
    /// @brief 32-bit single-precision floating point number.
    Float,
    /// @brief 64-bit double-precision floating point number.
    Double,
    /// @brief Boolean logical value (true/false).
    Boolean,
    /// @brief Fixed-length character string with optional max length.
    Char(Option<u32>),
    /// @brief Variable-length character string with optional max length.
    Varchar(Option<u32>),
    /// @brief Unbounded or long variable-length text.
    Text,
    /// @brief Calendar date (year, month, day) without timezone.
    Date,
    /// @brief Wall-clock time (hour, minute, second) without date.
    Time,
    /// @brief Date and time instant with or without timezone.
    Timestamp,
    /// @brief Structured JSON text or binary document format.
    Json,
    /// @brief Universally unique identifier (128-bit UUID).
    Uuid,
    /// @brief Raw binary bytes / BLOB.
    Binary,
    /// @brief User-defined, engine-specific, or unmapped custom type string.
    Custom(String),
}

/// @brief Referential action triggered on foreign key target updates or deletes.
/// @details Corresponds to ANSI SQL referential actions (CASCADE, SET NULL, RESTRICT, etc.).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReferentialAction {
    /// @brief Raises an error if referenced row is deleted or modified.
    NoAction,
    /// @brief Rejects delete or update of referenced row immediately.
    Restrict,
    /// @brief Propagates delete or update to child rows automatically.
    Cascade,
    /// @brief Sets referencing foreign key columns to NULL.
    SetNull,
    /// @brief Sets referencing foreign key columns to their default values.
    SetDefault,
}

/// @brief Foreign key definition linking a source table column to a target table and column.
/// @details Encapsulates referential integrity constraint rules and target relationship mappings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForeignKeySchema {
    /// @brief Identifier name of the foreign key constraint.
    pub constraint_name: String,
    /// @brief Local column name within the referencing table.
    pub source_column: String,
    /// @brief Name of the referenced target table.
    pub target_table: String,
    /// @brief Column name within the referenced target table.
    pub target_column: String,
    /// @brief Action executed when referenced parent row is deleted.
    pub on_delete: ReferentialAction,
    /// @brief Action executed when referenced parent row is updated.
    pub on_update: ReferentialAction,
}

/// @brief Column definition within a table schema.
/// @details Specifies column name, canonical data type, nullability, identity, and defaults.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColumnSchema {
    /// @brief Column identifier name.
    pub name: String,
    /// @brief Canonical data type abstraction.
    pub data_type: CanonicalType,
    /// @brief Indicates whether this column is part of the primary key.
    pub is_primary_key: bool,
    /// @brief Indicates whether NULL values are accepted.
    pub is_nullable: bool,
    /// @brief Indicates whether column auto-generates sequential values (e.g., SERIAL / AUTO_INCREMENT).
    pub is_auto_increment: bool,
    /// @brief Optional default expression or literal value string.
    pub default_value: Option<String>,
}

/// @brief Secondary index definition on a table.
/// @details Encapsulates index name, indexed column order, and uniqueness constraints.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexSchema {
    /// @brief Index identifier name.
    pub name: String,
    /// @brief Ordered list of column names included in the index key.
    pub columns: Vec<String>,
    /// @brief Indicates whether unique values are enforced.
    pub is_unique: bool,
}

/// @brief Canvas 2D coordinates for visual diagram placement.
/// @details Represents positioning on the virtual canvas coordinate space.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Point {
    /// @brief Horizontal X coordinate offset on canvas.
    pub x: f64,
    /// @brief Vertical Y coordinate offset on canvas.
    pub y: f64,
}

/// @brief Relational table schema definition including columns, constraints, and layout.
/// @details Primary entity for ERD rendering and schema comparison operations.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TableSchema {
    /// @brief Name of the table.
    pub name: String,
    /// @brief Optional namespace or schema name (e.g., 'public', 'dbo').
    pub schema: Option<String>,
    /// @brief Ordered collection of table columns.
    pub columns: Vec<ColumnSchema>,
    /// @brief Foreign key constraints defined on this table.
    pub foreign_keys: Vec<ForeignKeySchema>,
    /// @brief Indexes defined on this table.
    pub indexes: Vec<IndexSchema>,
    /// @brief Optional canvas coordinates for visual diagram persistence.
    pub ui_position: Option<Point>,
    /// @brief Previous table name when the user renamed the table in the modeler.
    /// @details Allows the diff engine to emit a non-destructive `ALTER TABLE ... RENAME TO`
    /// instead of a destructive DROP + CREATE pair. Cleared automatically whenever the schema
    /// is re-introspected from the live database.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rename_from: Option<String>,
    /// @brief Dialect constructs discovered during introspection that make a full table
    /// rebuild unsafe (e.g. triggers, CHECK constraints, generated columns, dependent views).
    /// @details Populated by the SQLite driver; consumed by the SQLite DDL generator to refuse
    /// a rebuild rather than silently dropping those objects.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unsupported_features: Vec<String>,
}

impl TableSchema {
    /// @brief Fully-qualified identifier for this table (`schema.name` when a schema is present).
    /// @return Qualified table key used for diff matching and ERD node identity.
    pub fn qualified_name(&self) -> String {
        match &self.schema {
            Some(s) if !s.trim().is_empty() => format!("{}.{}", s, self.name),
            _ => self.name.clone(),
        }
    }
}

/// @brief Root database schema model containing all tables and metadata.
/// @details Top-level container serialized between backend and frontend over Tauri IPC.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DatabaseSchema {
    /// @brief Database catalog or identifier name.
    pub database_name: String,
    /// @brief Collection of tables residing in this database.
    pub tables: Vec<TableSchema>,
}
