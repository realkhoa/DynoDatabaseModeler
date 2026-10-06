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
