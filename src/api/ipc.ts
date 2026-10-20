/**
 * @file ipc.ts
 * @brief Type-safe Tauri IPC client API bridging frontend React UI with Rust backend services.
 * @details Wraps Tauri v2 `@tauri-apps/api/core` invoke calls for database connection management,
 * schema metadata introspection, diff calculation, DDL generation, and query execution.
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  ConnectionConfig,
  DatabaseSchema,
  ExecutionPlanNode,
  GeneratedDdl,
  MigrationReport,
  QueryResult,
  QueryHistoryRecord,
  RowUpdatePayload,
  SchemaDiff,
} from '../types/database';

/**
 * @brief DynoDbModeler IPC API service client.
 */
export const api = {
  /**
   * @brief Tests database connectivity for the supplied configuration without altering active state.
   * @param config Connection parameters, host, credentials, and SSL settings.
   * @return Promise resolving to true if connection succeeded.
   */
  testConnection: (config: ConnectionConfig): Promise<boolean> => {
    return invoke<boolean>('cmd_test_connection', { config });
  },

  /**
   * @brief Establishes an active database session and persists it into global backend state.
   * @param config Connection parameters and credentials for the target database.
   * @return Promise resolving to true on successful connection.
   */
  connect: (config: ConnectionConfig): Promise<boolean> => {
    return invoke<boolean>('cmd_connect', { config });
  },

  /**
   * @brief Queries all accessible databases on a remote database server using supplied configuration.
   * @param config Connection parameters.
   * @return Promise resolving to array of database names.
   */
  listDatabases: (config: ConnectionConfig): Promise<string[]> => {
    return invoke<string[]>('cmd_list_databases', { config });
  },

  /**
   * @brief Queries all accessible databases on the currently connected active server.
   * @return Promise resolving to array of database names.
   */
  listActiveDatabases: (): Promise<string[]> => {
    return invoke<string[]>('cmd_list_active_databases');
  },

  /**
   * @brief Switches the active database catalog and returns newly introspected schema.
   * @param database Target database catalog name.
   * @return Promise resolving to refreshed DatabaseSchema.
   */
  switchDatabase: (database: string): Promise<DatabaseSchema> => {
    return invoke<DatabaseSchema>('cmd_switch_database', { database });
  },

  /**
   * @brief Disconnects the active database connection and clears backend connection state.
   * @return Promise resolving to true on successful disconnect.
   */
  disconnect: (): Promise<boolean> => {
    return invoke<boolean>('cmd_disconnect');
  },

  /**
   * @brief Introspects relational metadata and structure from the currently active database connection.
   * @return Promise resolving to complete DatabaseSchema.
   */
  introspectSchema: (): Promise<DatabaseSchema> => {
    return invoke<DatabaseSchema>('cmd_introspect_schema');
  },

  /**
   * @brief Resolves the primary key columns of a table on the active connection.
   * @param table Table name, optionally schema qualified.
   * @return Promise resolving to the ordered primary key column names (empty when none).
   */
  getPrimaryKeys: (table: string): Promise<string[]> => {
    return invoke<string[]>('cmd_get_primary_keys', { table });
  },

  /**
   * @brief Calculates structural differences between the current live schema and target desired schema.
   * @param current Reference to the current live database schema.
   * @param desired Reference to the target desired database schema design.
   * @return Promise resolving to structured SchemaDiff model.
   */
  computeDiff: (current: DatabaseSchema, desired: DatabaseSchema): Promise<SchemaDiff> => {
    return invoke<SchemaDiff>('cmd_compute_diff', { current, desired });
  },

  /**
   * @brief Generates dialect-accurate SQL DDL migration statements for a computed schema diff.
   * @param diff Schema difference model describing planned modifications.
   * @return Promise resolving to generated statements plus warnings for unsupported changes.
   */
  generateDdl: (diff: SchemaDiff): Promise<GeneratedDdl> => {
    return invoke<GeneratedDdl>('cmd_generate_ddl', { diff });
  },

  /**
   * @brief Stores connection credentials in the operating system secret store.
   * @details Secrets can be written but never read back by the frontend; only the backend resolves
   * them while connecting.
   * @param id Saved connection profile identifier.
   * @param dbPassword Database password to remember, if any.
   * @param sshPassword SSH bastion password to remember, if any.
   * @param sshPassphrase SSH private key passphrase to remember, if any.
   * @return Promise resolving to true once the secret store has been updated.
   */
  saveConnectionSecrets: (
    id: string,
    dbPassword?: string,
    sshPassword?: string,
    sshPassphrase?: string
  ): Promise<boolean> => {
    return invoke<boolean>('cmd_save_connection_secrets', {
      id,
      dbPassword,
      sshPassword,
      sshPassphrase,
    });
  },

  /**
   * @brief Removes stored credentials for a connection profile.
   * @param id Saved connection profile identifier.
   * @return Promise resolving to true once the entry is gone.
   */
  deleteConnectionSecrets: (id: string): Promise<boolean> => {
    return invoke<boolean>('cmd_delete_connection_secrets', { id });
  },

  /**
   * @brief Reports whether credentials are stored for a connection profile.
   * @param id Saved connection profile identifier.
   * @return Promise resolving to true when the secret store holds an entry.
   */
  hasConnectionSecrets: (id: string): Promise<boolean> => {
    return invoke<boolean>('cmd_has_connection_secrets', { id });
  },

  /**
   * @brief Executes a series of DDL migration statements against the active database.
   * @param statements Ordered list of SQL DDL statements to apply.
   * @return Promise resolving to MigrationReport with execution details.
   */
  executeMigration: (statements: string[]): Promise<MigrationReport> => {
    return invoke<MigrationReport>('cmd_execute_migration', { statements });
  },

  /**
   * @brief Executes an arbitrary user-submitted SQL query and returns tabular results.
   * @param sql SQL statement string to execute.
   * @return Promise resolving to QueryResult with column names and row values.
   */
  executeQuery: (sql: string): Promise<QueryResult> => {
    return invoke<QueryResult>('cmd_execute_query', { sql });
  },

  /**
   * @brief Executes transactional row mutations against the active database.
   * @param updates List of row update payloads specifying tables, PKs, and modified column values.
   * @return Promise resolving to total number of rows updated.
   */
  updateRows: (updates: RowUpdatePayload[]): Promise<number> => {
    return invoke<number>('cmd_update_rows', { updates });
  },

  /**
   * @brief Generates an execution plan tree for the provided SQL query against the active database.
   * @param sql SQL statement string to analyze and explain.
   * @return Promise resolving to ExecutionPlanNode tree representing optimizer operations.
   */
  explainQuery: (sql: string): Promise<ExecutionPlanNode> => {
    return invoke<ExecutionPlanNode>('cmd_explain_query', { sql });
  },

  /**
   * @brief Records a query execution event into local persistent SQLite history.
   * @param query SQL query string.
   * @param durationMs Execution duration in milliseconds.
   * @param rowsCount Number of affected or returned rows.
   * @param status Status string ("success" or "error").
   * @return Promise resolving to saved QueryHistoryRecord.
   */
  recordQueryHistory: (
    query: string,
    durationMs: number,
    rowsCount: number,
    status: string,
  ): Promise<QueryHistoryRecord> => {
    return invoke<QueryHistoryRecord>('cmd_record_query_history', {
      query,
      durationMs,
      rowsCount,
      status,
    });
  },

  /**
   * @brief Retrieves latest query execution records.
   * @param limit Maximum number of records to retrieve (default 100).
   * @return Promise resolving to list of QueryHistoryRecord items.
   */
  getQueryHistory: (limit?: number): Promise<QueryHistoryRecord[]> => {
    return invoke<QueryHistoryRecord[]>('cmd_get_query_history', { limit });
  },

  /**
   * @brief Toggles favorite bookmark status for a query record.
   * @param id History record primary key ID.
   * @return Promise resolving to updated boolean favorite status.
   */
  toggleFavoriteQuery: (id: number): Promise<boolean> => {
    return invoke<boolean>('cmd_toggle_favorite_query', { id });
  },

  /**
   * @brief Clears non-favorite query history records.
   * @return Promise resolving when history is cleared.
   */
  clearQueryHistory: (): Promise<void> => {
    return invoke<void>('cmd_clear_query_history');
  },
};


