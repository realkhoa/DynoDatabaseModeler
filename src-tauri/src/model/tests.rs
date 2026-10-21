//! @file tests.rs
//! @brief Unit tests for schema models, connection configs, and error serialization.

use super::connection::*;
use super::schema::*;
use crate::error::AppError;

/// @brief Creates a sample database schema for test fixtures.
/// @return Populated `DatabaseSchema` instance with user table and columns.
fn create_sample_database_schema() -> DatabaseSchema {
    DatabaseSchema {
        database_name: "test_db".to_string(),
        tables: vec![TableSchema {
            name: "users".to_string(),
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
                    name: "email".to_string(),
                    data_type: CanonicalType::Varchar(Some(255)),
                    is_primary_key: false,
                    is_nullable: false,
                    is_auto_increment: false,
                    default_value: None,
                },
            ],
            foreign_keys: vec![],
            indexes: vec![],
            ui_position: Some(Point { x: 100.0, y: 150.0 }),
            rename_from: None,
            unsupported_features: vec![],
        }],
    }
}

/// @brief Tests serialization and deserialization roundtrip for DatabaseSchema.
/// @return Returns `()` on success or panics on failure.
#[test]
fn test_schema_serialization_roundtrip() {
    let schema = create_sample_database_schema();
    let json = serde_json::to_string(&schema).expect("Failed to serialize");
    let deserialized: DatabaseSchema = serde_json::from_str(&json).expect("Failed to deserialize");

    assert_eq!(schema.tables.len(), deserialized.tables.len());
    assert_eq!(
        deserialized.tables[0].columns[0].data_type,
        CanonicalType::BigInt
    );
    assert_eq!(
        deserialized.tables[0].columns[1].data_type,
        CanonicalType::Varchar(Some(255))
    );
    assert_eq!(
        deserialized.tables[0].ui_position,
        Some(Point { x: 100.0, y: 150.0 })
    );
}

/// @brief Tests serialization and deserialization of ConnectionConfig with various database types.
/// @return Returns `()` on success or panics on failure.
#[test]
fn test_connection_config_serialization() {
    let postgres_config = ConnectionConfig {
        id: "conn-1".to_string(),
        name: "Local Postgres".to_string(),
        db_type: DatabaseType::Postgres,
        host: Some("localhost".to_string()),
        port: Some(5432),
        database: "app_db".to_string(),
        username: Some("postgres".to_string()),
        password: Some("secret".to_string()),
        file_path: None,
        ssl: false,
        ssh_tunnel: None,
        connection_url: None,
        dialect_family: None,
    };

    let json =
        serde_json::to_string(&postgres_config).expect("Failed to serialize postgres config");
    let deserialized: ConnectionConfig =
        serde_json::from_str(&json).expect("Failed to deserialize postgres config");
    assert_eq!(deserialized.id, "conn-1");
    assert_eq!(deserialized.db_type, DatabaseType::Postgres);
    assert_eq!(deserialized.port, Some(5432));

    let sqlite_config = ConnectionConfig {
        id: "conn-2".to_string(),
        name: "Local SQLite".to_string(),
        db_type: DatabaseType::Sqlite,
        host: None,
        port: None,
        database: "local.db".to_string(),
        username: None,
        password: None,
        file_path: Some("/path/to/local.db".to_string()),
        ssl: false,
        ssh_tunnel: None,
        connection_url: None,
        dialect_family: None,
    };

    let sqlite_json =
        serde_json::to_string(&sqlite_config).expect("Failed to serialize sqlite config");
    let sqlite_deserialized: ConnectionConfig =
        serde_json::from_str(&sqlite_json).expect("Failed to deserialize sqlite config");
    assert_eq!(sqlite_deserialized.db_type, DatabaseType::Sqlite);
    assert_eq!(
        sqlite_deserialized.file_path,
        Some("/path/to/local.db".to_string())
    );

    let duckdb_config = ConnectionConfig {
        id: "conn-duck".to_string(),
        name: "Local DuckDB".to_string(),
        db_type: DatabaseType::DuckDb,
        host: None,
        port: None,
        database: "analytics.duckdb".to_string(),
        username: None,
        password: None,
        file_path: Some("/data/analytics.duckdb".to_string()),
        ssl: false,
        ssh_tunnel: None,
        connection_url: None,
        dialect_family: None,
    };
    let duckdb_json =
        serde_json::to_string(&duckdb_config).expect("Failed to serialize duckdb config");
    let duckdb_deserialized: ConnectionConfig =
        serde_json::from_str(&duckdb_json).expect("Failed to deserialize duckdb config");
    assert_eq!(duckdb_deserialized.db_type, DatabaseType::DuckDb);

    // Test Universal connection configuration serialization
    let universal_config = ConnectionConfig {
        id: "conn-univ".to_string(),
        name: "Universal Cluster".to_string(),
        db_type: DatabaseType::Universal,
        host: None,
        port: None,
        database: "production".to_string(),
        username: None,
        password: None,
        file_path: None,
        ssl: true,
        ssh_tunnel: None,
        connection_url: Some("postgresql://usr:pwd@db.host.io:5432/production".to_string()),
        dialect_family: Some("postgres".to_string()),
    };
    let universal_json =
        serde_json::to_string(&universal_config).expect("Failed to serialize universal config");
    let universal_deserialized: ConnectionConfig =
        serde_json::from_str(&universal_json).expect("Failed to deserialize universal config");
    assert_eq!(universal_deserialized.db_type, DatabaseType::Universal);
    assert_eq!(
        universal_deserialized.connection_url,
        Some("postgresql://usr:pwd@db.host.io:5432/production".to_string())
    );
    assert_eq!(
        universal_deserialized.dialect_family,
        Some("postgres".to_string())
    );

    // Verify all extended database types deserialize cleanly
    let extended_engines = vec![
        DatabaseType::MariaDb,
        DatabaseType::CockroachDb,
        DatabaseType::LibSql,
        DatabaseType::Redshift,
        DatabaseType::ClickHouse,
        DatabaseType::MongoDb,
        DatabaseType::Cassandra,
        DatabaseType::ScyllaDb,
        DatabaseType::SurrealDb,
        DatabaseType::TiDb,
        DatabaseType::Redis,
        DatabaseType::Universal,
    ];
    for engine in extended_engines {
        let serialized = serde_json::to_string(&engine).expect("Engine serialize failed");
        let deserialized: DatabaseType =
            serde_json::from_str(&serialized).expect("Engine deserialize failed");
        assert_eq!(engine, deserialized);
    }
}

/// @brief Tests CanonicalType serialization and deserialization across varied type variants.
/// @return Returns `()` on success or panics on failure.
#[test]
fn test_canonical_type_variants() {
    let types = vec![
        CanonicalType::SmallInt,
        CanonicalType::Integer,
        CanonicalType::BigInt,
        CanonicalType::Decimal {
            precision: Some(10),
            scale: Some(2),
        },
        CanonicalType::Float,
        CanonicalType::Double,
        CanonicalType::Boolean,
        CanonicalType::Char(Some(10)),
        CanonicalType::Varchar(Some(255)),
        CanonicalType::Text,
        CanonicalType::Date,
        CanonicalType::Time,
        CanonicalType::Timestamp,
        CanonicalType::Json,
        CanonicalType::Uuid,
        CanonicalType::Binary,
        CanonicalType::Custom("geometry(Point, 4326)".to_string()),
    ];

    for t in types {
        let serialized = serde_json::to_string(&t).expect("Failed to serialize CanonicalType");
        let deserialized: CanonicalType =
            serde_json::from_str(&serialized).expect("Failed to deserialize CanonicalType");
        assert_eq!(t, deserialized);
    }
}

/// @brief Tests ReferentialAction variants and Foreign Key schema serialization.
/// @return Returns `()` on success or panics on failure.
#[test]
fn test_foreign_key_schema_and_actions() {
    let fk = ForeignKeySchema {
        constraint_name: "fk_user_profile".to_string(),
        source_column: "user_id".to_string(),
        target_table: "users".to_string(),
        target_column: "id".to_string(),
        on_delete: ReferentialAction::Cascade,
        on_update: ReferentialAction::NoAction,
    };

    let json = serde_json::to_string(&fk).expect("Failed to serialize ForeignKeySchema");
    let deserialized: ForeignKeySchema =
        serde_json::from_str(&json).expect("Failed to deserialize ForeignKeySchema");
    assert_eq!(fk, deserialized);
    assert_eq!(deserialized.on_delete, ReferentialAction::Cascade);
    assert_eq!(deserialized.on_update, ReferentialAction::NoAction);
}

/// @brief Tests IndexSchema serialization for unique and composite indexes.
/// @return Returns `()` on success or panics on failure.
#[test]
fn test_index_schema_serialization() {
    let index = IndexSchema {
        name: "idx_users_email_status".to_string(),
        columns: vec!["email".to_string(), "status".to_string()],
        is_unique: true,
    };

    let json = serde_json::to_string(&index).expect("Failed to serialize IndexSchema");
    let deserialized: IndexSchema =
        serde_json::from_str(&json).expect("Failed to deserialize IndexSchema");
    assert_eq!(index, deserialized);
    assert!(deserialized.is_unique);
    assert_eq!(deserialized.columns.len(), 2);
}

/// @brief Tests AppError display message formatting and serialization.
/// @return Returns `()` on success or panics on failure.
#[test]
fn test_app_error_serialization() {
    let db_err = AppError::Database("connection pool timed out".to_string());
    assert_eq!(
        db_err.to_string(),
        "Database error: connection pool timed out"
    );

    let json = serde_json::to_string(&db_err).expect("Failed to serialize AppError");
    assert!(json.contains("connection pool timed out"));
}
