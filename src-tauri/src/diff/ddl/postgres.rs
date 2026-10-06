//! @file postgres.rs
//! @brief PostgreSQL DDL generator implementation.
//! @details Translates SchemaDiff structural alterations into PostgreSQL-compliant DDL statements,
//! including table creations, drops with cascading, column mutations, and foreign key constraints.

use crate::diff::model::SchemaDiff;
use crate::model::schema::{
    CanonicalType, ColumnSchema, ForeignKeySchema, ReferentialAction, TableSchema,
};

/// @brief DDL generator targeting PostgreSQL database engines.
/// @details Produces PostgreSQL DDL statements utilizing double-quoted identifiers,
/// native SERIAL types, CASCADE drops, and table constraint alterations.
pub struct PostgresDdlGenerator;

impl PostgresDdlGenerator {
    /// @brief Generates executable PostgreSQL DDL statements for a given schema diff.
    /// @details Emits statements in safe operational order: drop foreign keys, drop tables,
    /// create tables, drop columns, add columns, alter columns, and add foreign key constraints.
    /// @param diff Reference to the computed schema diff.
    /// @return Ordered list of SQL DDL statements.
    pub fn generate(diff: &SchemaDiff) -> Vec<String> {
        let mut stmts = Vec::new();

        // 1. Drop foreign keys
        for (table, fk_name) in &diff.foreign_keys_to_drop {
            stmts.push(format!(
                "ALTER TABLE {} DROP CONSTRAINT IF EXISTS {};",
                Self::format_table_name(table),
                Self::quote_ident(fk_name)
            ));
        }

        // 2. Drop tables
        for table in &diff.tables_to_drop {
            stmts.push(format!(
                "DROP TABLE IF EXISTS {} CASCADE;",
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
                "ALTER TABLE {} DROP COLUMN IF EXISTS {} CASCADE;",
                Self::format_table_name(table),
                Self::quote_ident(col)
            ));
        }

        // 5. Add columns
        for (table, col) in &diff.columns_to_add {
            stmts.push(format!(
                "ALTER TABLE {} ADD COLUMN {};",
                Self::format_table_name(table),
                Self::column_def(col)
            ));
        }

        // 6. Alter columns
        for alt in &diff.columns_to_alter {
            let col = &alt.target_column;
            if alt.source_column.data_type != alt.target_column.data_type {
                stmts.push(format!(
                    "ALTER TABLE {} ALTER COLUMN {} TYPE {};",
                    Self::format_table_name(&alt.table_name),
                    Self::quote_ident(&col.name),
                    Self::type_sql(&col.data_type)
                ));
            }

            if alt.source_column.is_nullable != alt.target_column.is_nullable {
                if alt.target_column.is_nullable {
                    stmts.push(format!(
                        "ALTER TABLE {} ALTER COLUMN {} DROP NOT NULL;",
                        Self::format_table_name(&alt.table_name),
                        Self::quote_ident(&col.name)
                    ));
                } else {
                    stmts.push(format!(
                        "ALTER TABLE {} ALTER COLUMN {} SET NOT NULL;",
                        Self::format_table_name(&alt.table_name),
                        Self::quote_ident(&col.name)
                    ));
                }
            }
        }

        // 7. Add foreign keys from newly created tables
        for table in &diff.tables_to_create {
            let table_name = match &table.schema {
                Some(s) if !s.is_empty() => format!("{}.{}", s, table.name),
                _ => table.name.clone(),
            };
            for fk in &table.foreign_keys {
                stmts.push(Self::foreign_key_sql(&table_name, fk));
            }
        }

        // 8. Add foreign keys from diff
        for (table, fk) in &diff.foreign_keys_to_add {
            stmts.push(Self::foreign_key_sql(table, fk));
        }

        stmts
    }

    /// @brief Quotes an SQL identifier using PostgreSQL double quotes.
    /// @param ident Identifier string to quote.
    /// @return Double-quoted identifier string.
    pub fn quote_ident(ident: &str) -> String {
        format!("\"{}\"", ident)
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

    /// @brief Generates a CREATE TABLE DDL statement for PostgreSQL.
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

    /// @brief Generates column definition SQL for PostgreSQL.
    /// @param col Reference to column schema definition.
    /// @return Column definition SQL snippet.
    fn column_def(col: &ColumnSchema) -> String {
        let mut def = Self::quote_ident(&col.name);

        if col.is_auto_increment && col.is_primary_key {
            let serial_type = match col.data_type {
                CanonicalType::SmallInt => "SMALLSERIAL",
                CanonicalType::Integer => "SERIAL",
                CanonicalType::BigInt => "BIGSERIAL",
                _ => "BIGSERIAL",
            };
            def.push_str(&format!(" {} PRIMARY KEY", serial_type));
            return def;
        }

        def.push_str(&format!(" {}", Self::type_sql(&col.data_type)));

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

    /// @brief Maps CanonicalType enum to PostgreSQL SQL type string.
    /// @param t Reference to CanonicalType.
    /// @return PostgreSQL type representation string.
    pub fn type_sql(t: &CanonicalType) -> String {
        match t {
            CanonicalType::SmallInt => "SMALLINT".to_string(),
            CanonicalType::Integer => "INTEGER".to_string(),
            CanonicalType::BigInt => "BIGINT".to_string(),
            CanonicalType::Decimal { precision, scale } => match (precision, scale) {
                (Some(p), Some(s)) => format!("DECIMAL({}, {})", p, s),
                (Some(p), None) => format!("DECIMAL({})", p),
                _ => "DECIMAL".to_string(),
            },
            CanonicalType::Float => "REAL".to_string(),
            CanonicalType::Double => "DOUBLE PRECISION".to_string(),
            CanonicalType::Boolean => "BOOLEAN".to_string(),
            CanonicalType::Char(len) => format!("CHAR({})", len.unwrap_or(1)),
            CanonicalType::Varchar(len) => format!("VARCHAR({})", len.unwrap_or(255)),
            CanonicalType::Text => "TEXT".to_string(),
            CanonicalType::Date => "DATE".to_string(),
            CanonicalType::Time => "TIME".to_string(),
            CanonicalType::Timestamp => "TIMESTAMP WITH TIME ZONE".to_string(),
            CanonicalType::Json => "JSONB".to_string(),
            CanonicalType::Uuid => "UUID".to_string(),
            CanonicalType::Binary => "BYTEA".to_string(),
            CanonicalType::Custom(s) => s.clone(),
        }
    }

    /// @brief Generates ALTER TABLE ADD CONSTRAINT SQL for a foreign key.
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

    /// @brief Converts ReferentialAction enum to SQL clause keyword.
    /// @param action Reference to referential action.
    /// @return SQL string representation.
    pub fn action_sql(action: &ReferentialAction) -> &'static str {
        match action {
            ReferentialAction::NoAction => "NO ACTION",
            ReferentialAction::Restrict => "RESTRICT",
            ReferentialAction::Cascade => "CASCADE",
            ReferentialAction::SetNull => "SET NULL",
            ReferentialAction::SetDefault => "SET DEFAULT",
        }
    }
}
