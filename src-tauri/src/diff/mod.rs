//! @file mod.rs
//! @brief Schema difference calculation engine.
//! @details Compares live introspected database schemas with target desired schemas
//! to compute fine-grained structural alterations. Tables are matched by their
//! fully-qualified identity (`schema.name`) so multi-schema databases diff correctly.

pub mod ddl;
#[cfg(test)]
mod diff_test;
pub mod model;

use crate::model::schema::{DatabaseSchema, TableSchema};
pub use model::*;

/// @brief Identity key used to match tables across the live and desired schemas.
/// @details Multi-schema databases can contain the same table name in different namespaces,
/// so matching on the bare name would collapse `sales.orders` and `public.orders`.
/// @param table Reference to a table schema.
/// @return Fully-qualified `schema.name` key, or the bare name when no schema is set.
pub fn table_key(table: &TableSchema) -> String {
    table.qualified_name()
}

/// @brief Normalizes a nullable schema name for comparisons.
/// @param schema Optional schema name.
/// @return Trimmed schema name, or `None` when empty or absent.
fn normalize_schema(schema: &Option<String>) -> Option<String> {
    schema
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// @brief Resolves the live table that a desired table should be compared against.
/// @details Handles three cases: an explicit user rename recorded as `rename_from`,
/// an identity match on the qualified name, and a bare-name match when only one side
/// carries a schema (e.g. a newly drawn table in the modeler).
/// @param current All live tables.
/// @param desired The desired table being matched.
/// @param claimed Keys of live tables already matched by another desired table.
/// @return Reference to the matching live table, if any.
fn match_current_table<'a>(
    current: &'a [TableSchema],
    desired: &TableSchema,
    claimed: &[String],
) -> Option<&'a TableSchema> {
    let is_free = |t: &TableSchema| !claimed.contains(&table_key(t));

    // 1. Explicit rename recorded by the modeler.
    if let Some(from) = desired.rename_from.as_ref() {
        if let Some(found) = current.iter().find(|t| is_free(t) && &table_key(t) == from) {
            return Some(found);
        }
    }

    // 2. Exact qualified-name match.
    let key = table_key(desired);
    if let Some(found) = current.iter().find(|t| is_free(t) && table_key(t) == key) {
        return Some(found);
    }

    // 3. Bare-name match (schema absent on one side only).
    let desired_schema = normalize_schema(&desired.schema);
    if desired_schema.is_none() {
        if let Some(found) = current
            .iter()
            .find(|t| is_free(t) && t.name == desired.name)
        {
            return Some(found);
        }
    }

    None
}

/// @brief Computes structural diff between live schema and user-edited desired schema.
/// @details Compares tables, columns, alterations, and foreign key constraints between two
/// database schemas. Tables are matched by qualified identity; explicit renames become
/// `ALTER TABLE ... RENAME` operations instead of DROP + CREATE pairs, and any change that a
/// dialect cannot express in place is recorded as a rebuild request rather than dropped.
/// @param current Reference to the current live database schema.
/// @param desired Reference to the target desired database schema.
/// @return Structured SchemaDiff detailing additions, removals, renames, and modifications.
pub fn compute_schema_diff(current: &DatabaseSchema, desired: &DatabaseSchema) -> SchemaDiff {
    let mut diff = SchemaDiff::default();

    // 1. Match every desired table to a live counterpart (identity or explicit rename).
    let mut claimed: Vec<String> = Vec::new();
    let mut matched: Vec<(&TableSchema, &TableSchema)> = Vec::new();

    for des_table in &desired.tables {
        if let Some(cur_table) = match_current_table(&current.tables, des_table, &claimed) {
            claimed.push(table_key(cur_table));
            matched.push((cur_table, des_table));
        } else {
            diff.tables_to_create.push(des_table.clone());
        }
    }

    // 2. Detect renamed tables (destructive DROP + CREATE would otherwise be generated).
    for (cur_table, des_table) in &matched {
        let from = table_key(cur_table);
        let to = table_key(des_table);
        if from != to {
            diff.tables_to_rename.push(TableRename { from, to });
        }
    }

    // 3. Detect dropped tables: live tables that no desired table claimed.
    for cur_table in &current.tables {
        if !claimed.contains(&table_key(cur_table)) {
            diff.tables_to_drop.push(table_key(cur_table));
        }
    }

    // 4. Detect column and foreign key changes in surviving tables.
    for (cur_table, des_table) in &matched {
        // Statements are generated after renames, so always address the desired name.
        let target_key = table_key(des_table);

        // Columns to add
        for des_col in &des_table.columns {
            if !cur_table.columns.iter().any(|c| c.name == des_col.name) {
                diff.columns_to_add
                    .push((target_key.clone(), des_col.clone()));
            }
        }

        // Columns to drop
        for cur_col in &cur_table.columns {
            if !des_table.columns.iter().any(|c| c.name == cur_col.name) {
                diff.columns_to_drop
                    .push((target_key.clone(), cur_col.name.clone()));
            }
        }

        // Columns to alter
        for des_col in &des_table.columns {
            if let Some(cur_col) = cur_table.columns.iter().find(|c| c.name == des_col.name) {
                if cur_col != des_col {
                    let is_destructive = is_destructive_alteration(cur_col, des_col);
                    diff.columns_to_alter.push(ColumnAlteration {
                        table_name: target_key.clone(),
                        source_column: cur_col.clone(),
                        target_column: des_col.clone(),
                        is_destructive,
                    });
                }
            }
        }

        // Foreign keys to add (new constraints or modified constraints)
        for des_fk in &des_table.foreign_keys {
            if !cur_table.foreign_keys.iter().any(|f| f == des_fk) {
                diff.foreign_keys_to_add
                    .push((target_key.clone(), des_fk.clone()));
            }
        }

        // Foreign keys to drop (removed constraints or modified constraints)
        for cur_fk in &cur_table.foreign_keys {
            if !des_table.foreign_keys.iter().any(|f| f == cur_fk) {
                diff.foreign_keys_to_drop
                    .push((target_key.clone(), cur_fk.constraint_name.clone()));
            }
        }

        // Indexes defined in the model but missing/changed on the live table.
        for des_idx in &des_table.indexes {
            if !cur_table.indexes.iter().any(|i| i == des_idx) {
                diff.indexes_to_create
                    .push((target_key.clone(), des_idx.clone()));
            }
        }
        for cur_idx in &cur_table.indexes {
            if !des_table.indexes.iter().any(|i| i == cur_idx) {
                diff.indexes_to_drop
                    .push((target_key.clone(), cur_idx.name.clone()));
            }
        }

        // 5. Decide whether this table needs a rebuild on dialects without ALTER COLUMN.
        let needs_rebuild = diff
            .columns_to_alter
            .iter()
            .any(|a| a.table_name == target_key)
            || diff.columns_to_drop.iter().any(|(t, _)| t == &target_key)
            || diff
                .foreign_keys_to_add
                .iter()
                .any(|(t, _)| t == &target_key)
            || diff
                .foreign_keys_to_drop
                .iter()
                .any(|(t, _)| t == &target_key);

        if needs_rebuild {
            let copy_columns: Vec<String> = des_table
                .columns
                .iter()
                .filter(|des_col| cur_table.columns.iter().any(|c| c.name == des_col.name))
                .map(|c| c.name.clone())
                .collect();

            diff.tables_to_rebuild.push(TableRebuild {
                table_name: target_key,
                target: (*des_table).clone(),
                copy_columns,
            });
        }
    }

    diff
}

/// @brief Classifies a column alteration as potentially data-destructive.
/// @details Widening a numeric or character column is safe; shrinking a width/precision,
/// converting a timestamp to a date/time, narrowing the numeric family, or adding NOT NULL
/// can fail or lose data and must be surfaced to the user before execution.
/// @param source Current live column definition.
/// @param target Desired column definition.
/// @return `true` when the change can fail or lose data.
pub fn is_destructive_alteration(
    source: &crate::model::schema::ColumnSchema,
    target: &crate::model::schema::ColumnSchema,
) -> bool {
    use crate::model::schema::CanonicalType;

    // Nullable -> NOT NULL can fail on existing NULL rows.
    if source.is_nullable && !target.is_nullable {
        return true;
    }

    // Dropping a primary key constraint changes row identity semantics.
    if source.is_primary_key && !target.is_primary_key {
        return true;
    }

    // Character length or decimal precision shrink truncates data.
    let width = |t: &CanonicalType| -> Option<u32> {
        match t {
            CanonicalType::Varchar(l) | CanonicalType::Char(l) => *l,
            CanonicalType::Decimal { precision, .. } => *precision,
            _ => None,
        }
    };
    if let (Some(from), Some(to)) = (width(&source.data_type), width(&target.data_type)) {
        if to < from {
            return true;
        }
    }

    // Unbounded text converted to a bounded character type may truncate.
    if matches!(source.data_type, CanonicalType::Text)
        && matches!(
            target.data_type,
            CanonicalType::Char(_) | CanonicalType::Varchar(_)
        )
    {
        return true;
    }

    // Timestamp narrowed to date or time discards information.
    if matches!(source.data_type, CanonicalType::Timestamp)
        && matches!(target.data_type, CanonicalType::Date | CanonicalType::Time)
    {
        return true;
    }

    // Narrowing within the numeric family (e.g. DOUBLE -> INTEGER) can lose data.
    fn numeric_rank(t: &CanonicalType) -> Option<u8> {
        match t {
            CanonicalType::SmallInt => Some(1),
            CanonicalType::Integer => Some(2),
            CanonicalType::BigInt => Some(3),
            CanonicalType::Decimal { .. } => Some(4),
            CanonicalType::Float => Some(5),
            CanonicalType::Double => Some(6),
            _ => None,
        }
    }
    if let (Some(from), Some(to)) = (
        numeric_rank(&source.data_type),
        numeric_rank(&target.data_type),
    ) {
        if to < from {
            return true;
        }
    }

    false
}
