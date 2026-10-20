//! @file diff_test.rs
//! @brief Unit tests for schema difference calculation engine.
//! @details Validates addition, removal, and modification detection across tables,
//! columns, destructive changes, and foreign key constraints.

use super::*;
use crate::model::schema::{
    CanonicalType, ColumnSchema, DatabaseSchema, ForeignKeySchema, ReferentialAction, TableSchema,
};

/// @brief Tests detection of newly created and dropped tables between schemas.
#[test]
fn test_detect_added_and_dropped_tables() {
    let current = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![TableSchema {
            name: "users".to_string(),
            schema: None,
            columns: vec![],
            foreign_keys: vec![],
            indexes: vec![],
            ui_position: None,
            rename_from: None,
            unsupported_features: vec![],
        }],
    };

    let desired = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![TableSchema {
            name: "orders".to_string(),
            schema: None,
            columns: vec![],
            foreign_keys: vec![],
            indexes: vec![],
            ui_position: None,
            rename_from: None,
            unsupported_features: vec![],
        }],
    };

    let diff = compute_schema_diff(&current, &desired);
    assert_eq!(diff.tables_to_create.len(), 1);
    assert_eq!(diff.tables_to_create[0].name, "orders");
    assert_eq!(diff.tables_to_drop.len(), 1);
    assert_eq!(diff.tables_to_drop[0], "users");
    assert!(!diff.is_empty());
}

/// @brief Tests detection of newly added columns and altered existing columns.
#[test]
fn test_detect_added_and_altered_columns() {
    let current = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![TableSchema {
            name: "users".to_string(),
            schema: None,
            columns: vec![ColumnSchema {
                name: "id".to_string(),
                data_type: CanonicalType::Integer,
                is_primary_key: true,
                is_nullable: false,
                is_auto_increment: true,
                default_value: None,
            }],
            foreign_keys: vec![],
            indexes: vec![],
            ui_position: None,
            rename_from: None,
            unsupported_features: vec![],
        }],
    };

    let desired = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![TableSchema {
            name: "users".to_string(),
            schema: None,
            columns: vec![
                ColumnSchema {
                    name: "id".to_string(),
                    data_type: CanonicalType::BigInt, // Altered type
                    is_primary_key: true,
                    is_nullable: false,
                    is_auto_increment: true,
                    default_value: None,
                },
                ColumnSchema {
                    name: "email".to_string(), // Added column
                    data_type: CanonicalType::Varchar(Some(255)),
                    is_primary_key: false,
                    is_nullable: false,
                    is_auto_increment: false,
                    default_value: None,
                },
            ],
            foreign_keys: vec![],
            indexes: vec![],
            ui_position: None,
            rename_from: None,
            unsupported_features: vec![],
        }],
    };

    let diff = compute_schema_diff(&current, &desired);
    assert_eq!(diff.columns_to_add.len(), 1);
    assert_eq!(diff.columns_to_add[0].0, "users");
    assert_eq!(diff.columns_to_add[0].1.name, "email");

    assert_eq!(diff.columns_to_alter.len(), 1);
    assert_eq!(diff.columns_to_alter[0].table_name, "users");
    assert_eq!(
        diff.columns_to_alter[0].target_column.data_type,
        CanonicalType::BigInt
    );
    assert!(!diff.columns_to_alter[0].is_destructive);
    assert!(!diff.is_empty());
}

/// @brief Tests detection of removed columns in surviving tables.
#[test]
fn test_detect_dropped_columns() {
    let current = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![TableSchema {
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
                },
                ColumnSchema {
                    name: "legacy_notes".to_string(),
                    data_type: CanonicalType::Text,
                    is_primary_key: false,
                    is_nullable: true,
                    is_auto_increment: false,
                    default_value: None,
                },
            ],
            foreign_keys: vec![],
            indexes: vec![],
            ui_position: None,
            rename_from: None,
            unsupported_features: vec![],
        }],
    };

    let desired = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![TableSchema {
            name: "users".to_string(),
            schema: None,
            columns: vec![ColumnSchema {
                name: "id".to_string(),
                data_type: CanonicalType::Integer,
                is_primary_key: true,
                is_nullable: false,
                is_auto_increment: true,
                default_value: None,
            }],
            foreign_keys: vec![],
            indexes: vec![],
            ui_position: None,
            rename_from: None,
            unsupported_features: vec![],
        }],
    };

    let diff = compute_schema_diff(&current, &desired);
    assert_eq!(diff.columns_to_drop.len(), 1);
    assert_eq!(diff.columns_to_drop[0].0, "users");
    assert_eq!(diff.columns_to_drop[0].1, "legacy_notes");
    assert!(!diff.is_empty());
}

/// @brief Tests identification of destructive column alterations (nullable -> not nullable).
#[test]
fn test_detect_destructive_column_alteration() {
    let current = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![TableSchema {
            name: "profiles".to_string(),
            schema: None,
            columns: vec![ColumnSchema {
                name: "bio".to_string(),
                data_type: CanonicalType::Text,
                is_primary_key: false,
                is_nullable: true, // Currently NULL-able
                is_auto_increment: false,
                default_value: None,
            }],
            foreign_keys: vec![],
            indexes: vec![],
            ui_position: None,
            rename_from: None,
            unsupported_features: vec![],
        }],
    };

    let desired = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![TableSchema {
            name: "profiles".to_string(),
            schema: None,
            columns: vec![ColumnSchema {
                name: "bio".to_string(),
                data_type: CanonicalType::Text,
                is_primary_key: false,
                is_nullable: false, // Changed to NOT NULL (destructive)
                is_auto_increment: false,
                default_value: None,
            }],
            foreign_keys: vec![],
            indexes: vec![],
            ui_position: None,
            rename_from: None,
            unsupported_features: vec![],
        }],
    };

    let diff = compute_schema_diff(&current, &desired);
    assert_eq!(diff.columns_to_alter.len(), 1);
    let alt = &diff.columns_to_alter[0];
    assert_eq!(alt.table_name, "profiles");
    assert_eq!(alt.source_column.name, "bio");
    assert!(alt.is_destructive);
}

/// @brief Tests identification of non-destructive column alterations (e.g. not null -> null).
#[test]
fn test_detect_nondestructive_column_alteration() {
    let current = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![TableSchema {
            name: "profiles".to_string(),
            schema: None,
            columns: vec![ColumnSchema {
                name: "status".to_string(),
                data_type: CanonicalType::Varchar(Some(20)),
                is_primary_key: false,
                is_nullable: false, // Current NOT NULL
                is_auto_increment: false,
                default_value: None,
            }],
            foreign_keys: vec![],
            indexes: vec![],
            ui_position: None,
            rename_from: None,
            unsupported_features: vec![],
        }],
    };

    let desired = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![TableSchema {
            name: "profiles".to_string(),
            schema: None,
            columns: vec![ColumnSchema {
                name: "status".to_string(),
                data_type: CanonicalType::Varchar(Some(50)), // Lengthened & made nullable
                is_primary_key: false,
                is_nullable: true, // Non-destructive relaxation
                is_auto_increment: false,
                default_value: None,
            }],
            foreign_keys: vec![],
            indexes: vec![],
            ui_position: None,
            rename_from: None,
            unsupported_features: vec![],
        }],
    };

    let diff = compute_schema_diff(&current, &desired);
    assert_eq!(diff.columns_to_alter.len(), 1);
    let alt = &diff.columns_to_alter[0];
    assert_eq!(alt.table_name, "profiles");
    assert!(!alt.is_destructive);
}

/// @brief Tests detection of added and dropped foreign key constraints.
#[test]
fn test_detect_added_and_dropped_foreign_keys() {
    let current = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![TableSchema {
            name: "orders".to_string(),
            schema: None,
            columns: vec![],
            foreign_keys: vec![ForeignKeySchema {
                constraint_name: "fk_orders_user".to_string(),
                source_column: "user_id".to_string(),
                target_table: "users".to_string(),
                target_column: "id".to_string(),
                on_delete: ReferentialAction::Cascade,
                on_update: ReferentialAction::NoAction,
            }],
            indexes: vec![],
            ui_position: None,
            rename_from: None,
            unsupported_features: vec![],
        }],
    };

    let desired = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![TableSchema {
            name: "orders".to_string(),
            schema: None,
            columns: vec![],
            foreign_keys: vec![ForeignKeySchema {
                constraint_name: "fk_orders_customer".to_string(),
                source_column: "customer_id".to_string(),
                target_table: "customers".to_string(),
                target_column: "id".to_string(),
                on_delete: ReferentialAction::Restrict,
                on_update: ReferentialAction::Cascade,
            }],
            indexes: vec![],
            ui_position: None,
            rename_from: None,
            unsupported_features: vec![],
        }],
    };

    let diff = compute_schema_diff(&current, &desired);
    assert_eq!(diff.foreign_keys_to_drop.len(), 1);
    assert_eq!(diff.foreign_keys_to_drop[0].0, "orders");
    assert_eq!(diff.foreign_keys_to_drop[0].1, "fk_orders_user");

    assert_eq!(diff.foreign_keys_to_add.len(), 1);
    assert_eq!(diff.foreign_keys_to_add[0].0, "orders");
    assert_eq!(
        diff.foreign_keys_to_add[0].1.constraint_name,
        "fk_orders_customer"
    );
    assert!(!diff.is_empty());
}

/// @brief Tests detection of altered foreign keys with identical constraint names.
#[test]
fn test_detect_altered_foreign_key() {
    let current = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![TableSchema {
            name: "orders".to_string(),
            schema: None,
            columns: vec![],
            foreign_keys: vec![ForeignKeySchema {
                constraint_name: "fk_orders_user".to_string(),
                source_column: "user_id".to_string(),
                target_table: "users".to_string(),
                target_column: "id".to_string(),
                on_delete: ReferentialAction::NoAction,
                on_update: ReferentialAction::NoAction,
            }],
            indexes: vec![],
            ui_position: None,
            rename_from: None,
            unsupported_features: vec![],
        }],
    };

    let desired = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![TableSchema {
            name: "orders".to_string(),
            schema: None,
            columns: vec![],
            foreign_keys: vec![ForeignKeySchema {
                constraint_name: "fk_orders_user".to_string(),
                source_column: "user_id".to_string(),
                target_table: "users".to_string(),
                target_column: "id".to_string(),
                on_delete: ReferentialAction::Cascade, // Action modified
                on_update: ReferentialAction::Cascade, // Action modified
            }],
            indexes: vec![],
            ui_position: None,
            rename_from: None,
            unsupported_features: vec![],
        }],
    };

    let diff = compute_schema_diff(&current, &desired);
    // Modified constraint should be dropped and re-added
    assert_eq!(diff.foreign_keys_to_drop.len(), 1);
    assert_eq!(diff.foreign_keys_to_drop[0].1, "fk_orders_user");
    assert_eq!(diff.foreign_keys_to_add.len(), 1);
    assert_eq!(
        diff.foreign_keys_to_add[0].1.on_delete,
        ReferentialAction::Cascade
    );
}

/// @brief Tests that comparing identical schemas produces an empty diff.
#[test]
fn test_identical_schemas_diff_is_empty() {
    let schema = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![TableSchema {
            name: "users".to_string(),
            schema: None,
            columns: vec![ColumnSchema {
                name: "id".to_string(),
                data_type: CanonicalType::Integer,
                is_primary_key: true,
                is_nullable: false,
                is_auto_increment: true,
                default_value: None,
            }],
            foreign_keys: vec![],
            indexes: vec![],
            ui_position: None,
            rename_from: None,
            unsupported_features: vec![],
        }],
    };

    let diff = compute_schema_diff(&schema, &schema);
    assert!(diff.is_empty());
}

/// @brief Tests that comparing empty database schemas produces an empty diff.
#[test]
fn test_empty_schemas_diff_is_empty() {
    let empty_schema = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![],
    };

    let diff = compute_schema_diff(&empty_schema, &empty_schema);
    assert!(diff.is_empty());
}

/// @brief Builds a single-table schema for rename and rebuild tests.
/// @param name Table name.
/// @param schema Optional schema namespace.
/// @param rename_from Optional previous name recorded by the modeler.
/// @param columns Table columns.
/// @return DatabaseSchema containing exactly one table.
fn schema_with(
    name: &str,
    schema: Option<&str>,
    rename_from: Option<&str>,
    columns: Vec<ColumnSchema>,
) -> DatabaseSchema {
    DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![TableSchema {
            name: name.to_string(),
            schema: schema.map(|s| s.to_string()),
            columns,
            foreign_keys: vec![],
            indexes: vec![],
            ui_position: None,
            rename_from: rename_from.map(|s| s.to_string()),
            unsupported_features: vec![],
        }],
    }
}

/// @brief Builds a plain non-identity column definition for diff tests.
/// @param name Column name.
/// @param data_type Canonical data type.
/// @param nullable Whether the column accepts NULL.
/// @return ColumnSchema instance.
fn simple_col(name: &str, data_type: CanonicalType, nullable: bool) -> ColumnSchema {
    ColumnSchema {
        name: name.to_string(),
        data_type,
        is_primary_key: false,
        is_nullable: nullable,
        is_auto_increment: false,
        default_value: None,
    }
}

/// @brief Tests that a recorded rename becomes a rename operation, never DROP + CREATE.
#[test]
fn test_rename_detected_instead_of_drop_create() {
    let columns = vec![simple_col("id", CanonicalType::Integer, false)];
    let current = schema_with("orders", None, None, columns.clone());
    let desired = schema_with("purchases", None, Some("orders"), columns);

    let diff = compute_schema_diff(&current, &desired);
    assert!(
        diff.tables_to_drop.is_empty(),
        "rename must not drop the table"
    );
    assert!(
        diff.tables_to_create.is_empty(),
        "rename must not recreate the table"
    );
    assert_eq!(diff.tables_to_rename.len(), 1);
    assert_eq!(diff.tables_to_rename[0].from, "orders");
    assert_eq!(diff.tables_to_rename[0].to, "purchases");
    // Columns are unchanged, so no column churn either.
    assert!(diff.columns_to_add.is_empty());
    assert!(diff.columns_to_drop.is_empty());
    assert!(!diff.is_empty());
}

/// @brief Tests that the same table name in two schemas is diffed independently.
#[test]
fn test_multi_schema_tables_do_not_collide() {
    let columns = vec![simple_col("id", CanonicalType::Integer, false)];
    let current = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![
            TableSchema {
                name: "orders".to_string(),
                schema: Some("sales".to_string()),
                columns: columns.clone(),
                foreign_keys: vec![],
                indexes: vec![],
                ui_position: None,
                rename_from: None,
                unsupported_features: vec![],
            },
            TableSchema {
                name: "orders".to_string(),
                schema: Some("public".to_string()),
                columns: columns.clone(),
                foreign_keys: vec![],
                indexes: vec![],
                ui_position: None,
                rename_from: None,
                unsupported_features: vec![],
            },
        ],
    };

    // Drop only the public variant and add a column to the sales variant.
    let mut sales_desired = current.tables[0].clone();
    sales_desired
        .columns
        .push(simple_col("ref", CanonicalType::Text, true));

    let desired = DatabaseSchema {
        database_name: "test".to_string(),
        tables: vec![sales_desired],
    };

    let diff = compute_schema_diff(&current, &desired);
    assert_eq!(diff.tables_to_drop, vec!["public.orders".to_string()]);
    assert!(diff.tables_to_create.is_empty());
    assert_eq!(diff.columns_to_add.len(), 1);
    assert_eq!(diff.columns_to_add[0].0, "sales.orders");
}

/// @brief Tests that shrinking a column type is flagged as destructive.
#[test]
fn test_narrowing_type_is_destructive() {
    let current = schema_with(
        "metrics",
        None,
        None,
        vec![simple_col("score", CanonicalType::BigInt, false)],
    );
    let desired = schema_with(
        "metrics",
        None,
        None,
        vec![simple_col("score", CanonicalType::Integer, false)],
    );

    let diff = compute_schema_diff(&current, &desired);
    assert_eq!(diff.columns_to_alter.len(), 1);
    assert!(diff.columns_to_alter[0].is_destructive);
    // The alteration also schedules a rebuild for dialects without ALTER COLUMN.
    assert_eq!(diff.tables_to_rebuild.len(), 1);
    assert_eq!(diff.tables_to_rebuild[0].table_name, "metrics");
}

/// @brief Tests that widening a column type is not flagged as destructive.
#[test]
fn test_widening_type_is_not_destructive() {
    let current = schema_with(
        "metrics",
        None,
        None,
        vec![simple_col("score", CanonicalType::Integer, false)],
    );
    let desired = schema_with(
        "metrics",
        None,
        None,
        vec![simple_col("score", CanonicalType::BigInt, false)],
    );

    let diff = compute_schema_diff(&current, &desired);
    assert_eq!(diff.columns_to_alter.len(), 1);
    assert!(!diff.columns_to_alter[0].is_destructive);
}

/// @brief Tests that a rebuild records which columns can be copied across.
#[test]
fn test_rebuild_copy_columns_exclude_new_columns() {
    let current = schema_with(
        "people",
        None,
        None,
        vec![
            simple_col("id", CanonicalType::Integer, false),
            simple_col("name", CanonicalType::Text, false),
        ],
    );
    let desired = schema_with(
        "people",
        None,
        None,
        vec![
            simple_col("id", CanonicalType::Integer, false),
            simple_col("name", CanonicalType::Varchar(Some(50)), false),
            simple_col("email", CanonicalType::Text, true),
        ],
    );

    let diff = compute_schema_diff(&current, &desired);
    assert_eq!(diff.tables_to_rebuild.len(), 1);
    assert_eq!(
        diff.tables_to_rebuild[0].copy_columns,
        vec!["id".to_string(), "name".to_string()]
    );
    assert_eq!(diff.tables_to_rebuild[0].target.columns.len(), 3);
}
