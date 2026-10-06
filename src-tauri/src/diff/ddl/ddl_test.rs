//! @file ddl_test.rs
//! @brief Unit tests for multi-dialect SQL DDL generation.
//! @details Validates DDL output for PostgreSQL, SQLite, MySQL, and Microsoft SQL Server,
//! covering table creation, drops, column additions, alterations, and foreign key constraints.

use super::*;
use crate::diff::model::{ColumnAlteration, SchemaDiff};
use crate::model::connection::DatabaseType;
use crate::model::schema::{
    CanonicalType, ColumnSchema, ForeignKeySchema, ReferentialAction, TableSchema,
};

/// @brief Tests table creation DDL generation for PostgreSQL.
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
    assert!(statements[0].contains("\"name\" VARCHAR(100) NOT NULL"));
}

/// @brief Tests column addition DDL generation for SQLite.
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
    assert_eq!(
        statements[0],
        "ALTER TABLE \"users\" ADD COLUMN \"age\" INTEGER;"
    );
}

/// @brief Tests column alterations and foreign key constraints for PostgreSQL.
#[test]
fn test_generate_alter_and_fk_postgres() {
    let mut diff = SchemaDiff::default();
    diff.tables_to_drop.push("old_logs".to_string());
    diff.columns_to_drop
        .push(("users".to_string(), "legacy_token".to_string()));
    diff.columns_to_alter.push(ColumnAlteration {
        table_name: "users".to_string(),
        source_column: ColumnSchema {
            name: "role".to_string(),
            data_type: CanonicalType::Varchar(Some(20)),
            is_primary_key: false,
            is_nullable: true,
            is_auto_increment: false,
            default_value: None,
        },
        target_column: ColumnSchema {
            name: "role".to_string(),
            data_type: CanonicalType::Varchar(Some(50)),
            is_primary_key: false,
            is_nullable: false,
            is_auto_increment: false,
            default_value: None,
        },
        is_destructive: true,
    });
    diff.foreign_keys_to_add.push((
        "orders".to_string(),
        ForeignKeySchema {
            constraint_name: "fk_orders_user".to_string(),
            source_column: "user_id".to_string(),
            target_table: "users".to_string(),
            target_column: "id".to_string(),
            on_delete: ReferentialAction::Cascade,
            on_update: ReferentialAction::NoAction,
        },
    ));
    diff.foreign_keys_to_drop
        .push(("orders".to_string(), "fk_old_customer".to_string()));

    let statements = generate_ddl(&diff, DatabaseType::Postgres);
    assert!(statements
        .iter()
        .any(|s| s == "ALTER TABLE \"orders\" DROP CONSTRAINT IF EXISTS \"fk_old_customer\";"));
    assert!(statements
        .iter()
        .any(|s| s == "DROP TABLE IF EXISTS \"old_logs\" CASCADE;"));
    assert!(statements
        .iter()
        .any(|s| s == "ALTER TABLE \"users\" DROP COLUMN IF EXISTS \"legacy_token\" CASCADE;"));
    assert!(statements
        .iter()
        .any(|s| s == "ALTER TABLE \"users\" ALTER COLUMN \"role\" TYPE VARCHAR(50);"));
    assert!(statements
        .iter()
        .any(|s| s == "ALTER TABLE \"users\" ALTER COLUMN \"role\" SET NOT NULL;"));
    assert!(statements.iter().any(|s| s
        == "ALTER TABLE \"orders\" ADD CONSTRAINT \"fk_orders_user\" FOREIGN KEY (\"user_id\") REFERENCES \"users\" (\"id\") ON DELETE CASCADE;"));
}

/// @brief Tests table creation with auto-increment, modify column, and foreign keys for MySQL.
#[test]
fn test_generate_mysql_ddl() {
    let mut diff = SchemaDiff::default();
    diff.tables_to_create.push(TableSchema {
        name: "posts".to_string(),
        schema: None,
        columns: vec![ColumnSchema {
            name: "id".to_string(),
            data_type: CanonicalType::BigInt,
            is_primary_key: true,
            is_nullable: false,
            is_auto_increment: true,
            default_value: None,
        }],
        foreign_keys: vec![],
        indexes: vec![],
        ui_position: None,
    });
    diff.columns_to_alter.push(ColumnAlteration {
        table_name: "posts".to_string(),
        source_column: ColumnSchema {
            name: "title".to_string(),
            data_type: CanonicalType::Varchar(Some(100)),
            is_primary_key: false,
            is_nullable: true,
            is_auto_increment: false,
            default_value: None,
        },
        target_column: ColumnSchema {
            name: "title".to_string(),
            data_type: CanonicalType::Varchar(Some(255)),
            is_primary_key: false,
            is_nullable: false,
            is_auto_increment: false,
            default_value: None,
        },
        is_destructive: false,
    });
    diff.foreign_keys_to_add.push((
        "posts".to_string(),
        ForeignKeySchema {
            constraint_name: "fk_posts_author".to_string(),
            source_column: "author_id".to_string(),
            target_table: "users".to_string(),
            target_column: "id".to_string(),
            on_delete: ReferentialAction::Cascade,
            on_update: ReferentialAction::Restrict,
        },
    ));
    diff.foreign_keys_to_drop
        .push(("posts".to_string(), "fk_posts_old".to_string()));

    let statements = generate_ddl(&diff, DatabaseType::MySql);
    assert!(statements
        .iter()
        .any(|s| s == "ALTER TABLE `posts` DROP FOREIGN KEY `fk_posts_old`;"));
    assert!(statements.iter().any(|s| s.contains("CREATE TABLE `posts`")
        && s.contains("`id` BIGINT AUTO_INCREMENT PRIMARY KEY")));
    assert!(statements
        .iter()
        .any(|s| s == "ALTER TABLE `posts` MODIFY COLUMN `title` VARCHAR(255) NOT NULL;"));
    assert!(statements.iter().any(|s| s
        == "ALTER TABLE `posts` ADD CONSTRAINT `fk_posts_author` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT;"));
}

/// @brief Tests table creation with IDENTITY, alter column, and brackets for MSSQL.
#[test]
fn test_generate_mssql_ddl() {
    let mut diff = SchemaDiff::default();
    diff.tables_to_create.push(TableSchema {
        name: "employees".to_string(),
        schema: Some("hr".to_string()),
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
    });
    diff.columns_to_alter.push(ColumnAlteration {
        table_name: "employees".to_string(),
        source_column: ColumnSchema {
            name: "department".to_string(),
            data_type: CanonicalType::Varchar(Some(50)),
            is_primary_key: false,
            is_nullable: true,
            is_auto_increment: false,
            default_value: None,
        },
        target_column: ColumnSchema {
            name: "department".to_string(),
            data_type: CanonicalType::Varchar(Some(100)),
            is_primary_key: false,
            is_nullable: false,
            is_auto_increment: false,
            default_value: None,
        },
        is_destructive: false,
    });
    diff.foreign_keys_to_add.push((
        "employees".to_string(),
        ForeignKeySchema {
            constraint_name: "fk_emp_dept".to_string(),
            source_column: "dept_id".to_string(),
            target_table: "departments".to_string(),
            target_column: "id".to_string(),
            on_delete: ReferentialAction::Cascade,
            on_update: ReferentialAction::NoAction,
        },
    ));
    diff.foreign_keys_to_drop
        .push(("employees".to_string(), "fk_emp_old".to_string()));

    let statements = generate_ddl(&diff, DatabaseType::Mssql);
    assert!(statements
        .iter()
        .any(|s| s == "ALTER TABLE [employees] DROP CONSTRAINT [fk_emp_old];"));
    assert!(statements
        .iter()
        .any(|s| s.contains("CREATE TABLE [hr].[employees]")
            && s.contains("[id] INT IDENTITY(1,1) PRIMARY KEY")));
    assert!(statements
        .iter()
        .any(|s| s == "ALTER TABLE [employees] ALTER COLUMN [department] VARCHAR(100) NOT NULL;"));
    assert!(statements.iter().any(|s| s
        == "ALTER TABLE [employees] ADD CONSTRAINT [fk_emp_dept] FOREIGN KEY ([dept_id]) REFERENCES [departments] ([id]) ON DELETE CASCADE;"));
}

/// @brief Tests that an empty SchemaDiff yields zero DDL statements across all dialects.
#[test]
fn test_generate_empty_diff_returns_empty_ddl() {
    let diff = SchemaDiff::default();

    for dialect in [
        DatabaseType::Postgres,
        DatabaseType::Sqlite,
        DatabaseType::MySql,
        DatabaseType::Mssql,
    ] {
        let stmts = generate_ddl(&diff, dialect);
        assert!(
            stmts.is_empty(),
            "Expected empty DDL for dialect {:?}",
            dialect
        );
    }
}

/// @brief Tests SQLite CREATE TABLE with inline foreign key constraints.
#[test]
fn test_generate_sqlite_create_table_with_foreign_key() {
    let mut diff = SchemaDiff::default();
    diff.tables_to_create.push(TableSchema {
        name: "orders".to_string(),
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
                name: "user_id".to_string(),
                data_type: CanonicalType::Integer,
                is_primary_key: false,
                is_nullable: false,
                is_auto_increment: false,
                default_value: None,
            },
        ],
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
    });

    let statements = generate_ddl(&diff, DatabaseType::Sqlite);
    assert_eq!(statements.len(), 1);
    assert!(statements[0].contains("CREATE TABLE \"orders\""));
    assert!(statements[0].contains("\"id\" INTEGER PRIMARY KEY AUTOINCREMENT"));
    assert!(statements[0]
        .contains("FOREIGN KEY (\"user_id\") REFERENCES \"users\" (\"id\") ON DELETE CASCADE"));
}

/// @brief Tests canonical type formatting across dialects including decimals, booleans, and json.
#[test]
fn test_canonical_types_ddl_across_dialects() {
    let mut diff = SchemaDiff::default();
    diff.tables_to_create.push(TableSchema {
        name: "data_types".to_string(),
        schema: None,
        columns: vec![
            ColumnSchema {
                name: "c_dec".to_string(),
                data_type: CanonicalType::Decimal {
                    precision: Some(12),
                    scale: Some(4),
                },
                is_primary_key: false,
                is_nullable: false,
                is_auto_increment: false,
                default_value: Some("0.00".to_string()),
            },
            ColumnSchema {
                name: "c_bool".to_string(),
                data_type: CanonicalType::Boolean,
                is_primary_key: false,
                is_nullable: false,
                is_auto_increment: false,
                default_value: Some("true".to_string()),
            },
            ColumnSchema {
                name: "c_json".to_string(),
                data_type: CanonicalType::Json,
                is_primary_key: false,
                is_nullable: true,
                is_auto_increment: false,
                default_value: None,
            },
            ColumnSchema {
                name: "c_bin".to_string(),
                data_type: CanonicalType::Binary,
                is_primary_key: false,
                is_nullable: true,
                is_auto_increment: false,
                default_value: None,
            },
        ],
        foreign_keys: vec![],
        indexes: vec![],
        ui_position: None,
    });

    let pg_stmts = generate_ddl(&diff, DatabaseType::Postgres);
    assert!(pg_stmts[0].contains("\"c_dec\" DECIMAL(12, 4) NOT NULL DEFAULT 0.00"));
    assert!(pg_stmts[0].contains("\"c_bool\" BOOLEAN NOT NULL DEFAULT true"));
    assert!(pg_stmts[0].contains("\"c_json\" JSONB"));
    assert!(pg_stmts[0].contains("\"c_bin\" BYTEA"));

    let mysql_stmts = generate_ddl(&diff, DatabaseType::MySql);
    assert!(mysql_stmts[0].contains("`c_dec` DECIMAL(12, 4) NOT NULL DEFAULT 0.00"));
    assert!(mysql_stmts[0].contains("`c_bool` TINYINT(1) NOT NULL DEFAULT true"));
    assert!(mysql_stmts[0].contains("`c_json` JSON"));
    assert!(mysql_stmts[0].contains("`c_bin` BLOB"));

    let mssql_stmts = generate_ddl(&diff, DatabaseType::Mssql);
    assert!(mssql_stmts[0].contains("[c_dec] DECIMAL(12, 4) NOT NULL DEFAULT 0.00"));
    assert!(mssql_stmts[0].contains("[c_bool] BIT NOT NULL DEFAULT true"));
    assert!(mssql_stmts[0].contains("[c_json] NVARCHAR(MAX)"));
    assert!(mssql_stmts[0].contains("[c_bin] VARBINARY(MAX)"));

    let sqlite_stmts = generate_ddl(&diff, DatabaseType::Sqlite);
    assert!(sqlite_stmts[0].contains("\"c_dec\" REAL NOT NULL DEFAULT 0.00"));
    assert!(sqlite_stmts[0].contains("\"c_bool\" INTEGER NOT NULL DEFAULT true"));
    assert!(sqlite_stmts[0].contains("\"c_json\" TEXT"));
    assert!(sqlite_stmts[0].contains("\"c_bin\" BLOB"));
}

/// @brief Tests that MySQL MODIFY COLUMN does not re-specify PRIMARY KEY, avoiding Error 1068.
#[test]
fn test_mysql_modify_column_omits_primary_key() {
    let mut diff = SchemaDiff::default();
    diff.columns_to_alter.push(ColumnAlteration {
        table_name: "accounts".to_string(),
        source_column: ColumnSchema {
            name: "id".to_string(),
            data_type: CanonicalType::Integer,
            is_primary_key: true,
            is_nullable: false,
            is_auto_increment: true,
            default_value: None,
        },
        target_column: ColumnSchema {
            name: "id".to_string(),
            data_type: CanonicalType::BigInt,
            is_primary_key: true,
            is_nullable: false,
            is_auto_increment: true,
            default_value: None,
        },
        is_destructive: false,
    });

    let statements = generate_ddl(&diff, DatabaseType::MySql);
    assert_eq!(statements.len(), 1);
    assert_eq!(
        statements[0],
        "ALTER TABLE `accounts` MODIFY COLUMN `id` BIGINT AUTO_INCREMENT NOT NULL;"
    );
    assert!(!statements[0].contains("PRIMARY KEY"));
}

/// @brief Tests fully-qualified table schema format in FK creation for PostgreSQL and MSSQL.
#[test]
fn test_fk_creation_uses_fully_qualified_schema() {
    let mut diff = SchemaDiff::default();
    diff.tables_to_create.push(TableSchema {
        name: "orders".to_string(),
        schema: Some("sales".to_string()),
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
                name: "customer_id".to_string(),
                data_type: CanonicalType::BigInt,
                is_primary_key: false,
                is_nullable: false,
                is_auto_increment: false,
                default_value: None,
            },
        ],
        foreign_keys: vec![ForeignKeySchema {
            constraint_name: "fk_orders_customer".to_string(),
            source_column: "customer_id".to_string(),
            target_table: "sales.customers".to_string(),
            target_column: "id".to_string(),
            on_delete: ReferentialAction::Cascade,
            on_update: ReferentialAction::NoAction,
        }],
        indexes: vec![],
        ui_position: None,
    });

    // PostgreSQL: "sales"."orders" referencing "sales"."customers"
    let pg_stmts = generate_ddl(&diff, DatabaseType::Postgres);
    assert!(pg_stmts.iter().any(|s| s
        == "ALTER TABLE \"sales\".\"orders\" ADD CONSTRAINT \"fk_orders_customer\" FOREIGN KEY (\"customer_id\") REFERENCES \"sales\".\"customers\" (\"id\") ON DELETE CASCADE;"));

    // MSSQL: [sales].[orders] referencing [sales].[customers]
    let mssql_stmts = generate_ddl(&diff, DatabaseType::Mssql);
    assert!(mssql_stmts.iter().any(|s| s
        == "ALTER TABLE [sales].[orders] ADD CONSTRAINT [fk_orders_customer] FOREIGN KEY ([customer_id]) REFERENCES [sales].[customers] ([id]) ON DELETE CASCADE;"));
}
