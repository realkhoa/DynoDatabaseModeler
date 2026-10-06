//! @file mysql.rs
//! @brief MySQL / MariaDB DDL generator implementation.
//! @details Translates SchemaDiff structural alterations into MySQL-compliant DDL statements,
//! including backtick identifier quoting, AUTO_INCREMENT columns, MODIFY COLUMN clauses, and foreign key constraints.

use crate::diff::model::SchemaDiff;
use crate::model::schema::{
    CanonicalType, ColumnSchema, ForeignKeySchema, ReferentialAction, TableSchema,
};

/// @brief DDL generator targeting MySQL and MariaDB database engines.
/// @details Produces MySQL DDL statements utilizing backtick quotes, AUTO_INCREMENT modifiers,
/// MODIFY COLUMN alteration syntax, and FOREIGN KEY constraints.
pub struct MySqlDdlGenerator;

impl MySqlDdlGenerator {
    /// @brief Generates executable MySQL DDL statements for a given schema diff.
    /// @details Emits statements in operational order: drop foreign keys, drop tables,
    /// create tables, drop columns, add columns, modify columns, and add foreign key constraints.
    /// @param diff Reference to the computed schema diff.
    /// @return Ordered list of SQL DDL statements.
    pub fn generate(diff: &SchemaDiff) -> Vec<String> {
        let mut stmts = Vec::new();

        // 1. Drop foreign keys
        for (table, fk_name) in &diff.foreign_keys_to_drop {
            stmts.push(format!(
                "ALTER TABLE {} DROP FOREIGN KEY {};",
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

        // 5. Add columns
        for (table, col) in &diff.columns_to_add {
            stmts.push(format!(
                "ALTER TABLE {} ADD COLUMN {};",
                Self::format_table_name(table),
                Self::column_def(col)
            ));
        }

        // 6. Modify columns
        for alt in &diff.columns_to_alter {
            stmts.push(format!(
                "ALTER TABLE {} MODIFY COLUMN {};",
                Self::format_table_name(&alt.table_name),
                Self::modify_column_def(&alt.target_column)
            ));
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

    /// @brief Quotes an SQL identifier using MySQL backticks.
    /// @param ident Identifier string to quote.
    /// @return Backtick-quoted identifier string.
    pub fn quote_ident(ident: &str) -> String {
        format!("`{}`", ident)
    }

    /// @brief Formats a table identifier, handling schema/catalog prefixes if provided.
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

    /// @brief Generates a CREATE TABLE DDL statement for MySQL.
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
