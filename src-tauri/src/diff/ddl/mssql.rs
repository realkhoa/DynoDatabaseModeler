//! @file mssql.rs
//! @brief Microsoft SQL Server DDL generator implementation.
//! @details Translates SchemaDiff structural alterations into T-SQL compliant DDL statements,
//! including table renames, square bracket identifier quoting, IDENTITY columns,
//! ALTER COLUMN clauses, index maintenance, and foreign key constraints.

use super::{split_qualified, GeneratedDdl};
use crate::diff::model::SchemaDiff;
use crate::model::schema::{
    CanonicalType, ColumnSchema, ForeignKeySchema, IndexSchema, ReferentialAction, TableSchema,
};

/// @brief DDL generator targeting Microsoft SQL Server database engines.
/// @details Produces T-SQL DDL statements utilizing bracket quotes, IDENTITY auto-increment,
/// ALTER TABLE ... ALTER COLUMN syntax, and foreign key constraint declarations.
pub struct MssqlDdlGenerator;

impl MssqlDdlGenerator {
    /// @brief Generates executable Microsoft SQL Server DDL statements for a given schema diff.
    /// @details Emits statements in operational order: rename tables, drop foreign keys, drop
    /// tables, create tables, drop columns, add columns, alter columns, create indexes, add
    /// foreign key constraints, and drop obsolete indexes.
    /// @param diff Reference to the computed schema diff.
    /// @return Generated statements plus warnings.
    pub fn generate(diff: &SchemaDiff) -> GeneratedDdl {
        let mut out = GeneratedDdl::default();

        // 1. Rename tables first (sp_rename keeps the schema of the source object).
        for rename in &diff.tables_to_rename {
            let (_, new_name) = split_qualified(&rename.to);
            out.push(format!(
                "EXEC sp_rename N'{}', N'{}';",
                Self::format_table_name(&rename.from).replace('\'', "''"),
                new_name.replace('\'', "''")
            ));
        }

        // 2. Drop foreign keys
        for (table, fk_name) in &diff.foreign_keys_to_drop {
            out.push(format!(
                "ALTER TABLE {} DROP CONSTRAINT {};",
                Self::format_table_name(table),
                Self::quote_ident(fk_name)
            ));
        }

        // 3. Drop tables
        for table in &diff.tables_to_drop {
            out.push(format!(
                "IF OBJECT_ID(N'{}', N'U') IS NOT NULL DROP TABLE {};",
                Self::format_table_name(table).replace('\'', "''"),
                Self::format_table_name(table)
            ));
        }

        // 4. Create tables
        for table in &diff.tables_to_create {
            out.push(Self::create_table_sql(table));
        }

        // 5. Drop columns
        for (table, col) in &diff.columns_to_drop {
            out.push(format!(
                "ALTER TABLE {} DROP COLUMN {};",
                Self::format_table_name(table),
                Self::quote_ident(col)
            ));
        }

        // 6. Add columns (in T-SQL: ALTER TABLE t ADD col_def)
        for (table, col) in &diff.columns_to_add {
            out.push(format!(
                "ALTER TABLE {} ADD {};",
                Self::format_table_name(table),
                Self::column_def(col)
            ));
        }

        // 7. Alter columns (in T-SQL: ALTER TABLE t ALTER COLUMN col type [NULL | NOT NULL])
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
            out.push(stmt);

            if alt.source_column.default_value != alt.target_column.default_value {
                out.warn(format!(
                    "Default change on {}.{} was not generated: T-SQL requires dropping and \
                     recreating the named DEFAULT constraint separately.",
                    alt.table_name, col.name
                ));
            }
            if alt.source_column.is_primary_key != alt.target_column.is_primary_key {
                out.warn(format!(
                    "Primary key change on {}.{} was not generated: add or drop the PRIMARY KEY \
                     constraint manually.",
                    alt.table_name, col.name
                ));
            }
            if alt.source_column.is_auto_increment != alt.target_column.is_auto_increment {
                out.warn(format!(
                    "IDENTITY change on {}.{} was not generated: SQL Server cannot add or remove \
                     IDENTITY on an existing column. Recreate the table instead.",
                    alt.table_name, col.name
                ));
            }
        }

        // 8. Create indexes
        for (table, idx) in &diff.indexes_to_create {
            out.push(Self::create_index_sql(table, idx));
        }

        // 9. Foreign keys from newly created tables.
        for table in &diff.tables_to_create {
            let table_name = table.qualified_name();
            for fk in &table.foreign_keys {
                out.push(Self::foreign_key_sql(&table_name, fk));
            }
        }

        // 10. Foreign keys from diff.
        for (table, fk) in &diff.foreign_keys_to_add {
            out.push(Self::foreign_key_sql(table, fk));
        }

        // 11. Drop indexes last.
        for (table, idx_name) in &diff.indexes_to_drop {
            out.push(format!(
                "DROP INDEX {} ON {};",
                Self::quote_ident(idx_name),
                Self::format_table_name(table)
            ));
        }

        out
    }

    /// @brief Quotes an SQL identifier using T-SQL square brackets.
    /// @details Embedded closing brackets are escaped by doubling.
    /// @param ident Identifier string to quote.
    /// @return Square-bracket-quoted identifier string.
    pub fn quote_ident(ident: &str) -> String {
        format!("[{}]", ident.replace(']', "]]"))
    }

    /// @brief Formats a table identifier, handling schema prefixes if provided.
    /// @param name Table name string, possibly containing dot separation.
    /// @return Formatted and quoted table identifier.
    pub fn format_table_name(name: &str) -> String {
        match split_qualified(name) {
            (Some(schema), table) => {
                format!("{}.{}", Self::quote_ident(schema), Self::quote_ident(table))
            }
            (None, table) => Self::quote_ident(table),
        }
    }

    /// @brief Generates a CREATE INDEX statement.
    /// @param table Target table name.
    /// @param idx Reference to index definition.
    /// @return Executable CREATE INDEX statement.
    fn create_index_sql(table: &str, idx: &IndexSchema) -> String {
        let cols = idx
            .columns
            .iter()
            .map(|c| Self::quote_ident(c))
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            "CREATE {}INDEX {} ON {} ({});",
            if idx.is_unique { "UNIQUE " } else { "" },
            Self::quote_ident(&idx.name),
            Self::format_table_name(table),
            cols
        )
    }

    /// @brief Generates a CREATE TABLE DDL statement for Microsoft SQL Server.
    /// @param table Reference to table schema definition.
    /// @return SQL CREATE TABLE statement.
    fn create_table_sql(table: &TableSchema) -> String {
        let name = Self::format_table_name(&table.qualified_name());
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
