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
        match config.db_type {
            DatabaseType::Sqlite => {
                let driver = SqliteDriver::connect(config).await?;
                Ok(Box::new(driver))
            }
            DatabaseType::Postgres => {
                let driver = PostgresDriver::connect(config).await?;
                Ok(Box::new(driver))
            }
            DatabaseType::MySql => {
                let driver = MySqlDriver::connect(config).await?;
                Ok(Box::new(driver))
            }
            DatabaseType::Mssql => {
                let driver = MssqlDriver::connect(config).await?;
                Ok(Box::new(driver))
            }
        }
    }
}
