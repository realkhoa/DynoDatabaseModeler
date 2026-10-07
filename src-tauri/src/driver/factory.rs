//! @file factory.rs
//! @brief Database driver factory for creating engine-specific driver instances.
//! @details Dispatches creation to SqliteDriver, PostgresDriver, MySqlDriver, or MssqlDriver
//! based on the connection configuration database type.

use super::{
    mssql::MssqlDriver, mysql::MySqlDriver, postgres::PostgresDriver, sqlite::SqliteDriver,
    DatabaseDriver,
};
use crate::error::AppError;
use crate::model::connection::{ConnectionConfig, DatabaseType};

/// @brief Factory for instantiating the appropriate database driver based on connection configuration.
/// @details Inspects `config.db_type` and delegates connection establishment to the corresponding driver adapter.
pub struct DriverFactory;

impl DriverFactory {
    /// @brief Creates and connects a boxed DatabaseDriver for the specified connection configuration.
    /// @details Dynamically dispatches between SQLite, PostgreSQL, MySQL, and Microsoft SQL Server drivers.
    /// @param config Connection parameters specifying database type, endpoint, credentials, or file paths.
    /// @return Returns a boxed DatabaseDriver trait object or AppError on connection or configuration failure.
    pub async fn create(config: &ConnectionConfig) -> Result<Box<dyn DatabaseDriver>, AppError> {
        let mut final_config = config.clone();
        if let Some(ref tunnel_cfg) = config.ssh_tunnel {
            if tunnel_cfg.enabled && config.db_type != DatabaseType::Sqlite {
                let target_port = config.port.unwrap_or(match config.db_type {
                    DatabaseType::Postgres => 5432,
                    DatabaseType::MySql => 3306,
                    DatabaseType::Mssql => 1433,
                    DatabaseType::Sqlite => 0,
                });
                let remote_host = config.host.as_deref().unwrap_or("127.0.0.1");
                let tunnel = crate::driver::tunnel::SshTunnel::establish(tunnel_cfg, remote_host, target_port).await?;
                final_config.host = Some("127.0.0.1".to_string());
                final_config.port = Some(tunnel.local_port);
            }
        }

        match final_config.db_type {
            DatabaseType::Sqlite => {
                let driver = SqliteDriver::connect(&final_config).await?;
                Ok(Box::new(driver))
            }
            DatabaseType::Postgres => {
                let driver = PostgresDriver::connect(&final_config).await?;
                Ok(Box::new(driver))
            }
            DatabaseType::MySql => {
                let driver = MySqlDriver::connect(&final_config).await?;
                Ok(Box::new(driver))
            }
            DatabaseType::Mssql => {
                let driver = MssqlDriver::connect(&final_config).await?;
                Ok(Box::new(driver))
            }
        }
    }
}
