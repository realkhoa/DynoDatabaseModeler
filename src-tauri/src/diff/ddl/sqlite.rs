//! @file sqlite.rs
//! @brief SQLite DDL generator implementation.
//! @details Translates SchemaDiff structural alterations into SQLite-compliant DDL statements,
//! including table creations with inline foreign key clauses, drops, and column additions.

use crate::diff::model::SchemaDiff;
use crate::model::schema::{
    CanonicalType, ColumnSchema, ForeignKeySchema, ReferentialAction, TableSchema,
};

/// @brief DDL generator targeting SQLite database engines.
/// @details Produces SQLite DDL statements with double quotes, dynamic storage classes,
/// auto-increment primary keys, and table-level foreign key definitions.
pub struct SqliteDdlGenerator;

impl SqliteDdlGenerator {
    /// @brief Generates executable SQLite DDL statements for a given schema diff.
    /// @details Emits statements in operational order: drop tables, create tables with foreign keys,
    /// drop columns, and add columns.
    /// @param diff Reference to the computed schema diff.
    /// @return Ordered list of SQL DDL statements.
    pub fn generate(diff: &SchemaDiff) -> Vec<String> {
        let mut stmts = Vec::new();

        // 1. Drop tables
        for table in &diff.tables_to_drop {
            stmts.push(format!(
                "DROP TABLE IF EXISTS {};",
                Self::quote_ident(table)
            ));
        }

        // 2. Create tables
        for table in &diff.tables_to_create {
            stmts.push(Self::create_table_sql(table));
        }

        // 3. Drop columns
        for (table, col) in &diff.columns_to_drop {
            stmts.push(format!(
                "ALTER TABLE {} DROP COLUMN {};",
                Self::quote_ident(table),
                Self::quote_ident(col)
            ));
        }

        // 4. Add columns
        for (table, col) in &diff.columns_to_add {
            stmts.push(format!(
                "ALTER TABLE {} ADD COLUMN {};",
                Self::quote_ident(table),
                Self::column_def(col)
            ));
        }

        stmts
    }

    /// @brief Quotes an SQL identifier using SQLite standard double quotes.
    /// @param ident Identifier string to quote.
    /// @return Double-quoted identifier string.
    pub fn quote_ident(ident: &str) -> String {
        format!("\"{}\"", ident)
    }

    /// @brief Generates a CREATE TABLE DDL statement for SQLite including column and foreign key definitions.
    /// @param table Reference to table schema definition.
    /// @return SQL CREATE TABLE statement.
    fn create_table_sql(table: &TableSchema) -> String {
        let mut defs: Vec<String> = table.columns.iter().map(Self::column_def).collect();

        for fk in &table.foreign_keys {
            defs.push(Self::foreign_key_def(fk));
        }

        format!(
            "CREATE TABLE {} (\n  {}\n);",
            Self::quote_ident(&table.name),
            defs.join(",\n  ")
        )
    }

    /// @brief Generates column definition SQL for SQLite.
    /// @param col Reference to column schema definition.
    /// @return Column definition SQL snippet.
    fn column_def(col: &ColumnSchema) -> String {
        let mut def = Self::quote_ident(&col.name);

        if col.is_auto_increment && col.is_primary_key {
            def.push_str(" INTEGER PRIMARY KEY AUTOINCREMENT");
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

    /// @brief Generates a table-level FOREIGN KEY definition snippet for SQLite.
    /// @param fk Reference to ForeignKeySchema definition.
    /// @return SQL FOREIGN KEY clause string.
    fn foreign_key_def(fk: &ForeignKeySchema) -> String {
        let mut def = format!(
            "FOREIGN KEY ({}) REFERENCES {} ({})",
            Self::quote_ident(&fk.source_column),
            Self::quote_ident(&fk.target_table),
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

    /// @brief Maps CanonicalType enum to SQLite storage class affinity string.
    /// @param t Reference to CanonicalType.
    /// @return SQLite affinity type string.
    pub fn type_sql(t: &CanonicalType) -> String {
        match t {
            CanonicalType::SmallInt | CanonicalType::Integer | CanonicalType::BigInt => {
                "INTEGER".to_string()
            }
            CanonicalType::Float | CanonicalType::Double | CanonicalType::Decimal { .. } => {
                "REAL".to_string()
            }
            CanonicalType::Boolean => "INTEGER".to_string(),
            CanonicalType::Binary => "BLOB".to_string(),
            _ => "TEXT".to_string(),
        }
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
