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
  MigrationReport,
  QueryResult,
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
   * @return Promise resolving to ordered list of executable SQL DDL migration statements.
   */
  generateDdl: (diff: SchemaDiff): Promise<string[]> => {
    return invoke<string[]>('cmd_generate_ddl', { diff });
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
};

