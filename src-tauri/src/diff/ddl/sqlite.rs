//! @file sqlite.rs
//! @brief SQLite DDL generator implementation.
//! @details Translates SchemaDiff structural alterations into SQLite-compliant DDL statements.
//!
//! SQLite cannot alter a column type, nullability or default in place, and it cannot add or drop
//! a foreign key on an existing table. Those changes are therefore expressed as a full table
//! rebuild (create shadow table, copy rows, drop original, rename shadow, recreate indexes).
//! When a table contains objects the rebuild cannot preserve (triggers, CHECK constraints,
//! generated columns, dependent views) the rebuild is refused with an explicit warning instead
//! of being silently skipped.

use super::{split_qualified, GeneratedDdl};
use crate::diff::model::SchemaDiff;
use crate::model::schema::{
    CanonicalType, ColumnSchema, ForeignKeySchema, IndexSchema, ReferentialAction, TableSchema,
};

/// @brief DDL generator targeting SQLite database engines.
/// @details Produces SQLite DDL statements with double quotes, dynamic storage classes,
/// auto-increment primary keys, and table-level foreign key definitions.
pub struct SqliteDdlGenerator;

impl SqliteDdlGenerator {
    /// @brief Generates executable SQLite DDL statements for a given schema diff.
    /// @details Emits statements in operational order: rename tables, drop tables, create tables,
    /// rebuild tables that need in-place-incompatible changes, add columns, recreate indexes, and
    /// report everything SQLite cannot express automatically.
    /// @param diff Reference to the computed schema diff.
    /// @return Generated statements plus warnings.
    pub fn generate(diff: &SchemaDiff) -> GeneratedDdl {
        let mut out = GeneratedDdl::default();

        let rebuilt: Vec<String> = diff
            .tables_to_rebuild
            .iter()
            .map(|r| r.table_name.clone())
            .collect();
        let is_rebuilt = |table: &str| rebuilt.iter().any(|t| t == table);

        // 1. Rename tables first so later statements can use the new name.
        for rename in &diff.tables_to_rename {
            let (from_schema, from_name) = split_qualified(&rename.from);
            let (_, to_name) = split_qualified(&rename.to);
            let from_sql = match from_schema {
                Some(schema) => format!(
                    "{}.{}",
                    Self::quote_ident(schema),
                    Self::quote_ident(from_name)
                ),
                None => Self::quote_ident(from_name),
            };
            out.push(format!(
                "ALTER TABLE {} RENAME TO {};",
                from_sql,
                Self::quote_ident(to_name)
            ));
        }

        // 2. Drop tables
        for table in &diff.tables_to_drop {
            out.push(format!(
                "DROP TABLE IF EXISTS {};",
                Self::quote_ident(table)
            ));
        }

        // 3. Create tables
        for table in &diff.tables_to_create {
            out.push(Self::create_table_sql(table));
        }

        // 4. Rebuild tables that need changes SQLite cannot apply in place.
        for rebuild in &diff.tables_to_rebuild {
            if !rebuild.target.unsupported_features.is_empty() {
                out.warn(format!(
                    "Table '{}' needs a rebuild, but it contains objects a rebuild cannot preserve \
                     ({}). No SQL was generated for this table — change it manually or remove those \
                     objects first.",
                    rebuild.table_name,
                    rebuild.target.unsupported_features.join(", ")
                ));
                continue;
            }
            Self::emit_rebuild(&mut out, rebuild);
        }

        // 5. Add columns (native ALTER TABLE ADD COLUMN; already covered by rebuilds).
        for (table, col) in &diff.columns_to_add {
            if is_rebuilt(table) {
                continue;
            }
            out.push(format!(
                "ALTER TABLE {} ADD COLUMN {};",
                Self::quote_ident(table),
                Self::column_def(col)
            ));
        }

        // 6. Anything that still cannot be expressed in place is reported, never dropped.
        for (table, col) in &diff.columns_to_drop {
            if !is_rebuilt(table) {
                out.warn(format!(
                    "Dropping column '{}.{}' was not generated because the table was not scheduled \
                     for a rebuild.",
                    table, col
                ));
            }
        }
        for alt in &diff.columns_to_alter {
            if !is_rebuilt(&alt.table_name) {
                out.warn(format!(
                    "Altering column '{}.{}' was not generated because the table was not scheduled \
                     for a rebuild.",
                    alt.table_name, alt.target_column.name
                ));
            } else if alt.source_column.is_primary_key != alt.target_column.is_primary_key
                || alt.source_column.is_auto_increment != alt.target_column.is_auto_increment
            {
                out.warn(format!(
                    "Primary key or AUTOINCREMENT change on '{}.{}' is applied by the rebuild; \
                     verify the copied data before executing.",
                    alt.table_name, alt.target_column.name
                ));
            }
        }
        for (table, fk_name) in &diff.foreign_keys_to_drop {
            if !is_rebuilt(table) {
                out.warn(format!(
                    "Dropping foreign key '{}' on '{}' was not generated: SQLite cannot drop a \
                     foreign key without rebuilding the table.",
                    fk_name, table
                ));
            }
        }
        for (table, fk) in &diff.foreign_keys_to_add {
            if !is_rebuilt(table) {
                out.warn(format!(
                    "Adding foreign key '{}' on '{}' was not generated: SQLite cannot add a foreign \
                     key to an existing table without rebuilding it.",
                    fk.constraint_name, table
                ));
            }
        }

        // 7. Indexes for tables that were not rebuilt (rebuilt tables recreate theirs inline).
        for (table, idx) in &diff.indexes_to_create {
            if is_rebuilt(table) {
                continue;
            }
            out.push(Self::create_index_sql(table, idx));
        }
        for (table, idx_name) in &diff.indexes_to_drop {
            if is_rebuilt(table) {
                continue;
            }
            out.push(format!(
                "DROP INDEX IF EXISTS {};",
                Self::quote_ident(idx_name)
            ));
        }

        out
    }

    /// @brief Emits the full rebuild sequence for one table.
    /// @details The shadow table is dropped first so a half-failed previous attempt cannot block
    /// the migration, and only columns present on both sides are copied.
    /// @param out Accumulator receiving the statements and warnings.
    /// @param rebuild Rebuild request carrying the target definition and copy column list.
    fn emit_rebuild(out: &mut GeneratedDdl, rebuild: &crate::diff::model::TableRebuild) {
        let table = rebuild.table_name.as_str();
        let shadow = format!("{}__dyno_rebuild", table);

        out.warn(format!(
            "Table '{}' must be rebuilt to apply this change. Rows are copied into a shadow table, \
             but SQLite resets its rowid sequence and any AUTOINCREMENT counter.",
            table
        ));

        out.push(format!(
            "DROP TABLE IF EXISTS {};",
            Self::quote_ident(&shadow)
        ));

        let shadow_table = TableSchema {
            name: shadow.clone(),
            schema: None,
            columns: rebuild.target.columns.clone(),
            foreign_keys: rebuild.target.foreign_keys.clone(),
            indexes: vec![],
            ui_position: None,
            rename_from: None,
            unsupported_features: vec![],
        };
        out.push(Self::create_table_sql(&shadow_table));

        if !rebuild.copy_columns.is_empty() {
            let cols = rebuild
                .copy_columns
                .iter()
                .map(|c| Self::quote_ident(c))
                .collect::<Vec<_>>()
                .join(", ");
            out.push(format!(
                "INSERT INTO {} ({}) SELECT {} FROM {};",
                Self::quote_ident(&shadow),
                cols,
                cols,
                Self::quote_ident(table)
            ));
        }

        out.push(format!("DROP TABLE {};", Self::quote_ident(table)));
        out.push(format!(
            "ALTER TABLE {} RENAME TO {};",
            Self::quote_ident(&shadow),
            Self::quote_ident(table)
        ));

        // Recreate only indexes whose columns all survived the change.
        for idx in &rebuild.target.indexes {
            if Self::is_index_creatable(idx, &rebuild.copy_columns) {
                out.push(Self::create_index_sql(table, idx));
            } else if !idx.name.starts_with("sqlite_") {
                out.warn(format!(
                    "Index '{}' on '{}' was not recreated because it references a column that no \
                     longer exists.",
                    idx.name, table
                ));
            }
        }
    }

    /// @brief Determines whether an index can be recreated after a rebuild.
    /// @param idx Index definition.
    /// @param available_columns Columns present on both sides of the rebuild.
    /// @return `true` when every indexed column still exists.
    fn is_index_creatable(idx: &IndexSchema, available_columns: &[String]) -> bool {
        !idx.columns.is_empty()
            && idx
                .columns
                .iter()
                .all(|c| available_columns.iter().any(|a| a == c))
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
            Self::quote_ident(table),
            cols
        )
    }

    /// @brief Quotes an SQL identifier using SQLite standard double quotes.
    /// @details Embedded double quotes are escaped by doubling.
    /// @param ident Identifier string to quote.
    /// @return Double-quoted identifier string.
    pub fn quote_ident(ident: &str) -> String {
        format!("\"{}\"", ident.replace('"', "\"\""))
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

    /// @brief Splits a qualified name, provided for symmetry with the other generators.
    /// @param qualified Identifier possibly containing a schema prefix.
    /// @return Tuple of optional schema and bare name.
    pub fn split_name(qualified: &str) -> (Option<&str>, &str) {
        split_qualified(qualified)
    }
}
