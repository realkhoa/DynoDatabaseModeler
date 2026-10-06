/**
 * @file ConnectionModal.tsx
 * @brief TablePlus-styled dark modal dialog for configuring and testing database connections.
 * @details Supports SQLite, PostgreSQL, MySQL, and Microsoft SQL Server configurations
 * with real-time connectivity testing and form validation.
 */

import React, { useState, useEffect } from 'react';
import { X, Loader2, Database } from 'lucide-react';
import { api } from '../api/ipc';
import {
  ConnectionConfig,
  DatabaseType,
  getDefaultPort,
} from '../types/database';
import { ConnectionFormFields } from './ConnectionFormFields';

/**
 * @brief Properties accepted by the ConnectionModal component.
 */
export interface ConnectionModalProps {
  /** @brief Controls visibility of the modal dialog. */
  isOpen: boolean;
  /** @brief Callback triggered to dismiss the modal dialog. */
  onClose: () => void;
  /** @brief Callback triggered when user submits a valid connection configuration. */
  onConnect: (config: ConnectionConfig) => Promise<void> | void;
  /** @brief Optional initial configuration for editing an existing connection profile. */
  initialConfig?: ConnectionConfig | null;
}

/**
 * @brief TablePlus-themed modal dialog for creating and editing database connection parameters.
 * @param props Component properties configuring modal lifecycle and submission callbacks.
 * @return Rendered modal dialog element or null if closed.
 */
export const ConnectionModal: React.FC<ConnectionModalProps> = ({
  isOpen,
  onClose,
  onConnect,
  initialConfig,
}) => {
  const [name, setName] = useState('');
  const [dbType, setDbType] = useState<DatabaseType>('Postgres');
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState<number>(5432);
  const [database, setDatabase] = useState('');
  const [username, setUsername] = useState('postgres');
  const [password, setPassword] = useState('');
  const [filePath, setFilePath] = useState('');
  const [ssl, setSsl] = useState(false);

  // Status feedback states
  const [isTesting, setIsTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [validationError, setValidationError] = useState('');

  // Sync state whenever modal opens or initialConfig changes
  useEffect(() => {
    if (initialConfig) {
      setName(initialConfig.name);
      setDbType(initialConfig.db_type);
      setHost(initialConfig.host || '127.0.0.1');
      setPort(initialConfig.port || getDefaultPort(initialConfig.db_type));
      setDatabase(initialConfig.database || '');
      setUsername(initialConfig.username || '');
      setPassword(initialConfig.password || '');
      setFilePath(initialConfig.file_path || '');
      setSsl(initialConfig.ssl || false);
    } else {
      setName('Local Postgres');
      setDbType('Postgres');
      setHost('127.0.0.1');
      setPort(5432);
      setDatabase('');
      setUsername('postgres');
      setPassword('');
      setFilePath('');
      setSsl(false);
    }
    setTestStatus('idle');
    setTestMessage('');
    setValidationError('');
  }, [isOpen, initialConfig]);

  if (!isOpen) return null;

  /**
   * @brief Handles switching the database engine and automatically adjusts default port.
   * @param newType Target database engine type.
   */
  const handleEngineChange = (newType: DatabaseType) => {
    setDbType(newType);
    setTestStatus('idle');
    setTestMessage('');
    setValidationError('');

    const defaultP = getDefaultPort(newType);
    if (defaultP > 0) {
      setPort(defaultP);
    }

    if (newType === 'Sqlite') {
      if (!name || name.startsWith('Local ')) setName('Local SQLite');
      if (!database) setDatabase('dyno_dev.db');
      if (!filePath) setFilePath('dyno_dev.db');
    } else if (newType === 'Postgres') {
      if (!name || name.startsWith('Local ')) setName('Local Postgres');
      if (!username) setUsername('postgres');
    } else if (newType === 'MySql') {
      if (!name || name.startsWith('Local ')) setName('Local MySQL');
      if (!username) setUsername('root');
    } else if (newType === 'Mssql') {
      if (!name || name.startsWith('Local ')) setName('Local SQL Server');
      if (!username) setUsername('sa');
    }
  };

  /**
   * @brief Constructs a ConnectionConfig object from current form state.
   * @return ConnectionConfig object.
   */
  const buildConfig = (): ConnectionConfig => {
    const id = initialConfig?.id || `conn-${Date.now()}`;
    return {
      id,
      name: name.trim() || `${dbType} Connection`,
      db_type: dbType,
      host: dbType !== 'Sqlite' ? host.trim() : undefined,
      port: dbType !== 'Sqlite' ? Number(port) : undefined,
      database: dbType === 'Sqlite' ? (filePath.trim() || database.trim() || ':memory:') : database.trim(),
      username: dbType !== 'Sqlite' && username.trim() ? username.trim() : undefined,
      password: dbType !== 'Sqlite' && password ? password : undefined,
      file_path: dbType === 'Sqlite' ? (filePath.trim() || database.trim() || ':memory:') : undefined,
      ssl,
    };
  };

  /**
   * @brief Executes transient connectivity test through Tauri IPC backend.
   */
  const handleTestConnection = async () => {
    setValidationError('');
    setTestStatus('idle');
    setTestMessage('');
    setIsTesting(true);

    try {
      const config = buildConfig();
      const ok = await api.testConnection(config);
      if (ok) {
        setTestStatus('success');
        setTestMessage('Connection established successfully!');
      } else {
        setTestStatus('error');
        setTestMessage('Connection test returned false.');
      }
    } catch (err: unknown) {
      setTestStatus('error');
      setTestMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTesting(false);
    }
  };

  /**
   * @brief Validates input parameters and triggers onConnect callback.
   * @param e Form submission event.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError('');

    if (!name.trim()) {
      setValidationError('Connection name is required.');
      return;
    }

    if (dbType !== 'Sqlite' && !database.trim()) {
      setValidationError('Database name is required.');
      return;
    }

    if (dbType === 'Sqlite' && !filePath.trim() && !database.trim()) {
      setValidationError('Database path or :memory: is required for SQLite.');
      return;
    }

    setIsConnecting(true);
    try {
      const config = buildConfig();
      await onConnect(config);
      onClose();
    } catch (err: unknown) {
      setTestStatus('error');
      setTestMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="connection-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
    >
      <div className="w-full max-w-lg bg-[#1e1f22] border border-[#35373c] rounded-lg shadow-2xl overflow-hidden flex flex-col text-xs text-[#e6e8ea]">
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-[#35373c] flex items-center justify-between bg-[#18191c]">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-[#3a82f7]" />
            <h2 id="connection-modal-title" className="font-semibold text-sm text-[#e6e8ea]">
              {initialConfig ? 'Edit Connection' : 'New Database Connection'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1 text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#26282d] rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body / Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <ConnectionFormFields
            name={name}
            setName={setName}
            dbType={dbType}
            onEngineChange={handleEngineChange}
            host={host}
            setHost={setHost}
            port={port}
            setPort={setPort}
            database={database}
            setDatabase={setDatabase}
            username={username}
            setUsername={setUsername}
            password={password}
            setPassword={setPassword}
            filePath={filePath}
            setFilePath={setFilePath}
            ssl={ssl}
            setSsl={setSsl}
            validationError={validationError}
            testStatus={testStatus}
            testMessage={testMessage}
          />

          {/* Modal Footer / Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-[#35373c]">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting || isConnecting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#26282d] hover:bg-[#35373c] disabled:opacity-50 text-[#e6e8ea] rounded border border-[#35373c] transition-colors"
            >
              {isTesting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#3a82f7]" />
                  <span>Testing...</span>
                </>
              ) : (
                <span>Test Connection</span>
              )}
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isConnecting}
                className="px-3 py-1.5 text-[#8c919a] hover:text-[#e6e8ea] rounded hover:bg-[#26282d] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isConnecting}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-[#3a82f7] hover:bg-[#2f6fd6] disabled:opacity-50 text-white font-medium rounded shadow transition-colors"
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Connecting...</span>
                  </>
                ) : (
                  <span>Connect</span>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
