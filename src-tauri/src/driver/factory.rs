//! @file factory.rs
//! @brief Database driver factory for creating engine-specific driver instances.
//! @details Dispatches creation to SqliteDriver, PostgresDriver, MySqlDriver, MssqlDriver,
//! DuckDbDriver, or RedisDriver based on the connection configuration database type, and owns
//! any SSH bastion tunnel that the connection depends on.

use super::tunnel::SshTunnel;
use super::{
    duckdb::DuckDbDriver, mssql::MssqlDriver, mysql::MySqlDriver, postgres::PostgresDriver,
    redis::RedisDriver, sqlite::SqliteDriver, DatabaseDriver,
};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};

/// @brief A connected driver together with the resources it needs to stay alive.
/// @details An SSH tunnel is bound to a loopback port; the socket is closed as soon as the tunnel
/// value is dropped, so the owner of this handle must keep it for the entire connection lifetime.
pub struct DriverHandle {
    /// @brief Engine-specific driver instance.
    pub driver: Box<dyn DatabaseDriver>,
    /// @brief Active SSH bastion tunnel, when the connection is tunnelled.
    pub tunnel: Option<SshTunnel>,
}

/// @brief Factory for instantiating the appropriate database driver based on connection configuration.
/// @details Inspects `config.db_type` and delegates connection establishment to the corresponding driver adapter.
pub struct DriverFactory;

impl DriverFactory {
    /// @brief Creates and connects a driver handle for the specified connection configuration.
    /// @details Dynamically dispatches between SQLite, PostgreSQL, MySQL, Microsoft SQL Server, DuckDB,
    /// MariaDB, CockroachDB, LibSQL, Redshift, ClickHouse, Redis, and Universal SQL adapters. When an SSH
    /// tunnel is configured and enabled, a real tunnel is established first and the driver then
    /// targets the tunnel's loopback port.
    /// @param config Connection parameters specifying database type, endpoint, credentials, or file paths.
    /// @return Returns a driver handle (driver plus optional tunnel) or AppError on failure.
    pub async fn create(config: &ConnectionConfig) -> Result<DriverHandle, AppError> {
        let mut final_config = config.clone();
        let mut tunnel = None;

        if let Some(ref tunnel_cfg) = config.ssh_tunnel {
            let is_remote_engine = !matches!(
                config.db_type,
                DatabaseType::Sqlite | DatabaseType::DuckDb | DatabaseType::LibSql
            );

            if tunnel_cfg.enabled && is_remote_engine {
                let target_port = config.port.unwrap_or(match config.db_type {
                    DatabaseType::Postgres => 5432,
                    DatabaseType::MySql => 3306,
                    DatabaseType::Mssql => 1433,
                    DatabaseType::MariaDb => 3306,
                    DatabaseType::CockroachDb => 26257,
                    DatabaseType::Redshift => 5439,
                    DatabaseType::ClickHouse => 9004,
                    DatabaseType::Redis => 6379,
                    DatabaseType::Universal => 5432,
                    DatabaseType::Sqlite | DatabaseType::DuckDb | DatabaseType::LibSql => 0,
                });
                let remote_host = config.host.as_deref().unwrap_or("127.0.0.1").to_string();

                let established =
                    SshTunnel::establish(tunnel_cfg, &remote_host, target_port).await?;

                final_config.host = Some("127.0.0.1".to_string());
                final_config.port = Some(established.local_port);
                tunnel = Some(established);
            }
        }

        let driver: Box<dyn DatabaseDriver> = match final_config.db_type {
            DatabaseType::Sqlite | DatabaseType::LibSql => {
                Box::new(SqliteDriver::connect(&final_config).await?)
            }
            DatabaseType::Postgres | DatabaseType::CockroachDb | DatabaseType::Redshift => {
                Box::new(PostgresDriver::connect(&final_config).await?)
            }
            DatabaseType::MySql | DatabaseType::MariaDb | DatabaseType::ClickHouse => {
                Box::new(MySqlDriver::connect(&final_config).await?)
            }
            DatabaseType::Mssql => Box::new(MssqlDriver::connect(&final_config).await?),
            DatabaseType::DuckDb => Box::new(DuckDbDriver::connect(&final_config).await?),
            DatabaseType::Redis => Box::new(RedisDriver::connect(&final_config).await?),
            DatabaseType::Universal => Self::create_universal(&final_config).await?,
        };

        Ok(DriverHandle { driver, tunnel })
    }

    /// @brief Resolves and connects the appropriate driver for a Universal database connection.
    /// @details Inspects connection URL scheme and explicit dialect_family to dispatch
    /// to PostgresDriver, MySqlDriver, SqliteDriver, MssqlDriver, DuckDbDriver, or RedisDriver.
    /// @param config Universal connection configuration.
    /// @return Boxed DatabaseDriver handle or AppError.
    async fn create_universal(
        config: &ConnectionConfig,
    ) -> Result<Box<dyn DatabaseDriver>, AppError> {
        let dialect = if let Some(ref url) = config.connection_url {
            let lower = url.to_lowercase();
            if lower.starts_with("postgres://") || lower.starts_with("postgresql://") {
                "postgres"
            } else if lower.starts_with("mysql://") || lower.starts_with("mariadb://") {
                "mysql"
            } else if lower.starts_with("redis://") || lower.starts_with("rediss://") {
                "redis"
            } else if lower.starts_with("sqlite://")
                || lower.starts_with("sqlite:")
                || lower.ends_with(".db")
                || lower.ends_with(".sqlite")
                || lower.ends_with(".sqlite3")
            {
                "sqlite"
            } else if lower.starts_with("duckdb://")
                || lower.starts_with("duckdb:")
                || lower.ends_with(".duckdb")
            {
                "duckdb"
            } else if lower.starts_with("sqlserver://") || lower.starts_with("mssql://") {
                "mssql"
            } else {
                config.dialect_family.as_deref().unwrap_or("postgres")
            }
        } else {
            config.dialect_family.as_deref().unwrap_or("postgres")
        };

        match dialect.to_lowercase().as_str() {
            "mysql" | "mariadb" => Ok(Box::new(MySqlDriver::connect(config).await?)),
            "sqlite" | "libsql" => Ok(Box::new(SqliteDriver::connect(config).await?)),
            "mssql" | "sqlserver" => Ok(Box::new(MssqlDriver::connect(config).await?)),
            "duckdb" => Ok(Box::new(DuckDbDriver::connect(config).await?)),
            "redis" => Ok(Box::new(RedisDriver::connect(config).await?)),
            _ => Ok(Box::new(PostgresDriver::connect(config).await?)),
        }
    }
}
