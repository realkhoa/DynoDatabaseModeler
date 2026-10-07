//! @file connection.rs
//! @brief Database connection configurations and supported database engine definitions.
//! @details Encapsulates parameters necessary for establishing connections to SQLite,
//! PostgreSQL, MySQL, and SQL Server.

use serde::{Deserialize, Serialize};

/// @brief Supported relational database engine types.
/// @details Dictates the driver adapter and SQL dialect rules applied during introspection and generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DatabaseType {
    /// @brief Embedded SQLite database engine.
    Sqlite,
    /// @brief PostgreSQL relational database engine.
    Postgres,
    /// @brief MySQL / MariaDB relational database engine.
    MySql,
    /// @brief Microsoft SQL Server relational database engine.
    Mssql,
}

/// @brief Comprehensive connection configuration parameters for database sessions.
/// @details Provides credentials, endpoints, paths, and security flags required by driver adapters.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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
}
