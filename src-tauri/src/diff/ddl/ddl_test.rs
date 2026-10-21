//! @file ddl_test.rs
//! @brief Unit tests for multi-dialect SQL DDL generation.
//! @details Validates DDL output for PostgreSQL, SQLite, MySQL, and Microsoft SQL Server,
//! covering table creation, renames, drops, column additions, alterations, index maintenance,
//! SQLite table rebuilds, and foreign key constraints.

use super::*;
use crate::diff::model::{ColumnAlteration, SchemaDiff, TableRebuild, TableRename};
use crate::model::connection::DatabaseType;
use crate::model::schema::{
    CanonicalType, ColumnSchema, ForeignKeySchema, IndexSchema, ReferentialAction, TableSchema,
};

/// @brief Builds a minimal non-identity column definition for DDL tests.
/// @param name Column name.
/// @param data_type Canonical data type.
/// @param primary_key Whether the column is part of the primary key.
/// @param nullable Whether the column accepts NULL.
/// @return ColumnSchema instance.
fn col(name: &str, data_type: CanonicalType, primary_key: bool, nullable: bool) -> ColumnSchema {
    ColumnSchema {
        name: name.to_string(),
        data_type,
        is_primary_key: primary_key,
        is_nullable: nullable,
        is_auto_increment: false,
        default_value: None,
    }
}

/// @brief Builds a table schema with no foreign keys, indexes or layout metadata.
/// @param name Table name.
/// @param schema Optional schema namespace.
/// @param columns Table columns.
/// @return TableSchema instance.
fn table(name: &str, schema: Option<&str>, columns: Vec<ColumnSchema>) -> TableSchema {
    TableSchema {
        name: name.to_string(),
        schema: schema.map(|s| s.to_string()),
        columns,
        foreign_keys: vec![],
        indexes: vec![],
        ui_position: None,
        rename_from: None,
        unsupported_features: vec![],
    }
}

/// @brief Tests table creation DDL generation for PostgreSQL.
#[test]
fn test_generate_create_table_ddl_postgres() {
    let mut diff = SchemaDiff::default();
    let mut id = col("id", CanonicalType::BigInt, true, false);
    id.is_auto_increment = true;
    diff.tables_to_create.push(table(
        "customers",
        Some("public"),
        vec![
            id,
            col("name", CanonicalType::Varchar(Some(100)), false, false),
        ],
    ));

    let out = generate_ddl(&diff, DatabaseType::Postgres);
    assert_eq!(out.statements.len(), 1);
    assert!(out.statements[0].contains("CREATE TABLE \"public\".\"customers\""));
    assert!(out.statements[0].contains("\"id\" BIGSERIAL PRIMARY KEY"));
    assert!(out.statements[0].contains("\"name\" VARCHAR(100) NOT NULL"));
    assert!(out.warnings.is_empty());
}

/// @brief Tests column addition DDL generation for SQLite.
#[test]
fn test_generate_add_column_ddl_sqlite() {
    let mut diff = SchemaDiff::default();
    diff.columns_to_add.push((
        "users".to_string(),
        col("age", CanonicalType::Integer, false, true),
    ));

    let out = generate_ddl(&diff, DatabaseType::Sqlite);
    assert_eq!(out.statements.len(), 1);
    assert_eq!(
        out.statements[0],
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
        source_column: col("role", CanonicalType::Varchar(Some(20)), false, true),
        target_column: col("role", CanonicalType::Varchar(Some(50)), false, false),
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

    let out = generate_ddl(&diff, DatabaseType::Postgres);
    let statements = &out.statements;
    assert!(statements
        .iter()
        .any(|s| s == "ALTER TABLE \"orders\" DROP CONSTRAINT IF EXISTS \"fk_old_customer\";"));
    assert!(statements
        .iter()
        .any(|s| s == "DROP TABLE IF EXISTS \"old_logs\" CASCADE;"));
    assert!(statements
        .iter()
        .any(|s| s == "ALTER TABLE \"users\" DROP COLUMN IF EXISTS \"legacy_token\" CASCADE;"));
    // Type changes carry a USING cast so conversions PostgreSQL cannot do implicitly still work.
    assert!(statements.iter().any(|s| s
        == "ALTER TABLE \"users\" ALTER COLUMN \"role\" TYPE VARCHAR(50) USING \"role\"::VARCHAR(50);"));
    assert!(statements
        .iter()
        .any(|s| s == "ALTER TABLE \"users\" ALTER COLUMN \"role\" SET NOT NULL;"));
    assert!(statements.iter().any(|s| s
        == "ALTER TABLE \"orders\" ADD CONSTRAINT \"fk_orders_user\" FOREIGN KEY (\"user_id\") REFERENCES \"users\" (\"id\") ON DELETE CASCADE;"));
    assert!(out.warnings.is_empty());
}

/// @brief Tests that default value changes are emitted as DROP DEFAULT.
#[test]
fn test_generate_default_change_postgres() {
    let mut diff = SchemaDiff::default();
    let mut source = col("status", CanonicalType::Varchar(Some(20)), false, false);
    source.default_value = Some("'new'".to_string());
    let target = col("status", CanonicalType::Varchar(Some(20)), false, false);

    diff.columns_to_alter.push(ColumnAlteration {
        table_name: "jobs".to_string(),
        source_column: source,
        target_column: target,
        is_destructive: false,
    });

    let out = generate_ddl(&diff, DatabaseType::Postgres);
    assert!(out
        .statements
        .iter()
        .any(|s| s == "ALTER TABLE \"jobs\" ALTER COLUMN \"status\" DROP DEFAULT;"));
}

/// @brief Tests that unsupported primary key changes are reported instead of silently skipped.
#[test]
fn test_unsupported_primary_key_change_is_reported() {
    let mut diff = SchemaDiff::default();
    diff.columns_to_alter.push(ColumnAlteration {
        table_name: "accounts".to_string(),
        source_column: col("id", CanonicalType::Integer, false, false),
        target_column: col("id", CanonicalType::Integer, true, false),
        is_destructive: false,
    });

    let out = generate_ddl(&diff, DatabaseType::Postgres);
    assert!(out.statements.is_empty());
    assert_eq!(out.warnings.len(), 1);
    assert!(out.warnings[0].contains("Primary key change"));
}

/// @brief Tests table creation with auto-increment, modify column, and foreign keys for MySQL.
#[test]
fn test_generate_mysql_ddl() {
    let mut diff = SchemaDiff::default();
    let mut id = col("id", CanonicalType::BigInt, true, false);
    id.is_auto_increment = true;
    diff.tables_to_create.push(table("posts", None, vec![id]));
    diff.columns_to_alter.push(ColumnAlteration {
        table_name: "posts".to_string(),
        source_column: col("title", CanonicalType::Varchar(Some(100)), false, true),
        target_column: col("title", CanonicalType::Varchar(Some(255)), false, false),
        is_destructive: true,
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

    let out = generate_ddl(&diff, DatabaseType::MySql);
    let statements = &out.statements;
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
    let mut id = col("id", CanonicalType::Integer, true, false);
    id.is_auto_increment = true;
    diff.tables_to_create
        .push(table("employees", Some("hr"), vec![id]));
    diff.columns_to_alter.push(ColumnAlteration {
        table_name: "employees".to_string(),
        source_column: col("department", CanonicalType::Varchar(Some(50)), false, true),
        target_column: col(
            "department",
            CanonicalType::Varchar(Some(100)),
            false,
            false,
        ),
        is_destructive: true,
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

    let out = generate_ddl(&diff, DatabaseType::Mssql);
    let statements = &out.statements;
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
        DatabaseType::DuckDb,
        DatabaseType::MariaDb,
        DatabaseType::CockroachDb,
        DatabaseType::LibSql,
        DatabaseType::Redshift,
        DatabaseType::ClickHouse,
        DatabaseType::Universal,
    ] {
        let out = generate_ddl(&diff, dialect);
        assert!(
            out.statements.is_empty(),
            "Expected empty DDL for dialect {:?}",
            dialect
        );
        assert!(out.warnings.is_empty());
    }
}

/// @brief Tests SQLite CREATE TABLE with inline foreign key constraints.
#[test]
fn test_generate_sqlite_create_table_with_foreign_key() {
    let mut diff = SchemaDiff::default();
    let mut orders = table(
        "orders",
        None,
        vec![
            {
                let mut id = col("id", CanonicalType::Integer, true, false);
                id.is_auto_increment = true;
                id
            },
            col("user_id", CanonicalType::Integer, false, false),
        ],
    );
    orders.foreign_keys.push(ForeignKeySchema {
        constraint_name: "fk_orders_user".to_string(),
        source_column: "user_id".to_string(),
        target_table: "users".to_string(),
        target_column: "id".to_string(),
        on_delete: ReferentialAction::Cascade,
        on_update: ReferentialAction::NoAction,
    });
    diff.tables_to_create.push(orders);

    let out = generate_ddl(&diff, DatabaseType::Sqlite);
    assert_eq!(out.statements.len(), 1);
    assert!(out.statements[0].contains("CREATE TABLE \"orders\""));
    assert!(out.statements[0].contains("\"id\" INTEGER PRIMARY KEY AUTOINCREMENT"));
    assert!(out.statements[0]
        .contains("FOREIGN KEY (\"user_id\") REFERENCES \"users\" (\"id\") ON DELETE CASCADE"));
}

/// @brief Tests canonical type formatting across dialects including decimals, booleans, and json.
#[test]
fn test_canonical_types_ddl_across_dialects() {
    let mut diff = SchemaDiff::default();
    let mut dec = col(
        "c_dec",
        CanonicalType::Decimal {
            precision: Some(12),
            scale: Some(4),
        },
        false,
        false,
    );
    dec.default_value = Some("0.00".to_string());
    let mut bool_col = col("c_bool", CanonicalType::Boolean, false, false);
    bool_col.default_value = Some("true".to_string());

    diff.tables_to_create.push(table(
        "data_types",
        None,
        vec![
            dec,
            bool_col,
            col("c_json", CanonicalType::Json, false, true),
            col("c_bin", CanonicalType::Binary, false, true),
        ],
    ));

    let pg_stmts = generate_ddl(&diff, DatabaseType::Postgres).statements;
    assert!(pg_stmts[0].contains("\"c_dec\" DECIMAL(12, 4) NOT NULL DEFAULT 0.00"));
    assert!(pg_stmts[0].contains("\"c_bool\" BOOLEAN NOT NULL DEFAULT true"));
    assert!(pg_stmts[0].contains("\"c_json\" JSONB"));
    assert!(pg_stmts[0].contains("\"c_bin\" BYTEA"));

    let mysql_stmts = generate_ddl(&diff, DatabaseType::MySql).statements;
    assert!(mysql_stmts[0].contains("`c_dec` DECIMAL(12, 4) NOT NULL DEFAULT 0.00"));
    assert!(mysql_stmts[0].contains("`c_bool` TINYINT(1) NOT NULL DEFAULT true"));
    assert!(mysql_stmts[0].contains("`c_json` JSON"));
    assert!(mysql_stmts[0].contains("`c_bin` BLOB"));

    let mssql_stmts = generate_ddl(&diff, DatabaseType::Mssql).statements;
    assert!(mssql_stmts[0].contains("[c_dec] DECIMAL(12, 4) NOT NULL DEFAULT 0.00"));
    assert!(mssql_stmts[0].contains("[c_bool] BIT NOT NULL DEFAULT true"));
    assert!(mssql_stmts[0].contains("[c_json] NVARCHAR(MAX)"));
    assert!(mssql_stmts[0].contains("[c_bin] VARBINARY(MAX)"));

    let sqlite_stmts = generate_ddl(&diff, DatabaseType::Sqlite).statements;
    assert!(sqlite_stmts[0].contains("\"c_dec\" REAL NOT NULL DEFAULT 0.00"));
    assert!(sqlite_stmts[0].contains("\"c_bool\" INTEGER NOT NULL DEFAULT true"));
    assert!(sqlite_stmts[0].contains("\"c_json\" TEXT"));
    assert!(sqlite_stmts[0].contains("\"c_bin\" BLOB"));
}

/// @brief Tests that MySQL MODIFY COLUMN does not re-specify PRIMARY KEY, avoiding Error 1068.
#[test]
fn test_mysql_modify_column_omits_primary_key() {
    let mut diff = SchemaDiff::default();
    let mut source = col("id", CanonicalType::Integer, true, false);
    source.is_auto_increment = true;
    let mut target = col("id", CanonicalType::BigInt, true, false);
    target.is_auto_increment = true;

    diff.columns_to_alter.push(ColumnAlteration {
        table_name: "accounts".to_string(),
        source_column: source,
        target_column: target,
        is_destructive: false,
    });

    let out = generate_ddl(&diff, DatabaseType::MySql);
    assert_eq!(out.statements.len(), 1);
    assert_eq!(
        out.statements[0],
        "ALTER TABLE `accounts` MODIFY COLUMN `id` BIGINT AUTO_INCREMENT NOT NULL;"
    );
    assert!(!out.statements[0].contains("PRIMARY KEY"));
}

/// @brief Tests fully-qualified table schema format in FK creation for PostgreSQL and MSSQL.
#[test]
fn test_fk_creation_uses_fully_qualified_schema() {
    let mut diff = SchemaDiff::default();
    let mut orders = table(
        "orders",
        Some("sales"),
        vec![
            {
                let mut id = col("id", CanonicalType::BigInt, true, false);
                id.is_auto_increment = true;
                id
            },
            col("customer_id", CanonicalType::BigInt, false, false),
        ],
    );
    orders.foreign_keys.push(ForeignKeySchema {
        constraint_name: "fk_orders_customer".to_string(),
        source_column: "customer_id".to_string(),
        target_table: "sales.customers".to_string(),
        target_column: "id".to_string(),
        on_delete: ReferentialAction::Cascade,
        on_update: ReferentialAction::NoAction,
    });
    diff.tables_to_create.push(orders);

    let pg_stmts = generate_ddl(&diff, DatabaseType::Postgres).statements;
    assert!(pg_stmts.iter().any(|s| s
        == "ALTER TABLE \"sales\".\"orders\" ADD CONSTRAINT \"fk_orders_customer\" FOREIGN KEY (\"customer_id\") REFERENCES \"sales\".\"customers\" (\"id\") ON DELETE CASCADE;"));

    let mssql_stmts = generate_ddl(&diff, DatabaseType::Mssql).statements;
    assert!(mssql_stmts.iter().any(|s| s
        == "ALTER TABLE [sales].[orders] ADD CONSTRAINT [fk_orders_customer] FOREIGN KEY ([customer_id]) REFERENCES [sales].[customers] ([id]) ON DELETE CASCADE;"));
}

/// @brief Tests that a recorded rename produces ALTER/RENAME DDL rather than DROP + CREATE.
#[test]
fn test_rename_generates_non_destructive_ddl() {
    let mut diff = SchemaDiff::default();
    diff.tables_to_rename.push(TableRename {
        from: "sales.orders".to_string(),
        to: "sales.purchases".to_string(),
    });

    let pg = generate_ddl(&diff, DatabaseType::Postgres);
    assert_eq!(
        pg.statements,
        vec!["ALTER TABLE \"sales\".\"orders\" RENAME TO \"purchases\";".to_string()]
    );

    let sqlite = generate_ddl(&diff, DatabaseType::Sqlite);
    assert_eq!(
        sqlite.statements,
        vec!["ALTER TABLE \"sales\".\"orders\" RENAME TO \"purchases\";".to_string()]
    );

    let mysql = generate_ddl(&diff, DatabaseType::MySql);
    assert_eq!(
        mysql.statements,
        vec!["RENAME TABLE `sales`.`orders` TO `sales`.`purchases`;".to_string()]
    );

    let mssql = generate_ddl(&diff, DatabaseType::Mssql);
    assert_eq!(
        mssql.statements,
        vec!["EXEC sp_rename N'[sales].[orders]', N'purchases';".to_string()]
    );
}

/// @brief Tests that SQLite expresses an in-place-impossible column change as a table rebuild.
#[test]
fn test_sqlite_alter_column_produces_rebuild() {
    let mut diff = SchemaDiff::default();
    diff.columns_to_alter.push(ColumnAlteration {
        table_name: "users".to_string(),
        source_column: col("nickname", CanonicalType::Text, false, true),
        target_column: col("nickname", CanonicalType::Varchar(Some(50)), false, true),
        is_destructive: true,
    });

    let mut target = table(
        "users",
        None,
        vec![
            {
                let mut id = col("id", CanonicalType::Integer, true, false);
                id.is_auto_increment = true;
                id
            },
            col("nickname", CanonicalType::Varchar(Some(50)), false, true),
        ],
    );
    target.indexes.push(IndexSchema {
        name: "idx_users_nickname".to_string(),
        columns: vec!["nickname".to_string()],
        is_unique: false,
    });

    diff.tables_to_rebuild.push(TableRebuild {
        table_name: "users".to_string(),
        target,
        copy_columns: vec!["id".to_string(), "nickname".to_string()],
    });

    let out = generate_ddl(&diff, DatabaseType::Sqlite);
    assert!(out
        .statements
        .iter()
        .any(|s| s == "DROP TABLE IF EXISTS \"users__dyno_rebuild\";"));
    assert!(out
        .statements
        .iter()
        .any(|s| s.contains("CREATE TABLE \"users__dyno_rebuild\"")));
    assert!(out.statements.iter().any(|s| s
        == "INSERT INTO \"users__dyno_rebuild\" (\"id\", \"nickname\") SELECT \"id\", \"nickname\" FROM \"users\";"));
    assert!(out.statements.iter().any(|s| s == "DROP TABLE \"users\";"));
    assert!(out
        .statements
        .iter()
        .any(|s| s == "ALTER TABLE \"users__dyno_rebuild\" RENAME TO \"users\";"));
    assert!(out
        .statements
        .iter()
        .any(|s| s == "CREATE INDEX \"idx_users_nickname\" ON \"users\" (\"nickname\");"));
    assert_eq!(out.warnings.len(), 1);
    assert!(out.warnings[0].contains("rebuilt"));
}

/// @brief Tests that a SQLite rebuild is refused when the table holds objects it cannot preserve.
#[test]
fn test_sqlite_rebuild_refused_when_unsupported_objects_present() {
    let mut diff = SchemaDiff::default();
    let mut target = table(
        "audited",
        None,
        vec![col("id", CanonicalType::Integer, true, false)],
    );
    target.unsupported_features = vec!["trigger: audit_ins".to_string()];

    diff.tables_to_rebuild.push(TableRebuild {
        table_name: "audited".to_string(),
        target,
        copy_columns: vec!["id".to_string()],
    });

    let out = generate_ddl(&diff, DatabaseType::Sqlite);
    assert!(out.statements.is_empty());
    assert_eq!(out.warnings.len(), 1);
    assert!(out.warnings[0].contains("trigger: audit_ins"));
}

/// @brief Tests that adding a foreign key to an existing SQLite table is reported, not ignored.
#[test]
fn test_sqlite_fk_change_on_existing_table_is_reported() {
    let mut diff = SchemaDiff::default();
    diff.foreign_keys_to_add.push((
        "orders".to_string(),
        ForeignKeySchema {
            constraint_name: "fk_orders_user".to_string(),
            source_column: "user_id".to_string(),
            target_table: "users".to_string(),
            target_column: "id".to_string(),
            on_delete: ReferentialAction::NoAction,
            on_update: ReferentialAction::NoAction,
        },
    ));

    let out = generate_ddl(&diff, DatabaseType::Sqlite);
    assert!(out.statements.is_empty());
    assert_eq!(out.warnings.len(), 1);
    assert!(out.warnings[0].contains("cannot add a foreign key"));
}

/// @brief Tests index creation and removal DDL across dialects.
#[test]
fn test_index_create_and_drop_ddl() {
    let mut diff = SchemaDiff::default();
    diff.indexes_to_create.push((
        "sales.orders".to_string(),
        IndexSchema {
            name: "idx_orders_ref".to_string(),
            columns: vec!["ref".to_string(), "customer_id".to_string()],
            is_unique: true,
        },
    ));
    diff.indexes_to_drop
        .push(("sales.orders".to_string(), "idx_orders_old".to_string()));

    let pg = generate_ddl(&diff, DatabaseType::Postgres);
    assert!(pg.statements.iter().any(|s| s
        == "CREATE UNIQUE INDEX \"idx_orders_ref\" ON \"sales\".\"orders\" (\"ref\", \"customer_id\");"));
    assert!(pg
        .statements
        .iter()
        .any(|s| s == "DROP INDEX IF EXISTS \"idx_orders_old\";"));

    let mysql = generate_ddl(&diff, DatabaseType::MySql);
    assert!(mysql
        .statements
        .iter()
        .any(|s| s
            == "CREATE UNIQUE INDEX `idx_orders_ref` ON `sales`.`orders` (`ref`, `customer_id`);"));
    assert!(mysql
        .statements
        .iter()
        .any(|s| s == "DROP INDEX `idx_orders_old` ON `sales`.`orders`;"));

    let mssql = generate_ddl(&diff, DatabaseType::Mssql);
    assert!(mssql
        .statements
        .iter()
        .any(|s| s
            == "CREATE UNIQUE INDEX [idx_orders_ref] ON [sales].[orders] ([ref], [customer_id]);"));
    assert!(mssql
        .statements
        .iter()
        .any(|s| s == "DROP INDEX [idx_orders_old] ON [sales].[orders];"));
}

/// @brief Tests that identifiers containing the dialect quote character are escaped.
#[test]
fn test_identifier_quote_escaping() {
    let mut diff = SchemaDiff::default();
    diff.tables_to_drop.push("we\"ird".to_string());

    let pg = generate_ddl(&diff, DatabaseType::Postgres);
    assert_eq!(
        pg.statements[0],
        "DROP TABLE IF EXISTS \"we\"\"ird\" CASCADE;"
    );

    let mysql = generate_ddl(&diff, DatabaseType::MySql);
    assert_eq!(mysql.statements[0], "DROP TABLE IF EXISTS `we\"ird`;");

    let mssql = generate_ddl(&diff, DatabaseType::Mssql);
    assert!(mssql.statements[0].contains("[we\"ird]"));
}
