//! @file postgres.rs
//! @brief PostgreSQL DDL generator implementation.
//! @details Translates SchemaDiff structural alterations into PostgreSQL-compliant DDL statements,
//! including table renames, table creations, drops with cascading, column mutations (type,
//! nullability and default), index maintenance, and foreign key constraints.

use super::{split_qualified, GeneratedDdl};
use crate::diff::model::SchemaDiff;
use crate::model::schema::{
    CanonicalType, ColumnSchema, ForeignKeySchema, IndexSchema, ReferentialAction, TableSchema,
};

/// @brief DDL generator targeting PostgreSQL database engines.
/// @details Produces PostgreSQL DDL statements utilizing double-quoted identifiers,
/// native SERIAL types, CASCADE drops, and table constraint alterations.
pub struct PostgresDdlGenerator;

impl PostgresDdlGenerator {
    /// @brief Generates executable PostgreSQL DDL statements for a given schema diff.
    /// @details Emits statements in safe operational order: rename tables, drop foreign keys,
    /// drop tables, create tables, drop columns, add columns, alter columns, create indexes,
    /// and add foreign key constraints. Changes PostgreSQL cannot express in place
    /// (primary key and identity changes) are reported as warnings.
    /// @param diff Reference to the computed schema diff.
    /// @return Generated statements plus warnings.
    pub fn generate(diff: &SchemaDiff) -> GeneratedDdl {
        let mut out = GeneratedDdl::default();

        // 1. Rename tables first so every later statement can use the new name.
        for rename in &diff.tables_to_rename {
            let (schema, new_name) = split_qualified(&rename.to);
            out.push(format!(
                "ALTER TABLE {} RENAME TO {};",
                Self::format_table_name(&rename.from),
                Self::quote_ident(new_name)
            ));
            let _ = schema;
        }

        // 2. Drop foreign keys
        for (table, fk_name) in &diff.foreign_keys_to_drop {
            out.push(format!(
                "ALTER TABLE {} DROP CONSTRAINT IF EXISTS {};",
                Self::format_table_name(table),
                Self::quote_ident(fk_name)
            ));
        }

        // 3. Drop tables
        for table in &diff.tables_to_drop {
            out.push(format!(
                "DROP TABLE IF EXISTS {} CASCADE;",
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
                "ALTER TABLE {} DROP COLUMN IF EXISTS {} CASCADE;",
                Self::format_table_name(table),
                Self::quote_ident(col)
            ));
        }

        // 6. Add columns
        for (table, col) in &diff.columns_to_add {
            out.push(format!(
                "ALTER TABLE {} ADD COLUMN {};",
                Self::format_table_name(table),
                Self::column_def(col)
            ));
        }

        // 7. Alter columns
        for alt in &diff.columns_to_alter {
            let col = &alt.target_column;
            let table = Self::format_table_name(&alt.table_name);

            if alt.source_column.data_type != alt.target_column.data_type {
                let type_sql = Self::type_sql(&col.data_type);
                out.push(format!(
                    "ALTER TABLE {} ALTER COLUMN {} TYPE {} USING {}::{};",
                    table,
                    Self::quote_ident(&col.name),
                    type_sql,
                    Self::quote_ident(&col.name),
                    type_sql
                ));
            }

            if alt.source_column.is_nullable != alt.target_column.is_nullable {
                let keyword = if alt.target_column.is_nullable {
                    "DROP NOT NULL"
                } else {
                    "SET NOT NULL"
                };
                out.push(format!(
                    "ALTER TABLE {} ALTER COLUMN {} {};",
                    table,
                    Self::quote_ident(&col.name),
                    keyword
                ));
            }

            if alt.source_column.default_value != alt.target_column.default_value {
                match &alt.target_column.default_value {
                    Some(dflt) => out.push(format!(
                        "ALTER TABLE {} ALTER COLUMN {} SET DEFAULT {};",
                        table,
                        Self::quote_ident(&col.name),
                        dflt
                    )),
                    None => out.push(format!(
                        "ALTER TABLE {} ALTER COLUMN {} DROP DEFAULT;",
                        table,
                        Self::quote_ident(&col.name)
                    )),
                }
            }

            if alt.source_column.is_primary_key != alt.target_column.is_primary_key {
                out.warn(format!(
                    "Primary key change on {}.{} was not generated: add or drop the primary key \
                     constraint manually.",
                    alt.table_name, col.name
                ));
            }
            if alt.source_column.is_auto_increment != alt.target_column.is_auto_increment {
                out.warn(format!(
                    "Identity/sequence change on {}.{} was not generated: PostgreSQL requires an \
                     explicit CREATE/ALTER SEQUENCE and column DEFAULT nextval(...).",
                    alt.table_name, col.name
                ));
            }
        }

        // 8. Create indexes
        for (table, idx) in &diff.indexes_to_create {
            out.push(Self::create_index_sql(table, idx));
        }

        // 9. Add foreign keys from newly created tables
        for table in &diff.tables_to_create {
            for fk in &table.foreign_keys {
                let table_name = table.qualified_name();
                out.push(Self::foreign_key_sql(&table_name, fk));
            }
        }

        // 10. Add foreign keys from diff
        for (table, fk) in &diff.foreign_keys_to_add {
            out.push(Self::foreign_key_sql(table, fk));
        }

        // 11. Drop indexes last, so no index is lost before the columns it covers were rebuilt.
        for (_, idx_name) in &diff.indexes_to_drop {
            let (schema, name) = split_qualified(idx_name);
            out.push(match schema {
                Some(s) => format!(
                    "DROP INDEX IF EXISTS {}.{};",
                    Self::quote_ident(s),
                    Self::quote_ident(name)
                ),
                None => format!("DROP INDEX IF EXISTS {};", Self::quote_ident(name)),
            });
        }

        out
    }

    /// @brief Quotes an SQL identifier using PostgreSQL double quotes.
    /// @details Embedded double quotes are escaped by doubling, matching the SQL standard.
    /// @param ident Identifier string to quote.
    /// @return Double-quoted identifier string.
    pub fn quote_ident(ident: &str) -> String {
        format!("\"{}\"", ident.replace('"', "\"\""))
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

    /// @brief Generates a CREATE TABLE DDL statement for PostgreSQL.
    /// @param table Reference to table schema definition.
    /// @return SQL CREATE TABLE statement.
    fn create_table_sql(table: &TableSchema) -> String {
        let name = Self::format_table_name(&table.qualified_name());
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

    /// @brief Generates a CREATE INDEX statement.
    /// @param table Target table identifier (may be schema qualified).
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
