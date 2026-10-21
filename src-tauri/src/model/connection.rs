//! @file connection.rs
//! @brief Database connection configurations and supported database engine definitions.
//! @details Encapsulates parameters necessary for establishing connections to SQLite,
//! PostgreSQL, MySQL, SQL Server, DuckDB, MariaDB, CockroachDB, LibSQL, Redshift, ClickHouse,
//! and Universal / Generic SQL database endpoints.

use serde::{Deserialize, Serialize};

/// @brief Supported relational database engine types.
/// @details Dictates the driver adapter and SQL dialect rules applied during introspection and generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum DatabaseType {
    /// @brief Embedded SQLite database engine.
    #[default]
    Sqlite,
    /// @brief PostgreSQL relational database engine.
    Postgres,
    /// @brief MySQL relational database engine.
    MySql,
    /// @brief Microsoft SQL Server relational database engine.
    Mssql,
    /// @brief Embedded DuckDB analytical database engine.
    DuckDb,
    /// @brief MariaDB relational database engine.
    MariaDb,
    /// @brief CockroachDB distributed SQL database engine (PostgreSQL wire compatible).
    CockroachDb,
    /// @brief LibSQL / Turso edge database engine (SQLite compatible).
    LibSql,
    /// @brief Amazon Redshift cloud data warehouse (PostgreSQL wire compatible).
    Redshift,
    /// @brief ClickHouse columnar analytical database engine.
    ClickHouse,
    /// @brief Universal / Generic SQL adapter supporting any SQL database via connection URL or standard dialect.
    Universal,
}

/// @brief Comprehensive connection configuration parameters for database sessions.
/// @details Provides credentials, endpoints, paths, and security flags required by driver adapters.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ConnectionConfig {
    /// @brief Unique identifier for the saved connection profile.
    pub id: String,
    /// @brief Human-readable profile display name.
    pub name: String,
    /// @brief Target database engine dialect.
    pub db_type: DatabaseType,
    /// @brief Network hostname or IP address of the database server.
    pub host: Option<String>,
    /// @brief Network port number on which the database server listens.
    pub port: Option<u16>,
    /// @brief Database catalog / schema name to open.
    pub database: String,
    /// @brief Authentication username.
    pub username: Option<String>,
    /// @brief Authentication password.
    pub password: Option<String>,
    /// @brief Local file system path for embedded SQLite databases.
    pub file_path: Option<String>,
    /// @brief Flag specifying whether SSL/TLS encryption is enforced.
    pub ssl: bool,
    /// @brief Optional SSH bastion tunnel configuration for forwarding remote connections.
    pub ssh_tunnel: Option<crate::driver::tunnel::SshTunnelConfig>,
    /// @brief Raw connection string or database URL for Universal / direct connection modes.
    #[serde(default)]
    pub connection_url: Option<String>,
    /// @brief Explicit dialect family classification for Universal connections ('postgres', 'mysql', 'sqlite', 'mssql', 'duckdb', 'ansi').
    #[serde(default)]
    pub dialect_family: Option<String>,
}
