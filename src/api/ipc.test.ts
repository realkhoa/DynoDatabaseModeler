/**
 * @file ipc.test.ts
 * @brief Unit tests for Tauri IPC client bridge wrappers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from './ipc';
import type {
  ConnectionConfig,
  DatabaseSchema,
  RowUpdatePayload,
  SchemaDiff,
} from '../types/database';

// Mock Tauri core invoke function
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';

describe('Tauri IPC client API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const dummyConfig: ConnectionConfig = {
    id: 'c1',
    name: 'Dev SQLite',
    db_type: 'Sqlite',
    database: ':memory:',
    ssl: false,
  };

  /**
   * @brief Verifies testConnection calls cmd_test_connection with config payload.
   */
  it('calls cmd_test_connection with config', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(true);

    const result = await api.testConnection(dummyConfig);
    expect(invoke).toHaveBeenCalledWith('cmd_test_connection', { config: dummyConfig });
    expect(result).toBe(true);
  });

  /**
   * @brief Verifies connect calls cmd_connect with config payload.
   */
  it('calls cmd_connect with config', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(true);

    const result = await api.connect(dummyConfig);
    expect(invoke).toHaveBeenCalledWith('cmd_connect', { config: dummyConfig });
    expect(result).toBe(true);
  });

  /**
   * @brief Verifies disconnect calls cmd_disconnect without payload.
   */
  it('calls cmd_disconnect', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(true);

    const result = await api.disconnect();
    expect(invoke).toHaveBeenCalledWith('cmd_disconnect');
    expect(result).toBe(true);
  });

  /**
   * @brief Verifies introspectSchema calls cmd_introspect_schema.
   */
  it('calls cmd_introspect_schema', async () => {
    const mockSchema: DatabaseSchema = { database_name: 'test', tables: [] };
    vi.mocked(invoke).mockResolvedValueOnce(mockSchema);

    const result = await api.introspectSchema();
    expect(invoke).toHaveBeenCalledWith('cmd_introspect_schema');
    expect(result).toEqual(mockSchema);
  });

  /**
   * @brief Helper to generate an empty SchemaDiff fixture for tests.
   * @return Empty SchemaDiff structure.
   */
  const createMockDiff = (): SchemaDiff => ({
    tables_to_create: [],
    tables_to_drop: [],
    columns_to_add: [],
    columns_to_drop: [],
    columns_to_alter: [],
    foreign_keys_to_add: [],
    foreign_keys_to_drop: [],
  });

  /**
   * @brief Verifies computeDiff calls cmd_compute_diff with current and desired schemas.
   */
  it('calls cmd_compute_diff with current and desired schemas', async () => {
    const current: DatabaseSchema = { database_name: 'curr', tables: [] };
    const desired: DatabaseSchema = { database_name: 'des', tables: [] };
    const mockDiff = createMockDiff();
    vi.mocked(invoke).mockResolvedValueOnce(mockDiff);

    const result = await api.computeDiff(current, desired);
    expect(invoke).toHaveBeenCalledWith('cmd_compute_diff', { current, desired });
    expect(result).toEqual(mockDiff);
  });

  /**
   * @brief Verifies generateDdl calls cmd_generate_ddl with schema diff.
   */
  it('calls cmd_generate_ddl with diff payload', async () => {
    const mockDiff = createMockDiff();
    const mockStatements = ['CREATE TABLE users (id INT);'];
    vi.mocked(invoke).mockResolvedValueOnce(mockStatements);

    const result = await api.generateDdl(mockDiff);
    expect(invoke).toHaveBeenCalledWith('cmd_generate_ddl', { diff: mockDiff });
    expect(result).toEqual(mockStatements);
  });

  /**
   * @brief Verifies executeMigration calls cmd_execute_migration with SQL statements.
   */
  it('calls cmd_execute_migration with statements array', async () => {
    const statements = ['CREATE TABLE test (id INT);'];
    const mockReport = {
      success: true,
      statements_executed: 1,
      execution_time_ms: 12,
      error_message: null,
    };
    vi.mocked(invoke).mockResolvedValueOnce(mockReport);

    const result = await api.executeMigration(statements);
    expect(invoke).toHaveBeenCalledWith('cmd_execute_migration', { statements });
    expect(result).toEqual(mockReport);
  });

  /**
   * @brief Verifies executeQuery calls cmd_execute_query with SQL string.
   */
  it('calls cmd_execute_query with sql query string', async () => {
    const sql = 'SELECT * FROM test;';
    const mockResult = {
      columns: ['id'],
      rows: [[1]],
      rows_affected: 1,
      execution_time_ms: 5,
    };
    vi.mocked(invoke).mockResolvedValueOnce(mockResult);

    const result = await api.executeQuery(sql);
    expect(invoke).toHaveBeenCalledWith('cmd_execute_query', { sql });
    expect(result).toEqual(mockResult);
  });

  /**
   * @brief Verifies updateRows calls cmd_update_rows with row update payloads.
   */
  it('calls cmd_update_rows with updates payload', async () => {
    const mockUpdates: RowUpdatePayload[] = [
      {
        table: 'users',
        primary_keys: { id: 1 },
        updated_values: { name: 'Alice Smith' },
      },
    ];
    vi.mocked(invoke).mockResolvedValueOnce(1);

    const result = await api.updateRows(mockUpdates);
    expect(invoke).toHaveBeenCalledWith('cmd_update_rows', { updates: mockUpdates });
    expect(result).toBe(1);
  });
});

