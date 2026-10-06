/**
 * @file App.tsx
 * @brief Modern dark-themed root application shell and workspace coordinator for DynoDbModeler.
 * @details Manages top-level state including database connections, schema introspection,
 * active navigation tabs, table selection, SQL query execution, and connection modal workflows.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
 * @brief Root component for DynoDbModeler application layout.
 * @return Rendered root React element.
 */
export default function App(): React.ReactElement {
  // Navigation & Modal State
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('erd');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ConnectionConfig | null>(null);

  // Connection & Schema State
  const [connections, setConnections] = useState<ConnectionConfig[]>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Ignore parse failure and fall back
    }
    return DEFAULT_SAMPLE_CONNECTIONS;
  });

  const [activeConnection, setActiveConnection] = useState<ConnectionConfig | null>(null);
  const [liveSchema, setLiveSchema] = useState<DatabaseSchema | null>(null);
  const [schema, setSchema] = useState<DatabaseSchema | null>(null);
  const [selectedTableName, setSelectedTableName] = useState<string | null>(null);
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerTable, setDrawerTable] = useState<TableSchema | null>(null);

  // Schema Diff & Safe Migration State
  const [diff, setDiff] = useState<SchemaDiff | null>(null);
  const [generatedDdl, setGeneratedDdl] = useState<string[]>([]);
  const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);
  const [, setIsComputingDiff] = useState(false);

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

  // Persist connections list to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(connections));
    } catch {
      // Storage unavailable
    }
  }, [connections]);

  /**
   * @brief Handles establishing a connection and introspecting its schema.
   * @param config Connection parameters.
   */
  const handleConnect = useCallback(async (config: ConnectionConfig) => {
    setIsLoadingSchema(true);
    setNotification({ type: 'info', message: `Connecting to ${config.name}...` });

    try {
      await api.connect(config);

      // Save/update in connections list
      setConnections((prev) => {
        const existingIdx = prev.findIndex((c) => c.id === config.id);
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = config;
          return updated;
        }
        return [...prev, config];
      });

      setActiveConnection(config);

      // Introspect schema
      const fetchedSchema = await api.introspectSchema();
      setLiveSchema(fetchedSchema);
      setSchema(fetchedSchema);

      if (fetchedSchema.tables.length > 0) {
        setSelectedTableName(fetchedSchema.tables[0].name);
      } else {
        setSelectedTableName(null);
      }

      setNotification({
        type: 'success',
        message: `Connected to ${config.name} (${fetchedSchema.tables.length} tables found)`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setNotification({ type: 'error', message: `Connection failed: ${msg}` });
      throw err;
    } finally {
      setIsLoadingSchema(false);
    }
  }, []);

  /**
   * @brief Refreshes schema from the currently connected database.
   * @param showToast Optional flag specifying whether to trigger a refresh toast notification.
   */
  const handleRefreshSchema = useCallback(async (showToast = true) => {
    if (!activeConnection) return;
    setIsLoadingSchema(true);

    try {
      const fetchedSchema = await api.introspectSchema();
      setLiveSchema(fetchedSchema);
      setSchema(fetchedSchema);
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
  }, [activeConnection]);

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
    setSelectedTableName(null);
    setDiff(null);
    setGeneratedDdl([]);
    setIsDiffModalOpen(false);
    setNotification({ type: 'info', message: 'Disconnected from database.' });
  }, []);

  /**
   * @brief Deletes a saved connection profile.
   * @param id Identifier of the connection to remove.
   */
  const handleDeleteConnection = (id: string) => {
    if (activeConnection?.id === id) {
      handleDisconnect();
    }
    setConnections((prev) => prev.filter((c) => c.id !== id));
    setNotification({ type: 'info', message: 'Connection removed.' });
  };

  /**
   * @brief Handles saving table schema modifications or adding a new table to working schema.
   * @param updatedTable Modified or newly created table schema.
   * @param originalName Previous table name if renamed or editing existing table.
   */
  const handleSaveTable = useCallback(
    (updatedTable: TableSchema, originalName?: string) => {
      setSchema((prev) => {
        if (!prev) {
          return {
            database_name: activeConnection?.database || 'database',
            tables: [updatedTable],
          };
        }

        if (originalName) {
          const exists = prev.tables.some((t) => t.name === originalName);
          if (exists) {
            return {
              ...prev,
              tables: prev.tables.map((t) =>
                t.name === originalName ? updatedTable : t
              ),
            };
          }
        }

        return {
          ...prev,
          tables: [...prev.tables, updatedTable],
        };
      });

      setSelectedTableName(updatedTable.name);
      setNotification({
        type: 'success',
        message: `Table "${updatedTable.name}" saved.`,
      });
    },
    [activeConnection]
  );

  /**
   * @brief Handles deleting a table from the working schema.
   * @param tableName Name of the table to remove.
   */
  const handleDeleteTable = useCallback(
    (tableName: string) => {
      setSchema((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tables: prev.tables.filter((t) => t.name !== tableName),
        };
      });

      if (selectedTableName === tableName) {
        setSelectedTableName(null);
      }

      setNotification({
        type: 'info',
        message: `Table "${tableName}" removed from schema.`,
      });
    },
    [selectedTableName]
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
      const ddlStatements = await api.generateDdl(computedDiff);

      setDiff(computedDiff);
      setGeneratedDdl(ddlStatements);
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

  return (
    <div className="flex h-screen w-screen flex-col bg-[#1e1f22] text-[#e6e8ea] overflow-hidden font-sans">
      {/* Top HeaderBar */}
      <HeaderBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        activeConnection={activeConnection}
        onDisconnect={handleDisconnect}
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
          selectedTableName={selectedTableName}
          onOpenNewConnection={() => {
            setEditingConfig(null);
            setIsModalOpen(true);
          }}
          onSelectConnection={(conn) => handleConnect(conn)}
          onSelectTable={(tableName) => {
            setSelectedTableName(tableName);
            if (activeTab === 'settings') setActiveTab('erd');
          }}
          onRefresh={handleRefreshSchema}
          isLoading={isLoadingSchema}
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
                  onEditTable={(tableName) => {
                    const targetTable =
                      schema?.tables.find((t) => t.name === tableName) || null;
                    setDrawerTable(targetTable);
                    setIsDrawerOpen(true);
                  }}
                  onSelectTable={(tableName) => {
                    setSelectedTableName(tableName);
                  }}
                  onAddNewTable={() => {
                    setDrawerTable(null);
                    setIsDrawerOpen(true);
                  }}
                  onTablePositionChange={(tableName, pos) => {
                    if (schema) {
                      setSchema({
                        ...schema,
                        tables: schema.tables.map((t) =>
                          t.name === tableName ? { ...t, ui_position: pos } : t
                        ),
                      });
                    }
                  }}
                  onOpenDiff={handleOpenDiff}
                  pendingChangesCount={pendingChangesCount}
                />
                <TableDrawer
                  isOpen={isDrawerOpen}
                  table={drawerTable}
                  onClose={() => setIsDrawerOpen(false)}
                  onSaveTable={handleSaveTable}
                  onDeleteTable={handleDeleteTable}
                />
              </div>
            )
          )}

          {/* VIEW: SQL Query Editor Tab */}
          {(activeTab === 'sql' || (activeTab as string) === 'query') && (
            <QueryEditorTab activeConnection={activeConnection} />
          )}

          {/* VIEW: Settings / Connection Manager Tab */}
          {activeTab === 'settings' && (
            <SettingsView
              connections={connections}
              activeConnection={activeConnection}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
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
        onClose={() => setIsDiffModalOpen(false)}
        onExecute={handleExecuteMigration}
      />
    </div>
  );
}
