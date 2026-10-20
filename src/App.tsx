/**
 * @file App.tsx
 * @brief Modern dark-themed root application shell and workspace coordinator for DynoDbModeler.
 * @details Manages top-level state including database connections, schema introspection,
 * active navigation tabs, table selection, SQL query execution, and connection modal workflows.
 * Connection profiles are stored without secrets: passwords live in the operating system secret
 * store and are never written to the webview's localStorage.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { CheckCircle2, AlertCircle, X, Database, Plus } from 'lucide-react';
import { HeaderBar, WorkspaceTab } from './components/HeaderBar';
import { Sidebar } from './components/Sidebar';
import { ConnectionModal } from './components/ConnectionModal';
import { ErdCanvas } from './components/canvas/ErdCanvas';
import { TableDrawer } from './components/canvas/TableDrawer';
import { DiffModal } from './components/diff/DiffModal';
import { QueryEditorTab } from './components/query/QueryEditorTab';
import { SettingsView } from './components/SettingsView';
import { api } from './api/ipc';
import { computePendingChangesCount } from './utils/diffCount';
import { connectionScope } from './utils/connectionScope';
import { tableKey } from './types/database';
import { buildPaginatedSelectQuery } from './utils/sqlPagination';
import type {
  ConnectionConfig,
  DatabaseSchema,
  SchemaDiff,
  TableSchema,
} from './types/database';

const LOCAL_STORAGE_KEY = 'dyno_connections';

const DEFAULT_SAMPLE_CONNECTIONS: ConnectionConfig[] = [
  {
    id: 'sample-sqlite-mem',
    name: 'Sample In-Memory SQLite',
    db_type: 'Sqlite',
    database: ':memory:',
    file_path: ':memory:',
    ssl: false,
  },
];

/**
 * @brief Removes credentials from a connection profile before it is persisted.
 * @details Passwords live in the operating system secret store; keeping them out of the profile
 * means they are never written to the webview's localStorage.
 * @param config Connection profile to sanitize.
 * @return Copy of the profile with all secret fields cleared.
 */
export function stripSecrets(config: ConnectionConfig): ConnectionConfig {
  const { password: _password, ssh_tunnel: sshTunnel, ...rest } = config;
  return {
    ...rest,
    ssh_tunnel: sshTunnel
      ? { ...sshTunnel, password: undefined, passphrase: undefined }
      : sshTunnel,
  };
}

/**
 * @brief Indicates whether a profile still carries any secret material.
 * @param config Connection profile to inspect.
 * @return `true` when a password or SSH secret is present.
 */
function hasSecrets(config: ConnectionConfig): boolean {
  return Boolean(
    config.password ||
      config.ssh_tunnel?.password ||
      config.ssh_tunnel?.passphrase
  );
}

/**
 * @brief Loads saved connection profiles, stripping any legacy plaintext credentials.
 * @return Tuple of sanitized profiles and whether legacy secrets were removed.
 */
function loadSavedConnections(): { connections: ConnectionConfig[]; removedSecrets: boolean } {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!saved) {
      return { connections: DEFAULT_SAMPLE_CONNECTIONS, removedSecrets: false };
    }
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { connections: DEFAULT_SAMPLE_CONNECTIONS, removedSecrets: false };
    }
    const profiles = parsed as ConnectionConfig[];
    const removedSecrets = profiles.some(hasSecrets);
    return { connections: profiles.map(stripSecrets), removedSecrets };
  } catch {
    return { connections: DEFAULT_SAMPLE_CONNECTIONS, removedSecrets: false };
  }
}

/**
 * @brief Root component for DynoDbModeler application layout.
 * @return Rendered root React element.
 */
export default function App(): React.ReactElement {
  // Navigation & Modal State
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('erd');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ConnectionConfig | null>(null);

  // Connection & Schema State. Secrets are stripped on load and on every save.
  const initialState = useMemo(loadSavedConnections, []);
  const [connections, setConnections] = useState<ConnectionConfig[]>(
    initialState.connections
  );
  const legacySecretsRemoved = useRef(initialState.removedSecrets);

  const [activeConnection, setActiveConnection] = useState<ConnectionConfig | null>(null);
  const [liveSchema, setLiveSchema] = useState<DatabaseSchema | null>(null);
  const [schema, setSchema] = useState<DatabaseSchema | null>(null);
  const [selectedTableKey, setSelectedTableKey] = useState<string | null>(null);
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [serverDatabases, setServerDatabases] = useState<string[]>([]);
  const [isLoadingDatabases, setIsLoadingDatabases] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerTable, setDrawerTable] = useState<TableSchema | null>(null);

  // Schema Diff & Safe Migration State
  const [diff, setDiff] = useState<SchemaDiff | null>(null);
  const [generatedDdl, setGeneratedDdl] = useState<string[]>([]);
  const [ddlWarnings, setDdlWarnings] = useState<string[]>([]);
  const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);
  const [, setIsComputingDiff] = useState(false);

  // SQL Query Execution & Server-side Pagination State
  const [activeSqlQuery, setActiveSqlQuery] = useState<string | null>(null);
  const [autoRunQuery, setAutoRunQuery] = useState<boolean>(false);

  // Dynamically compute pending changes count between live and desired working schemas
  const pendingChangesCount = useMemo(() => {
    return computePendingChangesCount(liveSchema, schema);
  }, [liveSchema, schema]);

  // Notification Toast State
  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // Auto-dismiss toast
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Inform the user once when legacy plaintext credentials were removed from local storage.
  useEffect(() => {
    if (legacySecretsRemoved.current) {
      legacySecretsRemoved.current = false;
      setNotification({
        type: 'info',
        message:
          'Stored passwords were moved out of browser storage. Re-enter them once to save them to the system credential store.',
      });
    }
  }, []);

  // Persist connections list (without secrets) to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(connections));
    } catch {
      // Storage unavailable
    }
  }, [connections]);

  /**
   * @brief Handles establishing a connection and introspecting its schema.
   * @details Never throws: connection failures are reported through the notification toast and the
   * boolean result, so callers cannot leak unhandled promise rejections.
   * @param config Connection parameters.
   * @return `true` when the connection and introspection succeeded.
   */
  const handleConnect = useCallback(async (config: ConnectionConfig): Promise<boolean> => {
    setIsLoadingSchema(true);
    setNotification({ type: 'info', message: `Connecting to ${config.name}...` });

    try {
      await api.connect(config);

      const storedProfile = stripSecrets(config);

      setConnections((prev) => {
        const existingIdx = prev.findIndex((c) => c.id === storedProfile.id);
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = storedProfile;
          return updated;
        }
        return [...prev, storedProfile];
      });

      setActiveConnection(storedProfile);

      const fetchedSchema = await api.introspectSchema();
      setLiveSchema(fetchedSchema);
      setSchema(fetchedSchema);

      setSelectedTableKey(
        fetchedSchema.tables.length > 0 ? tableKey(fetchedSchema.tables[0]) : null
      );

      setNotification({
        type: 'success',
        message: `Connected to ${config.name} (${fetchedSchema.tables.length} tables found)`,
      });

      // Discover all databases on server if network database
      if (config.db_type !== 'Sqlite' && config.db_type !== 'DuckDb') {
        try {
          const dbs = await api.listActiveDatabases();
          setServerDatabases(dbs);
        } catch {
          setServerDatabases([]);
        }
      } else {
        setServerDatabases([]);
      }

      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setNotification({ type: 'error', message: `Connection failed: ${msg}` });
      return false;
    } finally {
      setIsLoadingSchema(false);
    }
  }, []);

  /**
   * @brief Connects a saved profile, asking for credentials when the secret store has none.
   * @param conn Saved connection profile.
   */
  const connectSavedProfile = useCallback(
    async (conn: ConnectionConfig) => {
      let hasStoredSecrets = false;
      try {
        hasStoredSecrets = await api.hasConnectionSecrets(conn.id);
      } catch {
        hasStoredSecrets = false;
      }

      const needsCredentials =
        !hasStoredSecrets &&
        (conn.db_type === 'Postgres' ||
          conn.db_type === 'MySql' ||
          conn.db_type === 'Mssql');

      if (needsCredentials) {
        setEditingConfig(conn);
        setIsModalOpen(true);
        setNotification({
          type: 'info',
          message: `Enter the password for ${conn.name} (it will be kept in the system credential store).`,
        });
        return;
      }

      const ok = await handleConnect(conn);
      if (!ok) {
        setEditingConfig(conn);
        setIsModalOpen(true);
      }
    },
    [handleConnect]
  );

  /**
   * @brief Queries and updates available databases on the active server connection.
   */
  const handleRefreshDatabases = useCallback(async () => {
    if (!activeConnection) return;
    if (activeConnection.db_type === 'Sqlite' || activeConnection.db_type === 'DuckDb') return;
    setIsLoadingDatabases(true);
    try {
      const dbs = await api.listActiveDatabases();
      setServerDatabases(dbs);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setNotification({ type: 'error', message: `Could not list databases: ${msg}` });
    } finally {
      setIsLoadingDatabases(false);
    }
  }, [activeConnection]);

  /**
   * @brief Switches the active database catalog on the current server.
   * @param targetDb Target database name.
   */
  const handleSwitchDatabase = useCallback(
    async (targetDb: string) => {
      if (!activeConnection || activeConnection.database === targetDb) return;
      setIsLoadingSchema(true);
      setNotification({ type: 'info', message: `Switching to ${targetDb}...` });

      try {
        const newSchema = await api.switchDatabase(targetDb);
        setLiveSchema(newSchema);
        setSchema(newSchema);
        setActiveConnection((prev) => (prev ? { ...prev, database: targetDb } : null));
        setSelectedTableKey(
          newSchema.tables.length > 0 ? tableKey(newSchema.tables[0]) : null
        );
        setNotification({
          type: 'success',
          message: `Switched to database ${targetDb} (${newSchema.tables.length} tables found)`,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setNotification({ type: 'error', message: `Failed to switch database: ${msg}` });
      } finally {
        setIsLoadingSchema(false);
      }
    },
    [activeConnection]
  );

  /**
   * @brief Refreshes schema from the currently connected database.
   * @param showToast Optional flag specifying whether to trigger a refresh toast notification.
   */
  const handleRefreshSchema = useCallback(
    async (showToast = true) => {
      if (!activeConnection) return;
      setIsLoadingSchema(true);

      try {
        const fetchedSchema = await api.introspectSchema();
        setLiveSchema(fetchedSchema);
        setSchema(fetchedSchema);
        setSelectedTableKey((prev) => {
          if (prev && fetchedSchema.tables.some((t) => tableKey(t) === prev)) {
            return prev;
          }
          return fetchedSchema.tables.length > 0 ? tableKey(fetchedSchema.tables[0]) : null;
        });
        if (showToast) {
          setNotification({
            type: 'success',
            message: `Refreshed schema (${fetchedSchema.tables.length} tables)`,
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setNotification({ type: 'error', message: `Schema refresh failed: ${msg}` });
      } finally {
        setIsLoadingSchema(false);
      }
    },
    [activeConnection]
  );

  /**
   * @brief Disconnects active database session.
   */
  const handleDisconnect = useCallback(async () => {
    try {
      await api.disconnect();
    } catch {
      // Ignore disconnect backend errors
    }
    setActiveConnection(null);
    setLiveSchema(null);
    setSchema(null);
    setSelectedTableKey(null);
    setDiff(null);
    setGeneratedDdl([]);
    setDdlWarnings([]);
    setIsDiffModalOpen(false);
    setNotification({ type: 'info', message: 'Disconnected from database.' });
  }, []);

  /**
   * @brief Deletes a saved connection profile and its stored credentials.
   * @param id Identifier of the connection to remove.
   */
  const handleDeleteConnection = (id: string) => {
    if (activeConnection?.id === id) {
      void handleDisconnect();
    }
    void api.deleteConnectionSecrets(id).catch(() => {
      // Credential cleanup is best effort; the profile is removed regardless.
    });
    setConnections((prev) => prev.filter((c) => c.id !== id));
    setNotification({ type: 'info', message: 'Connection removed.' });
  };

  /**
   * @brief Handles saving table schema modifications or adding a new table to working schema.
   * @details A renamed table records its previous identity through `rename_from` and every foreign
   * key that pointed at the old name is retargeted. Without this the diff engine would emit a
   * destructive DROP + CREATE pair for what the user experienced as a rename.
   * @param updatedTable Modified or newly created table schema.
   * @param originalKey Qualified key of the table before editing, when editing an existing table.
   */
  const handleSaveTable = useCallback(
    (updatedTable: TableSchema, originalKey?: string) => {
      setSchema((prev) => {
        if (!prev) {
          return {
            database_name: activeConnection?.database || 'database',
            tables: [updatedTable],
          };
        }

        const newKey = tableKey(updatedTable);
        const isRename = Boolean(originalKey) && originalKey !== newKey;

        const nextTable: TableSchema = isRename
          ? { ...updatedTable, rename_from: originalKey }
          : { ...updatedTable, rename_from: undefined };

        let tables: TableSchema[];
        if (originalKey && prev.tables.some((t) => tableKey(t) === originalKey)) {
          tables = prev.tables.map((t) => {
            if (tableKey(t) === originalKey) {
              return { ...nextTable, ui_position: nextTable.ui_position ?? t.ui_position };
            }
            return t;
          });
        } else {
          tables = [...prev.tables, nextTable];
        }

        if (isRename) {
          // Retarget every foreign key that referenced the previous table identity so the
          // constraint is not reported as changed and later re-created against a missing table.
          tables = tables.map((t) => ({
            ...t,
            foreign_keys: t.foreign_keys.map((fk) =>
              fk.target_table === originalKey ? { ...fk, target_table: newKey } : fk
            ),
          }));
        }

        return { ...prev, tables };
      });

      setSelectedTableKey(tableKey(updatedTable));
      setNotification({
        type: 'success',
        message: `Table "${tableKey(updatedTable)}" saved.`,
      });
    },
    [activeConnection]
  );

  /**
   * @brief Handles deleting a table from the working schema.
   * @param key Qualified key of the table to remove.
   */
  const handleDeleteTable = useCallback(
    (key: string) => {
      setSchema((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tables: prev.tables.filter((t) => tableKey(t) !== key),
        };
      });

      setSelectedTableKey((prev) => (prev === key ? null : prev));

      setNotification({
        type: 'info',
        message: `Table "${key}" removed from schema.`,
      });
    },
    []
  );

  /**
   * @brief Calculates schema differences between live and current working schema,
   * generates target DDL statements, and opens the interactive DiffModal.
   */
  const handleOpenDiff = useCallback(async () => {
    if (!activeConnection) {
      setNotification({
        type: 'info',
        message: 'Connect to a database first to review and synchronize schema changes.',
      });
      return;
    }

    let currentLive = liveSchema;
    if (!currentLive) {
      try {
        currentLive = await api.introspectSchema();
        setLiveSchema(currentLive);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setNotification({
          type: 'error',
          message: `Failed to fetch live schema: ${msg}`,
        });
        return;
      }
    }

    const currentDesired = schema || {
      database_name: activeConnection.database,
      tables: [],
    };

    setIsComputingDiff(true);
    try {
      const computedDiff = await api.computeDiff(currentLive, currentDesired);
      const generated = await api.generateDdl(computedDiff);

      setDiff(computedDiff);
      setGeneratedDdl(generated.statements);
      setDdlWarnings(generated.warnings ?? []);
      setIsDiffModalOpen(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setNotification({
        type: 'error',
        message: `Diff calculation failed: ${msg}`,
      });
    } finally {
      setIsComputingDiff(false);
    }
  }, [activeConnection, liveSchema, schema]);

  /**
   * @brief Executes migration SQL statements inside a safe transaction block.
   * @param statements Ordered list of SQL DDL statements to apply.
   */
  const handleExecuteMigration = useCallback(
    async (statements: string[]) => {
      try {
        const report = await api.executeMigration(statements);
        if (!report.success) {
          throw new Error(
            report.error_message || 'Migration failed during transaction execution.'
          );
        }

        setNotification({
          type: 'success',
          message: `Migration applied successfully (${report.statements_executed} statements in ${report.execution_time_ms}ms).`,
        });

        // Refresh live schema from database and synchronize canvas state
        await handleRefreshSchema(false);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setNotification({
          type: 'error',
          message: `Migration execution failed: ${msg}`,
        });
        throw err;
      }
    },
    [handleRefreshSchema]
  );

  /**
   * @brief Navigates to the SQL query tab to inspect table rows, pre-filling and auto-executing a paginated query.
   * @details Constructs a dialect-specific paginated SELECT statement using a default limit of 50 rows,
   * selects the table in state, switches the active workspace tab to 'sql', and triggers automatic execution.
   * @param key Schema-qualified or unqualified table name.
   */
  const handleViewTableData = useCallback(
    (key: string) => {
      if (!activeConnection) return;
      const initialPaginatedSql = buildPaginatedSelectQuery(
        key,
        activeConnection.db_type,
        50,
        0
      );
      setActiveSqlQuery(initialPaginatedSql);
      setAutoRunQuery(true);
      setSelectedTableKey(key);
      setActiveTab('sql');
    },
    [activeConnection]
  );

  return (
    <div className="flex h-screen w-screen flex-col bg-[#1e1f22] text-[#e6e8ea] overflow-hidden font-sans">
      {/* Top HeaderBar */}
      <HeaderBar
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setAutoRunQuery(false);
          setActiveTab(tab);
        }}
        activeConnection={activeConnection}
        onDisconnect={() => {
          void handleDisconnect();
        }}
        onOpenNewConnection={() => {
          setEditingConfig(null);
          setIsModalOpen(true);
        }}
        onOpenDiff={handleOpenDiff}
        pendingChangesCount={pendingChangesCount}
      />

      {/* Main Workspace (Sidebar + Canvas / Editor) */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Sidebar */}
        <Sidebar
          connections={connections}
          activeConnection={activeConnection}
          tables={schema?.tables || []}
          selectedTableKey={selectedTableKey}
          onOpenNewConnection={() => {
            setEditingConfig(null);
            setIsModalOpen(true);
          }}
          onSelectConnection={(conn) => {
            void connectSavedProfile(conn);
          }}
          onSelectTable={(key) => {
            setSelectedTableKey(key);
            if (activeTab === 'settings') setActiveTab('erd');
          }}
          onRefresh={() => {
            void handleRefreshSchema();
          }}
          isLoading={isLoadingSchema}
          serverDatabases={serverDatabases}
          onSwitchDatabase={(db) => {
            void handleSwitchDatabase(db);
          }}
          onRefreshDatabases={() => {
            void handleRefreshDatabases();
          }}
          isLoadingDatabases={isLoadingDatabases}
          onViewTableData={handleViewTableData}
        />

        {/* Center / Right Content Panel */}
        <main className="flex-1 flex flex-col bg-[#1e1f22] overflow-hidden relative">
          {/* Notification Toast */}
          {notification && (
            <div
              className={`absolute top-3 right-4 z-40 flex items-center gap-2 px-3 py-2 rounded-md shadow-lg text-xs animate-in fade-in slide-in-from-top-2 border ${
                notification.type === 'success'
                  ? 'bg-[#20c997]/15 border-[#20c997]/40 text-[#20c997]'
                  : notification.type === 'error'
                  ? 'bg-red-500/15 border-red-500/40 text-red-300'
                  : 'bg-[#3a82f7]/15 border-[#3a82f7]/40 text-[#3a82f7]'
              }`}
            >
              {notification.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span className="font-medium">{notification.message}</span>
              <button
                type="button"
                onClick={() => setNotification(null)}
                className="ml-2 text-current opacity-70 hover:opacity-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* VIEW: ERD Canvas Tab */}
          {activeTab === 'erd' && (
            !activeConnection ? (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="max-w-md w-full bg-[#18191c] border border-[#35373c] rounded-lg p-8 text-center shadow-xl space-y-4">
                  <div className="w-12 h-12 bg-[#3a82f7]/10 text-[#3a82f7] rounded-full flex items-center justify-center mx-auto">
                    <Database className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-[#e6e8ea]">
                      No Database Connected
                    </h2>
                    <p className="mt-1 text-xs text-[#8c919a]">
                      Connect to SQLite, PostgreSQL, MySQL, or SQL Server to introspect schemas
                      and visualize entity relationships.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingConfig(null);
                      setIsModalOpen(true);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-[#3a82f7] hover:bg-[#2f6fd6] text-white rounded font-medium text-xs shadow transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Connect Database</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 relative h-full w-full overflow-hidden">
                <ErdCanvas
                  schema={schema || { database_name: activeConnection.database, tables: [] }}
                  storageScope={connectionScope(activeConnection)}
                  onEditTable={(key) => {
                    const targetTable =
                      schema?.tables.find((t) => tableKey(t) === key) || null;
                    setDrawerTable(targetTable);
                    setIsDrawerOpen(true);
                  }}
                  onSelectTable={(key) => {
                    setSelectedTableKey(key);
                  }}
                  onAddNewTable={() => {
                    setDrawerTable(null);
                    setIsDrawerOpen(true);
                  }}
                  onTablePositionChange={(key, pos) => {
                    setSchema((prev) =>
                      prev
                        ? {
                            ...prev,
                            tables: prev.tables.map((t) =>
                              tableKey(t) === key ? { ...t, ui_position: pos } : t
                            ),
                          }
                        : prev
                    );
                  }}
                  onOpenDiff={handleOpenDiff}
                  pendingChangesCount={pendingChangesCount}
                  onViewTableData={handleViewTableData}
                />
                <TableDrawer
                  isOpen={isDrawerOpen}
                  table={drawerTable}
                  existingTableKeys={(schema?.tables || []).map((t) => tableKey(t))}
                  onClose={() => setIsDrawerOpen(false)}
                  onSaveTable={handleSaveTable}
                  onDeleteTable={handleDeleteTable}
                />
              </div>
            )
          )}

          {/* VIEW: SQL Query Editor Tab */}
          {(activeTab === 'sql' || (activeTab as string) === 'query') && (
            <QueryEditorTab
              activeConnection={activeConnection}
              initialQuery={activeSqlQuery || undefined}
              autoRun={autoRunQuery}
              onQuerySuccess={() => {
                setAutoRunQuery(false);
              }}
            />
          )}

          {/* VIEW: Settings / Connection Manager Tab */}
          {activeTab === 'settings' && (
            <SettingsView
              connections={connections}
              activeConnection={activeConnection}
              onConnect={(conn) => {
                void connectSavedProfile(conn);
              }}
              onDisconnect={() => {
                void handleDisconnect();
              }}
              onEdit={(conn) => {
                setEditingConfig(conn);
                setIsModalOpen(true);
              }}
              onDelete={handleDeleteConnection}
              onOpenNewConnection={() => {
                setEditingConfig(null);
                setIsModalOpen(true);
              }}
            />
          )}
        </main>
      </div>

      {/* Connection Modal Dialog */}
      <ConnectionModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingConfig(null);
        }}
        onConnect={handleConnect}
        initialConfig={editingConfig}
      />

      {/* Visual Schema Diff & Interactive Safe Migration Modal */}
      <DiffModal
        isOpen={isDiffModalOpen}
        diff={diff}
        generatedDdl={generatedDdl}
        warnings={ddlWarnings}
        onClose={() => setIsDiffModalOpen(false)}
        onExecute={handleExecuteMigration}
      />
    </div>
  );
}
