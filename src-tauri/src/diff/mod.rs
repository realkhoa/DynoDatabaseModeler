//! @file mod.rs
//! @brief Schema difference calculation engine.
//! @details Compares live introspected database schemas with target desired schemas
//! to compute fine-grained structural alterations.

pub mod ddl;
#[cfg(test)]
mod diff_test;
pub mod model;

use crate::model::schema::DatabaseSchema;
pub use model::*;

/// @brief Computes structural diff between live schema and user-edited desired schema.
/// @details Compares tables, columns, alterations, and foreign key constraints between two database schemas.
/// @param current Reference to the current live database schema.
/// @param desired Reference to the target desired database schema.
/// @return Structured SchemaDiff detailing additions, removals, and modifications.
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

    // 3. Detect column and foreign key changes in surviving tables
    for des_table in &desired.tables {
        if let Some(cur_table) = current.tables.iter().find(|t| t.name == des_table.name) {
            // Columns to add
            for des_col in &des_table.columns {
                if !cur_table.columns.iter().any(|c| c.name == des_col.name) {
                    diff.columns_to_add
                        .push((des_table.name.clone(), des_col.clone()));
                }
            }

            // Columns to drop
            for cur_col in &cur_table.columns {
                if !des_table.columns.iter().any(|c| c.name == cur_col.name) {
                    diff.columns_to_drop
                        .push((des_table.name.clone(), cur_col.name.clone()));
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

            // Foreign keys to add (new constraints or modified constraints)
            for des_fk in &des_table.foreign_keys {
                let is_unaltered = cur_table.foreign_keys.iter().any(|f| f == des_fk);
                if !is_unaltered {
                    diff.foreign_keys_to_add
                        .push((des_table.name.clone(), des_fk.clone()));
                }
            }

            // Foreign keys to drop (removed constraints or modified constraints)
            for cur_fk in &cur_table.foreign_keys {
                let is_unaltered = des_table.foreign_keys.iter().any(|f| f == cur_fk);
                if !is_unaltered {
                    diff.foreign_keys_to_drop
                        .push((des_table.name.clone(), cur_fk.constraint_name.clone()));
                }
            }
        }
    }

    diff
}
