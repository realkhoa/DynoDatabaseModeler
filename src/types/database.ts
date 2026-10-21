/**
 * @file database.ts
 * @brief Core database domain models and types for DynoDbModeler frontend.
 * @details Mirrors the Rust backend data models for connections, schema metadata,
 * schema differences, migration execution reports, and SQL query results.
 */

/**
 * @brief Supported relational database engine types.
 */
export type DatabaseType = 'Sqlite' | 'Postgres' | 'MySql' | 'Mssql' | 'DuckDb';

/**
 * @brief Configuration parameters for establishing a database connection.
 */
export interface ConnectionConfig {
  /** @brief Unique identifier for the saved connection profile. */
  id: string;
  /** @brief Human-readable profile display name. */
  name: string;
  /** @brief Target database engine dialect. */
  db_type: DatabaseType;
  /** @brief Network hostname or IP address of the database server. */
  host?: string;
  /** @brief Network port number on which the database server listens. */
  port?: number;
  /** @brief Database catalog or schema name to open. */
  database: string;
  /** @brief Authentication username. */
  username?: string;
  /** @brief Authentication password. */
  password?: string;
  /** @brief Local file system path for embedded SQLite databases. */
  file_path?: string;
  /** @brief Flag specifying whether SSL/TLS encryption is enforced. */
  ssl: boolean;
  /** @brief Optional SSH bastion tunnel configuration for remote networks. */
  ssh_tunnel?: SshTunnelConfig;
}

/**
 * @brief Authentication methods for SSH bastion jump servers.
 */
export type SshAuthType = 'Password' | 'PrivateKey' | 'Agent';

/**
 * @brief Configuration parameters for SSH bastion port forwarding.
 */
export interface SshTunnelConfig {
  /** @brief Whether SSH tunnel is enabled for this connection. */
  enabled: boolean;
  /** @brief Bastion server hostname or IP address. */
  host: string;
  /** @brief Bastion SSH port (typically 22). */
  port: number;
  /** @brief SSH username. */
  username: string;
  /** @brief SSH authentication method. */
  auth_type: SshAuthType;
  /** @brief Plaintext password if using Password authentication. */
  password?: string;
  /** @brief Absolute file path to private key if using PrivateKey authentication. */
  private_key_path?: string;
  /** @brief Passphrase for encrypted private key. */
  passphrase?: string;
}

/**
 * @brief Normalized canonical database column data type representation.
 * @details Normalizes engine-specific dialect types into a unified type system.
 */
export type CanonicalType =
  | 'SmallInt'
  | 'Integer'
  | 'BigInt'
  | { Decimal: { precision?: number | null; scale?: number | null } }
  | 'Float'
  | 'Double'
  | 'Boolean'
  | { Char: number | null }
  | { Varchar: number | null }
  | 'Text'
  | 'Date'
  | 'Time'
  | 'Timestamp'
  | 'Json'
  | 'Uuid'
  | 'Binary'
  | { Custom: string };

/**
 * @brief Referential action triggered on foreign key target updates or deletes.
 */
export type ReferentialAction = 'NoAction' | 'Restrict' | 'Cascade' | 'SetNull' | 'SetDefault';

/**
 * @brief Foreign key constraint definition linking source and target table columns.
 */
export interface ForeignKeySchema {
  /** @brief Identifier name of the foreign key constraint. */
  constraint_name: string;
  /** @brief Local column name within the referencing table. */
  source_column: string;
  /** @brief Name of the referenced target table. */
  target_table: string;
  /** @brief Column name within the referenced target table. */
  target_column: string;
  /** @brief Action executed when referenced parent row is deleted. */
  on_delete: ReferentialAction;
  /** @brief Action executed when referenced parent row is updated. */
  on_update: ReferentialAction;
}

/**
 * @brief Column definition within a table schema.
 */
export interface ColumnSchema {
  /** @brief Column identifier name. */
  name: string;
  /** @brief Canonical data type abstraction. */
  data_type: CanonicalType;
  /** @brief Indicates whether this column is part of the primary key. */
  is_primary_key: boolean;
  /** @brief Indicates whether NULL values are accepted. */
  is_nullable: boolean;
  /** @brief Indicates whether column auto-generates sequential values. */
  is_auto_increment: boolean;
  /** @brief Optional default expression or literal value string. */
  default_value?: string;
}

/**
 * @brief Secondary index definition on a table.
 */
export interface IndexSchema {
  /** @brief Index identifier name. */
  name: string;
  /** @brief Ordered list of column names included in the index key. */
  columns: string[];
  /** @brief Indicates whether unique values are enforced. */
  is_unique: boolean;
}

/**
 * @brief 2D coordinate on virtual diagram canvas.
 */
export interface Point {
  /** @brief Horizontal X coordinate offset. */
  x: number;
  /** @brief Vertical Y coordinate offset. */
  y: number;
}

/**
 * @brief Relational table schema definition including columns, constraints, and layout.
 */
export interface TableSchema {
  /** @brief Name of the table. */
  name: string;
  /** @brief Optional namespace or schema name (e.g. 'public', 'dbo'). */
  schema?: string;
  /** @brief Ordered collection of table columns. */
  columns: ColumnSchema[];
  /** @brief Foreign key constraints defined on this table. */
  foreign_keys: ForeignKeySchema[];
  /** @brief Secondary indexes defined on this table. */
  indexes: IndexSchema[];
  /** @brief Optional canvas coordinates for visual diagram persistence. */
  ui_position?: Point;
  /** @brief Previous name when the user renamed the table in the modeler. */
  rename_from?: string;
  /** @brief Dialect constructs that make a full table rebuild unsafe (SQLite introspection). */
  unsupported_features?: string[];
}

/**
 * @brief Fully-qualified identity key for a table (`schema.name`, or the bare name).
 * @param table Table schema to identify.
 * @return Stable key used for diff matching, canvas node ids and selection state.
 */
export function tableKey(table: Pick<TableSchema, 'name' | 'schema'>): string {
  const schema = table.schema?.trim();
  return schema ? `${schema}.${table.name}` : table.name;
}

/**
 * @brief Root database schema model containing all tables and metadata.
 */
export interface DatabaseSchema {
  /** @brief Database catalog or identifier name. */
  database_name: string;
  /** @brief Collection of tables residing in this database. */
  tables: TableSchema[];
}

/**
 * @brief Represents alteration details on an existing table column.
 */
export interface ColumnAlteration {
  /** @brief Name of the table containing the column to alter. */
  table_name: string;
  /** @brief Current live schema definition of the column. */
  source_column: ColumnSchema;
  /** @brief Target desired schema definition of the column. */
  target_column: ColumnSchema;
  /** @brief Indicates whether applying this alteration could cause data loss. */
  is_destructive: boolean;
}

/**
 * @brief A table rename expressed as `ALTER TABLE ... RENAME TO`.
 */
export interface TableRename {
  /** @brief Current (live) table name. */
  from: string;
  /** @brief Desired new table name. */
  to: string;
}

/**
 * @brief A table that must be rebuilt because the dialect cannot change it in place (SQLite).
 */
export interface TableRebuild {
  /** @brief Name of the table to rebuild. */
  table_name: string;
  /** @brief Complete desired definition of the table. */
  target: TableSchema;
  /** @brief Columns copied from the existing table into the rebuilt one. */
  copy_columns: string[];
}

/**
 * @brief Structural difference model between current live and desired target schemas.
 */
export interface SchemaDiff {
  /** @brief Tables to create. */
  tables_to_create: TableSchema[];
  /** @brief Names of tables to drop. */
  tables_to_drop: string[];
  /** @brief Tables renamed by the user (non-destructive). */
  tables_to_rename: TableRename[];
  /** @brief Tables requiring a full rebuild on dialects without ALTER COLUMN. */
  tables_to_rebuild: TableRebuild[];
  /** @brief Tuples of [table_name, column_schema] to add. */
  columns_to_add: [string, ColumnSchema][];
  /** @brief Tuples of [table_name, column_name] to drop. */
  columns_to_drop: [string, string][];
  /** @brief Column modifications within existing tables. */
  columns_to_alter: ColumnAlteration[];
  /** @brief Tuples of [table_name, foreign_key_schema] to add. */
  foreign_keys_to_add: [string, ForeignKeySchema][];
  /** @brief Tuples of [table_name, constraint_name] to drop. */
  foreign_keys_to_drop: [string, string][];
  /** @brief Tuples of [table_name, index_schema] to create. */
  indexes_to_create: [string, IndexSchema][];
  /** @brief Tuples of [table_name, index_name] to drop. */
  indexes_to_drop: [string, string][];
}

/**
 * @brief Generated migration script plus explicit reporting of changes that were not generated.
 * @details The backend never silently omits a change: anything a dialect cannot express is returned
 * as a warning so the UI can block or inform instead of reporting a hollow success.
 */
export interface GeneratedDdl {
  /** @brief Ordered executable SQL statements. */
  statements: string[];
  /** @brief Human-readable descriptions of changes that were NOT generated, and why. */
  warnings: string[];
}

/**
 * @brief Report summarizing execution of a multi-statement DDL migration batch.
 */
export interface MigrationReport {
  /** @brief Indicates whether all statements executed and committed successfully. */
  success: boolean;
  /** @brief Count of DDL statements executed. */
  statements_executed: number;
  /** @brief Total elapsed execution duration in milliseconds. */
  execution_time_ms: number;
  /** @brief Error description if execution failed, or null on success. */
  error_message?: string | null;
}

/**
 * @brief Result set produced by an arbitrary SQL query execution.
 */
export interface QueryResult {
  /** @brief Ordered list of column names present in the query result set. */
  columns: string[];
  /** @brief Two-dimensional grid of cell values. */
  rows: unknown[][];
  /** @brief Number of rows affected or returned. */
  rows_affected: number;
  /** @brief Total elapsed execution duration in milliseconds. */
  execution_time_ms: number;
}

/**
 * @brief Transactional single-row mutation payload submitted to backend database driver.
 * @details Identifies the target table, primary key locator mapping, and updated column-value pairs.
 */
export interface RowUpdatePayload {
  /** @brief Name of the target table to update. */
  table: string;
  /** @brief Primary key column names mapped to their unique identifying values for the row. */
  primary_keys: Record<string, any>;
  /** @brief Modified column names mapped to their new desired values. */
  updated_values: Record<string, any>;
  /**
   * @brief Require the statement to affect exactly one row.
   * @details Set by the data grid so a non-unique or null primary key locator can never silently
   * modify unrelated rows; the backend rolls the whole batch back on a mismatch.
   */
  expect_single_row?: boolean;
}

/**
 * @brief Cardinality classification for entity-relationship associations.
 */
export type CardinalityType = 'one-to-one' | 'one-to-many' | 'many-to-many' | 'zero-to-one' | 'zero-to-many';

/**
 * @brief Visual notation style for Entity-Relationship Diagrams.
 */
export type ErdNotationStyle = 'crows-foot' | 'simple';

/**
 * @brief Logical, non-enforced entity relationship between table columns.
 * @details Allows diagramming associations in ERD without creating physical database foreign key constraints.
 */
export interface VirtualRelationship {
  /** @brief Unique identifier for the virtual relationship. */
  id: string;
  /** @brief Source table name holding the logical referencing key. */
  sourceTable: string;
  /** @brief Column name in the source table. */
  sourceColumn: string;
  /** @brief Target table name holding the referenced primary/unique key. */
  targetTable: string;
  /** @brief Column name in the target table. */
  targetColumn: string;
  /** @brief Optional logical relationship label or alias. */
  name?: string;
  /** @brief Optional documentation note explaining the association. */
  note?: string;
}

/**
 * @brief Represents a hierarchical node in a database query execution plan.
 * @details Models operation type, affected relation, estimated cost, row count, and execution time.
 */
export interface ExecutionPlanNode {
  /** @brief Type of execution step or algorithm (e.g., 'Seq Scan', 'Index Scan', 'Nested Loop', 'Scan Table'). */
  node_type: string;
  /** @brief Target database relation (table or index) accessed, if applicable. */
  relation_name?: string;
  /** @brief Relative or absolute optimizer cost assigned to this operation. */
  cost: number;
  /** @brief Actual execution duration in milliseconds if available. */
  actual_time_ms?: number;
  /** @brief Estimated or processed row count. */
  rows: number;
  /** @brief Additional details, scan filters, or execution predicates. */
  detail?: string;
  /** @brief Child operations feeding rows into this operation. */
  children: ExecutionPlanNode[];
}


/**
 * @brief Formats a CanonicalType variant into a human-readable display string.
 * @param dataType CanonicalType instance to format.
 * @return Human-readable data type label (e.g., 'VARCHAR(255)', 'DECIMAL(10,2)', 'INTEGER').
 */
export function formatCanonicalType(dataType: CanonicalType): string {
  if (typeof dataType === 'string') {
    return dataType.toUpperCase();
  }

  if ('Decimal' in dataType) {
    const { precision, scale } = dataType.Decimal;
    if (precision !== undefined && precision !== null && scale !== undefined && scale !== null) {
      return `DECIMAL(${precision},${scale})`;
    }
    if (precision !== undefined && precision !== null) {
      return `DECIMAL(${precision})`;
    }
    return 'DECIMAL';
  }

  if ('Char' in dataType) {
    return dataType.Char !== null ? `CHAR(${dataType.Char})` : 'CHAR';
  }

  if ('Varchar' in dataType) {
    return dataType.Varchar !== null ? `VARCHAR(${dataType.Varchar})` : 'VARCHAR';
  }

  if ('Custom' in dataType) {
    return dataType.Custom.toUpperCase();
  }

  return 'UNKNOWN';
}

/**
 * @brief High-performance equality check comparing two canonical database column types.
 * @details Avoids costly JSON stringification by directly inspecting primitive type tags and
 * parameterized attributes (Decimal precision/scale, Char length, Varchar length, Custom string).
 * @param a First CanonicalType operand to compare.
 * @param b Second CanonicalType operand to compare.
 * @return True if both canonical types represent semantically equivalent data types, false otherwise.
 */
export function isSameCanonicalType(a: CanonicalType, b: CanonicalType): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a === 'string' || typeof b === 'string') {
    return false;
  }
  if ('Decimal' in a && 'Decimal' in b) {
    return (
      (a.Decimal.precision ?? null) === (b.Decimal.precision ?? null) &&
      (a.Decimal.scale ?? null) === (b.Decimal.scale ?? null)
    );
  }
  if ('Char' in a && 'Char' in b) {
    return (a.Char ?? null) === (b.Char ?? null);
  }
  if ('Varchar' in a && 'Varchar' in b) {
    return (a.Varchar ?? null) === (b.Varchar ?? null);
  }
  if ('Custom' in a && 'Custom' in b) {
    return a.Custom === b.Custom;
  }
  return false;
}

/**
 * @brief Returns standard default port number for a given database engine.
 * @param dbType Database engine dialect.
 * @return Default port number for the specified database engine.
 */
export function getDefaultPort(dbType: DatabaseType): number {
  switch (dbType) {
    case 'Postgres':
      return 5432;
    case 'MySql':
      return 3306;
    case 'Mssql':
      return 1433;
    case 'Sqlite':
    case 'DuckDb':
    default:
      return 0;
  }
}

/**
 * @brief Persistent SQL query execution history record.
 */
export interface QueryHistoryRecord {
  /** @brief Unique database identifier. */
  id: number;
  /** @brief SQL query statement text. */
  query_text: string;
  /** @brief ISO 8601 execution timestamp. */
  executed_at: string;
  /** @brief Wall-clock execution duration in milliseconds. */
  duration_ms: number;
  /** @brief Number of affected or returned rows. */
  rows_count: number;
  /** @brief Execution status ("success" or "error"). */
  status: string;
  /** @brief Whether query is pinned as a favorite/snippet. */
  is_favorite: boolean;
}

