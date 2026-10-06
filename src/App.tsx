/**
 * @file App.tsx
 * @brief TablePlus-themed root application shell and workspace coordinator for DynoDbModeler.
 * @details Manages top-level state including database connections, schema introspection,
 * active navigation tabs, table selection, SQL query execution, and connection modal workflows.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { HeaderBar, WorkspaceTab } from './components/HeaderBar';
import { Sidebar } from './components/Sidebar';
import { ConnectionModal } from './components/ConnectionModal';
import { ErdView } from './components/ErdView';
import { SqlQueryView } from './components/SqlQueryView';
import { SettingsView } from './components/SettingsView';
import { api } from './api/ipc';
import type {
  ConnectionConfig,
  DatabaseSchema,
  QueryResult,
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
  const [schema, setSchema] = useState<DatabaseSchema | null>(null);
  const [selectedTableName, setSelectedTableName] = useState<string | null>(null);
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);

  // SQL Query Tab State
  const [sqlQuery, setSqlQuery] = useState('SELECT 1 AS status, "Ready" AS message;');
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [isExecutingQuery, setIsExecutingQuery] = useState(false);

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
   */
  const handleRefreshSchema = useCallback(async () => {
    if (!activeConnection) return;
    setIsLoadingSchema(true);

    try {
      const fetchedSchema = await api.introspectSchema();
      setSchema(fetchedSchema);
      setNotification({
        type: 'success',
        message: `Refreshed schema (${fetchedSchema.tables.length} tables)`,
      });
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
    setSchema(null);
    setSelectedTableName(null);
    setQueryResult(null);
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
   * @brief Executes the current SQL query in the query editor.
   */
  const handleExecuteQuery = async () => {
    if (!sqlQuery.trim()) return;
    setIsExecutingQuery(true);
    setQueryError(null);
    setQueryResult(null);

    try {
      const result = await api.executeQuery(sqlQuery);
      setQueryResult(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueryError(msg);
    } finally {
      setIsExecutingQuery(false);
    }
  };

  const selectedTable = schema?.tables.find((t) => t.name === selectedTableName);

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
            <ErdView
              activeConnection={activeConnection}
              selectedTable={selectedTable}
              onOpenNewConnection={() => {
                setEditingConfig(null);
                setIsModalOpen(true);
              }}
            />
          )}

          {/* VIEW: SQL Query Editor Tab */}
          {activeTab === 'sql' && (
            <SqlQueryView
              activeConnection={activeConnection}
              sqlQuery={sqlQuery}
              setSqlQuery={setSqlQuery}
              onExecuteQuery={handleExecuteQuery}
              isExecutingQuery={isExecutingQuery}
              queryResult={queryResult}
              queryError={queryError}
            />
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
    </div>
  );
}
