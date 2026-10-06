//! @file mssql.rs
//! @brief Microsoft SQL Server DDL generator implementation.
//! @details Translates SchemaDiff structural alterations into T-SQL compliant DDL statements,
//! including square bracket identifier quoting, IDENTITY columns, ALTER COLUMN clauses, and foreign key constraints.

use crate::diff::model::SchemaDiff;
use crate::model::schema::{
    CanonicalType, ColumnSchema, ForeignKeySchema, ReferentialAction, TableSchema,
};

/// @brief DDL generator targeting Microsoft SQL Server database engines.
/// @details Produces T-SQL DDL statements utilizing bracket quotes, IDENTITY auto-increment,
/// ALTER TABLE ... ALTER COLUMN syntax, and foreign key constraint declarations.
pub struct MssqlDdlGenerator;

impl MssqlDdlGenerator {
    /// @brief Generates executable Microsoft SQL Server DDL statements for a given schema diff.
    /// @details Emits statements in operational order: drop foreign keys, drop tables,
    /// create tables, drop columns, add columns, alter columns, and add foreign key constraints.
    /// @param diff Reference to the computed schema diff.
    /// @return Ordered list of SQL DDL statements.
    pub fn generate(diff: &SchemaDiff) -> Vec<String> {
        let mut stmts = Vec::new();

        // 1. Drop foreign keys
        for (table, fk_name) in &diff.foreign_keys_to_drop {
            stmts.push(format!(
                "ALTER TABLE {} DROP CONSTRAINT {};",
                Self::format_table_name(table),
                Self::quote_ident(fk_name)
            ));
        }

        // 2. Drop tables
        for table in &diff.tables_to_drop {
            stmts.push(format!(
                "DROP TABLE IF EXISTS {};",
                Self::format_table_name(table)
            ));
        }

        // 3. Create tables
        for table in &diff.tables_to_create {
            stmts.push(Self::create_table_sql(table));
        }

        // 4. Drop columns
        for (table, col) in &diff.columns_to_drop {
            stmts.push(format!(
                "ALTER TABLE {} DROP COLUMN {};",
                Self::format_table_name(table),
                Self::quote_ident(col)
            ));
        }

        // 5. Add columns (in T-SQL: ALTER TABLE t ADD col_def)
        for (table, col) in &diff.columns_to_add {
            stmts.push(format!(
                "ALTER TABLE {} ADD {};",
                Self::format_table_name(table),
                Self::column_def(col)
            ));
        }

        // 6. Alter columns (in T-SQL: ALTER TABLE t ALTER COLUMN col type [NULL | NOT NULL])
        for alt in &diff.columns_to_alter {
            let col = &alt.target_column;
            let mut stmt = format!(
                "ALTER TABLE {} ALTER COLUMN {} {}",
                Self::format_table_name(&alt.table_name),
                Self::quote_ident(&col.name),
                Self::type_sql(&col.data_type)
            );
            if col.is_nullable {
                stmt.push_str(" NULL;");
            } else {
                stmt.push_str(" NOT NULL;");
            }
            stmts.push(stmt);
        }

        // 7. Add foreign keys from newly created tables
        for table in &diff.tables_to_create {
            for fk in &table.foreign_keys {
                stmts.push(Self::foreign_key_sql(&table.name, fk));
            }
        }

        // 8. Add foreign keys from diff
        for (table, fk) in &diff.foreign_keys_to_add {
            stmts.push(Self::foreign_key_sql(table, fk));
        }

        stmts
    }

    /// @brief Quotes an SQL identifier using T-SQL square brackets.
    /// @param ident Identifier string to quote.
    /// @return Square-bracket-quoted identifier string.
    pub fn quote_ident(ident: &str) -> String {
        format!("[{}]", ident)
    }

    /// @brief Formats a table identifier, handling schema prefixes if provided.
    /// @param name Table name string, possibly containing dot separation.
    /// @return Formatted and quoted table identifier.
    pub fn format_table_name(name: &str) -> String {
        if name.contains('.') {
            name.split('.')
                .map(Self::quote_ident)
                .collect::<Vec<String>>()
                .join(".")
        } else {
            Self::quote_ident(name)
        }
    }

    /// @brief Generates a CREATE TABLE DDL statement for Microsoft SQL Server.
    /// @param table Reference to table schema definition.
    /// @return SQL CREATE TABLE statement.
    fn create_table_sql(table: &TableSchema) -> String {
        let name = match &table.schema {
            Some(s) if !s.is_empty() => format!(
                "{}.{}",
                Self::quote_ident(s),
                Self::quote_ident(&table.name)
            ),
            _ => Self::quote_ident(&table.name),
        };

        let cols: Vec<String> = table.columns.iter().map(Self::column_def).collect();
        format!("CREATE TABLE {} (\n  {}\n);", name, cols.join(",\n  "))
    }

    /// @brief Generates column definition SQL for Microsoft SQL Server.
    /// @param col Reference to column schema definition.
    /// @return Column definition SQL snippet.
    fn column_def(col: &ColumnSchema) -> String {
        let mut def = format!(
            "{} {}",
            Self::quote_ident(&col.name),
            Self::type_sql(&col.data_type)
        );

        if col.is_auto_increment {
            def.push_str(" IDENTITY(1,1)");
        }

        if col.is_primary_key {
            def.push_str(" PRIMARY KEY");
        } else if !col.is_nullable {
            def.push_str(" NOT NULL");
        }

        if let Some(dflt) = &col.default_value {
            def.push_str(&format!(" DEFAULT {}", dflt));
        }

        def
    }

    /// @brief Maps CanonicalType enum to Microsoft SQL Server T-SQL type string.
    /// @param t Reference to CanonicalType.
    /// @return T-SQL type representation string.
    pub fn type_sql(t: &CanonicalType) -> String {
        match t {
            CanonicalType::SmallInt => "SMALLINT".to_string(),
            CanonicalType::Integer => "INT".to_string(),
            CanonicalType::BigInt => "BIGINT".to_string(),
            CanonicalType::Decimal { precision, scale } => match (precision, scale) {
                (Some(p), Some(s)) => format!("DECIMAL({}, {})", p, s),
                (Some(p), None) => format!("DECIMAL({})", p),
                _ => "DECIMAL".to_string(),
            },
            CanonicalType::Float => "REAL".to_string(),
            CanonicalType::Double => "FLOAT".to_string(),
            CanonicalType::Boolean => "BIT".to_string(),
            CanonicalType::Char(len) => format!("CHAR({})", len.unwrap_or(1)),
            CanonicalType::Varchar(len) => format!("VARCHAR({})", len.unwrap_or(255)),
            CanonicalType::Text => "NVARCHAR(MAX)".to_string(),
            CanonicalType::Date => "DATE".to_string(),
            CanonicalType::Time => "TIME".to_string(),
            CanonicalType::Timestamp => "DATETIME2".to_string(),
            CanonicalType::Json => "NVARCHAR(MAX)".to_string(),
            CanonicalType::Uuid => "UNIQUEIDENTIFIER".to_string(),
            CanonicalType::Binary => "VARBINARY(MAX)".to_string(),
            CanonicalType::Custom(s) => s.clone(),
        }
    }

    /// @brief Generates ALTER TABLE ADD CONSTRAINT SQL for a Microsoft SQL Server foreign key.
    /// @param table Name of the table owning the constraint.
    /// @param fk Reference to ForeignKeySchema definition.
    /// @return Executable ALTER TABLE ADD CONSTRAINT statement.
    fn foreign_key_sql(table: &str, fk: &ForeignKeySchema) -> String {
        let mut sql = format!(
            "ALTER TABLE {} ADD CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({})",
            Self::format_table_name(table),
            Self::quote_ident(&fk.constraint_name),
            Self::quote_ident(&fk.source_column),
            Self::format_table_name(&fk.target_table),
            Self::quote_ident(&fk.target_column)
        );

        if fk.on_delete != ReferentialAction::NoAction {
            sql.push_str(&format!(" ON DELETE {}", Self::action_sql(&fk.on_delete)));
        }

        if fk.on_update != ReferentialAction::NoAction {
            sql.push_str(&format!(" ON UPDATE {}", Self::action_sql(&fk.on_update)));
        }

        sql.push(';');
        sql
    }

    /// @brief Converts ReferentialAction enum to T-SQL referential action clause keyword.
    /// @details Maps RESTRICT to NO ACTION as Microsoft SQL Server does not support RESTRICT syntax.
    /// @param action Reference to referential action.
    /// @return SQL string representation.
    pub fn action_sql(action: &ReferentialAction) -> &'static str {
        match action {
            ReferentialAction::NoAction | ReferentialAction::Restrict => "NO ACTION",
            ReferentialAction::Cascade => "CASCADE",
            ReferentialAction::SetNull => "SET NULL",
            ReferentialAction::SetDefault => "SET DEFAULT",
        }
    }
}
