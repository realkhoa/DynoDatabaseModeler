//! @file mod.rs
//! @brief Multi-dialect DDL generation module.
//! @details Formats SchemaDiff instances into executable SQL DDL statements
//! for PostgreSQL, SQLite, MySQL, and Microsoft SQL Server.

#[cfg(test)]
mod ddl_test;
pub mod mssql;
pub mod mysql;
pub mod postgres;
pub mod sqlite;

use crate::diff::model::SchemaDiff;
use crate::model::connection::DatabaseType;
pub use mssql::MssqlDdlGenerator;
pub use mysql::MySqlDdlGenerator;
pub use postgres::PostgresDdlGenerator;
pub use sqlite::SqliteDdlGenerator;

/// @brief Common trait for dialect-specific DDL generators.
/// @details Defines uniform generation interface across all database dialects.
pub trait DialectDdlGenerator {
    /// @brief Generates executable DDL statements for a given schema diff.
    /// @param diff Reference to the computed schema diff.
    /// @return Ordered list of SQL DDL statements.
    fn generate(diff: &SchemaDiff) -> Vec<String>;
}

impl DialectDdlGenerator for PostgresDdlGenerator {
    fn generate(diff: &SchemaDiff) -> Vec<String> {
        Self::generate(diff)
    }
}

impl DialectDdlGenerator for SqliteDdlGenerator {
    fn generate(diff: &SchemaDiff) -> Vec<String> {
        Self::generate(diff)
    }
}

impl DialectDdlGenerator for MySqlDdlGenerator {
    fn generate(diff: &SchemaDiff) -> Vec<String> {
        Self::generate(diff)
    }
}

impl DialectDdlGenerator for MssqlDdlGenerator {
    fn generate(diff: &SchemaDiff) -> Vec<String> {
        Self::generate(diff)
    }
}

/// @brief Generates executable DDL statements according to the target database dialect.
/// @details Routes the schema diff to the corresponding dialect generator.
/// @param diff Reference to the computed schema diff.
/// @param dialect Target database engine type.
/// @return Vector of SQL DDL statements.
pub fn generate_ddl(diff: &SchemaDiff, dialect: DatabaseType) -> Vec<String> {
    match dialect {
        DatabaseType::Postgres => PostgresDdlGenerator::generate(diff),
        DatabaseType::Sqlite => SqliteDdlGenerator::generate(diff),
        DatabaseType::MySql => MySqlDdlGenerator::generate(diff),
        DatabaseType::Mssql => MssqlDdlGenerator::generate(diff),
    }
}
