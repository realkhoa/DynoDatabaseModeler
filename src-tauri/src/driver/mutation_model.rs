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
    /// @brief When `true`, the driver must fail and roll back unless the statement affects
    /// exactly one row, and every primary key value must be non-null.
    /// @details Set by the interactive data grid so that a non-unique or null primary key
    /// locator can never silently update or delete the wrong rows.
    #[serde(default)]
    pub expect_single_row: bool,
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
            expect_single_row: false,
        }
    }

    /// @brief Marks this payload as requiring exactly one affected row.
    /// @return The same payload with `expect_single_row` enabled.
    pub fn single_row(mut self) -> Self {
        self.expect_single_row = true;
        self
    }

    /// @brief Validates the payload locator before it is turned into SQL.
    /// @details Rejects empty primary key sets and, in strict mode, null primary key values
    /// (`col = NULL` never matches, which would otherwise be a silent no-op).
    /// @return Ok(()) when the locator is usable, or a message describing the defect.
    pub fn validate_locator(&self) -> Result<(), String> {
        if self.primary_keys.is_empty() {
            return Err("Primary keys must not be empty for row mutation".to_string());
        }
        if self.expect_single_row {
            let null_keys: Vec<&str> = self
                .primary_keys
                .iter()
                .filter(|(_, v)| v.is_null())
                .map(|(k, _)| k.as_str())
                .collect();
            if !null_keys.is_empty() {
                return Err(format!(
                    "Cannot identify a single row: primary key column(s) {} are NULL",
                    null_keys.join(", ")
                ));
            }
        }
        Ok(())
    }

    /// @brief Verifies that a statement affected the expected number of rows.
    /// @details In strict mode a batch is rolled back unless exactly one row was affected,
    /// which converts silent multi-row corruption into a hard error.
    /// @param affected Row count reported by the database for this statement.
    /// @return Ok(()) when acceptable, or a message describing the mismatch.
    pub fn check_affected_rows(&self, affected: u64) -> Result<(), String> {
        if self.expect_single_row && affected != 1 {
            return Err(format!(
                "Refusing to modify {} row(s) in table '{}' with a single-row locator on primary key ({}) — \
                 the primary key is not unique or no longer matches exactly one row",
                affected,
                self.table,
                self.primary_keys.keys().cloned().collect::<Vec<_>>().join(", ")
            ));
        }
        Ok(())
    }
}
