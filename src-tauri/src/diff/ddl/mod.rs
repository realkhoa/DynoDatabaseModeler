//! @file mod.rs
//! @brief Dialect-specific DDL statement generation from structured schema differences.
//! @details Dispatches schema diffs to PostgreSQL, SQLite, MySQL, or Microsoft SQL Server
//! DDL generators to produce clean, dialect-compliant, transactional SQL migration scripts.

pub mod mssql;
pub mod mysql;
pub mod postgres;
pub mod sqlite;

use crate::diff::model::SchemaDiff;
use crate::model::connection::DatabaseType;
use serde::{Deserialize, Serialize};

pub use mssql::MssqlDdlGenerator;
pub use mysql::MySqlDdlGenerator;
pub use postgres::PostgresDdlGenerator;
pub use sqlite::SqliteDdlGenerator;

/// @brief Result of DDL generation for one schema diff.
/// @details Separates executable SQL from the changes that the dialect cannot express
/// automatically, so the UI can block or warn instead of reporting a hollow success.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct GeneratedDdl {
    /// @brief Ordered list of executable SQL statements.
    pub statements: Vec<String>,
    /// @brief Human-readable descriptions of changes that were NOT generated, and why.
    pub warnings: Vec<String>,
}

impl GeneratedDdl {
    /// @brief Appends an executable statement.
    /// @param sql SQL statement to append.
    pub fn push(&mut self, sql: String) {
        self.statements.push(sql);
    }

    /// @brief Records a change that could not be generated, with the reason.
    /// @param message Warning description shown to the user.
    pub fn warn(&mut self, message: impl Into<String>) {
        self.warnings.push(message.into());
    }

    /// @brief Indicates whether generation produced no SQL at all.
    /// @return `true` when there are no statements.
    pub fn is_empty(&self) -> bool {
        self.statements.is_empty()
    }
}

/// @brief Common trait for dialect-specific DDL generators.
/// @details Defines uniform generation interface across all database dialects.
pub trait DialectDdlGenerator {
    /// @brief Generates executable DDL statements for a given schema diff.
    /// @param diff Reference to the computed schema diff.
    /// @return Generated SQL statements plus warnings for unsupported changes.
    fn generate(diff: &SchemaDiff) -> GeneratedDdl;
}

impl DialectDdlGenerator for PostgresDdlGenerator {
    fn generate(diff: &SchemaDiff) -> GeneratedDdl {
        Self::generate(diff)
    }
}

impl DialectDdlGenerator for SqliteDdlGenerator {
    fn generate(diff: &SchemaDiff) -> GeneratedDdl {
        Self::generate(diff)
    }
}

impl DialectDdlGenerator for MySqlDdlGenerator {
    fn generate(diff: &SchemaDiff) -> GeneratedDdl {
        Self::generate(diff)
    }
}

impl DialectDdlGenerator for MssqlDdlGenerator {
    fn generate(diff: &SchemaDiff) -> GeneratedDdl {
        Self::generate(diff)
    }
}

/// @brief Generates executable DDL statements according to the target database dialect.
/// @details Routes the schema diff to the corresponding dialect generator.
/// CockroachDB, Amazon Redshift, DuckDB, and Universal follow PostgreSQL-compatible dialect.
/// LibSQL follows SQLite dialect. MariaDB and ClickHouse follow MySQL-compatible dialect.
/// Redis translates dropped collections to DEL operations.
/// @param diff Reference to the computed schema diff.
/// @param dialect Target database engine type.
/// @return Generated SQL statements plus warnings for unsupported changes.
pub fn generate_ddl(diff: &SchemaDiff, dialect: DatabaseType) -> GeneratedDdl {
    match dialect {
        DatabaseType::Postgres
        | DatabaseType::DuckDb
        | DatabaseType::CockroachDb
        | DatabaseType::Redshift
        | DatabaseType::Universal => PostgresDdlGenerator::generate(diff),
        DatabaseType::Sqlite | DatabaseType::LibSql => SqliteDdlGenerator::generate(diff),
        DatabaseType::MySql | DatabaseType::MariaDb | DatabaseType::ClickHouse => {
            MySqlDdlGenerator::generate(diff)
        }
        DatabaseType::Mssql => MssqlDdlGenerator::generate(diff),
        DatabaseType::Redis => {
            let mut ddl = GeneratedDdl::default();
            for t in &diff.tables_to_drop {
                ddl.push(format!("DEL {}", t));
            }
            ddl
        }
    }
}

/// @brief Splits a possibly schema-qualified identifier into its parts.
/// @details Only the last dot is treated as the namespace separator, and schema/table names that
/// themselves contain a dot are not supported (documented limitation shared by all dialects).
/// @param qualified Identifier such as `sales.orders` or `orders`.
/// @return Tuple of optional schema and the bare object name.
pub fn split_qualified(qualified: &str) -> (Option<&str>, &str) {
    match qualified.rsplit_once('.') {
        Some((schema, name)) if !schema.is_empty() && !name.is_empty() => (Some(schema), name),
        _ => (None, qualified),
    }
}
