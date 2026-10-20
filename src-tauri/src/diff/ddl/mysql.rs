//! @file mysql.rs
//! @brief MySQL / MariaDB DDL generator implementation.
//! @details Translates SchemaDiff structural alterations into MySQL-compliant DDL statements,
//! including table renames, backtick identifier quoting, AUTO_INCREMENT columns,
//! MODIFY COLUMN clauses, index maintenance, and foreign key constraints.

use super::{split_qualified, GeneratedDdl};
use crate::diff::model::SchemaDiff;
use crate::model::schema::{
    CanonicalType, ColumnSchema, ForeignKeySchema, IndexSchema, ReferentialAction, TableSchema,
};

/// @brief DDL generator targeting MySQL and MariaDB database engines.
/// @details Produces MySQL DDL statements utilizing backtick quotes, AUTO_INCREMENT modifiers,
/// MODIFY COLUMN alteration syntax, and FOREIGN KEY constraints.
pub struct MySqlDdlGenerator;

impl MySqlDdlGenerator {
    /// @brief Generates executable MySQL DDL statements for a given schema diff.
    /// @details Emits statements in operational order: rename tables, drop foreign keys, drop
    /// tables, create tables, drop columns, add columns, modify columns, create indexes, add
    /// foreign key constraints, and drop obsolete indexes.
    /// @param diff Reference to the computed schema diff.
    /// @return Generated statements plus warnings.
    pub fn generate(diff: &SchemaDiff) -> GeneratedDdl {
        let mut out = GeneratedDdl::default();

        // 1. Rename tables first.
        for rename in &diff.tables_to_rename {
            let (from_schema, from_name) = split_qualified(&rename.from);
            let (to_schema, to_name) = split_qualified(&rename.to);
            out.push(format!(
                "RENAME TABLE {} TO {};",
                Self::format_table_name(&match from_schema {
                    Some(s) => format!("{}.{}", s, from_name),
                    None => from_name.to_string(),
                }),
                Self::format_table_name(&match to_schema {
                    Some(s) => format!("{}.{}", s, to_name),
                    None => to_name.to_string(),
                })
            ));
        }

        // 2. Drop foreign keys
        for (table, fk_name) in &diff.foreign_keys_to_drop {
            out.push(format!(
                "ALTER TABLE {} DROP FOREIGN KEY {};",
                Self::format_table_name(table),
                Self::quote_ident(fk_name)
            ));
        }

        // 3. Drop tables
        for table in &diff.tables_to_drop {
            out.push(format!(
                "DROP TABLE IF EXISTS {};",
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

        // 6. Add columns
        for (table, col) in &diff.columns_to_add {
            out.push(format!(
                "ALTER TABLE {} ADD COLUMN {};",
                Self::format_table_name(table),
                Self::column_def(col)
            ));
        }

        // 7. Modify columns
        for alt in &diff.columns_to_alter {
            out.push(format!(
                "ALTER TABLE {} MODIFY COLUMN {};",
                Self::format_table_name(&alt.table_name),
                Self::modify_column_def(&alt.target_column)
            ));

            if alt.source_column.is_primary_key != alt.target_column.is_primary_key {
                out.warn(format!(
                    "Primary key change on {}.{} was not generated: MySQL MODIFY COLUMN cannot add \
                     or drop a PRIMARY KEY without risking error 1068. Use ADD/DROP PRIMARY KEY \
                     manually.",
                    alt.table_name, alt.target_column.name
                ));
            }
            if alt.target_column.is_auto_increment
                && !alt.target_column.is_primary_key
                && !alt.source_column.is_auto_increment
            {
                out.warn(format!(
                    "Adding AUTO_INCREMENT to {}.{} requires the column to be a key; verify the \
                     generated MODIFY COLUMN statement.",
                    alt.table_name, alt.target_column.name
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

    /// @brief Quotes an SQL identifier using MySQL backticks.
    /// @details Embedded backticks are escaped by doubling.
    /// @param ident Identifier string to quote.
    /// @return Backtick-quoted identifier string.
    pub fn quote_ident(ident: &str) -> String {
        format!("`{}`", ident.replace('`', "``"))
    }

    /// @brief Formats a table identifier, handling schema/catalog prefixes if provided.
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

    /// @brief Generates a CREATE TABLE DDL statement for MySQL.
    /// @param table Reference to table schema definition.
    /// @return SQL CREATE TABLE statement.
    fn create_table_sql(table: &TableSchema) -> String {
        let name = Self::format_table_name(&table.qualified_name());
        let mut cols: Vec<String> = table.columns.iter().map(Self::column_def).collect();

        for fk in &table.foreign_keys {
            cols.push(Self::foreign_key_def(fk));
        }

        format!("CREATE TABLE {} (\n  {}\n);", name, cols.join(",\n  "))
    }

    /// @brief Generates column definition SQL for MySQL.
    /// @param col Reference to column schema definition.
    /// @return Column definition SQL snippet.
    fn column_def(col: &ColumnSchema) -> String {
        let mut def = format!(
            "{} {}",
            Self::quote_ident(&col.name),
            Self::type_sql(&col.data_type)
        );

        if col.is_auto_increment {
            def.push_str(" AUTO_INCREMENT");
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

    /// @brief Generates a table-level FOREIGN KEY clause for MySQL.
    /// @param fk Reference to ForeignKeySchema definition.
    /// @return FOREIGN KEY constraint clause.
    fn foreign_key_def(fk: &ForeignKeySchema) -> String {
        let mut def = format!(
            "CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({})",
            Self::quote_ident(&fk.constraint_name),
            Self::quote_ident(&fk.source_column),
            Self::format_table_name(&fk.target_table),
            Self::quote_ident(&fk.target_column)
        );

        if fk.on_delete != ReferentialAction::NoAction {
            def.push_str(&format!(" ON DELETE {}", Self::action_sql(&fk.on_delete)));
        }

        if fk.on_update != ReferentialAction::NoAction {
            def.push_str(&format!(" ON UPDATE {}", Self::action_sql(&fk.on_update)));
        }

        def
    }

    /// @brief Generates column modification SQL for MySQL ALTER TABLE MODIFY COLUMN.
    /// @details Omits PRIMARY KEY specification to prevent MySQL Error 1068 (Multiple primary key defined).
    /// @param col Reference to column schema definition.
    /// @return Column definition SQL snippet suitable for MODIFY COLUMN.
    fn modify_column_def(col: &ColumnSchema) -> String {
        let mut def = format!(
            "{} {}",
            Self::quote_ident(&col.name),
            Self::type_sql(&col.data_type)
        );

        if col.is_auto_increment {
            def.push_str(" AUTO_INCREMENT");
        }

        // Note: Do NOT add PRIMARY KEY clause in MODIFY COLUMN to avoid MySQL error 1068
        if !col.is_nullable {
            def.push_str(" NOT NULL");
        }

        if let Some(dflt) = &col.default_value {
            def.push_str(&format!(" DEFAULT {}", dflt));
        }

        def
    }

    /// @brief Maps CanonicalType enum to MySQL SQL type string.
    /// @param t Reference to CanonicalType.
    /// @return MySQL type representation string.
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
            CanonicalType::Float => "FLOAT".to_string(),
            CanonicalType::Double => "DOUBLE".to_string(),
            CanonicalType::Boolean => "TINYINT(1)".to_string(),
            CanonicalType::Char(len) => format!("CHAR({})", len.unwrap_or(1)),
            CanonicalType::Varchar(len) => format!("VARCHAR({})", len.unwrap_or(255)),
            CanonicalType::Text => "TEXT".to_string(),
            CanonicalType::Date => "DATE".to_string(),
            CanonicalType::Time => "TIME".to_string(),
            CanonicalType::Timestamp => "DATETIME".to_string(),
            CanonicalType::Json => "JSON".to_string(),
            CanonicalType::Uuid => "VARCHAR(36)".to_string(),
            CanonicalType::Binary => "BLOB".to_string(),
            CanonicalType::Custom(s) => s.clone(),
        }
    }

    /// @brief Generates ALTER TABLE ADD CONSTRAINT SQL for a MySQL foreign key.
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
