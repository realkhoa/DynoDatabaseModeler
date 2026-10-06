//! @file mutation_model.rs
//! @brief Data transfer objects and payload structures for transactional row mutations.
//! @details Defines the `RowUpdatePayload` struct used to encapsulate targeted table mutations
//! identified by primary keys and modified column values.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// @brief Represents a single row mutation targeted by primary key values.
/// @details Encapsulates the target table name, primary key key-value pairs used
/// in the WHERE predicate, and column name-value pairs representing the changes to apply.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RowUpdatePayload {
    /// @brief Name of the database table being updated.
    pub table: String,
    /// @brief Key-value pairs identifying the unique target row by primary key column names and values.
    pub primary_keys: HashMap<String, serde_json::Value>,
    /// @brief Key-value pairs of changed columns and their new values.
    pub updated_values: HashMap<String, serde_json::Value>,
}

impl RowUpdatePayload {
    /// @brief Constructs a new `RowUpdatePayload` instance.
    /// @param table Target database table name.
    /// @param primary_keys Map of primary key column names to identifying values.
    /// @param updated_values Map of modified column names to their new values.
    /// @return Newly initialized `RowUpdatePayload`.
    pub fn new(
        table: impl Into<String>,
        primary_keys: HashMap<String, serde_json::Value>,
        updated_values: HashMap<String, serde_json::Value>,
    ) -> Self {
        Self {
            table: table.into(),
            primary_keys,
            updated_values,
        }
    }
}
