/**
 * @file ConnectionModal.tsx
 * @brief Modern dark-styled modal dialog for configuring and testing database connections.
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
  onConnect: (config: ConnectionConfig) => Promise<boolean> | void;
  /** @brief Optional initial configuration for editing an existing connection profile. */
  initialConfig?: ConnectionConfig | null;
}

/**
 * @brief Formats arbitrary error payloads from Tauri IPC or JS runtime into human-readable strings.
 * @param err Caught error object, string, or Serde enum structure.
 * @return Human-readable error description string.
 */
export function formatErrorMessage(err: unknown): string {
  if (!err) return 'Unknown error occurred.';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if ('message' in obj && typeof obj.message === 'string') {
      return obj.message;
    }
    const values = Object.values(obj);
    if (values.length === 1 && typeof values[0] === 'string') {
      const key = Object.keys(obj)[0];
      return `${key}: ${values[0]}`;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * @brief Modern dark-themed modal dialog for creating and editing database connection parameters.
 * @param props Component properties configuring modal lifecycle and submission callbacks.
 * @return Rendered modal dialog element or null if closed.
 */
export const ConnectionModal: React.FC<ConnectionModalProps> = React.memo(({

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
  const [sshEnabled, setSshEnabled] = useState(false);
  const [sshHost, setSshHost] = useState('');
  const [sshPort, setSshPort] = useState(22);
  const [sshUsername, setSshUsername] = useState('');
  const [sshAuthType, setSshAuthType] = useState<'Password' | 'PrivateKey'>('Password');
  const [sshPassword, setSshPassword] = useState('');
  const [sshKeyPath, setSshKeyPath] = useState('');
  // Credentials are stored in the operating system secret store, never in browser storage.
  const [rememberPassword, setRememberPassword] = useState(true);
  // Whether the secret store already holds credentials for the profile being edited.
  const [hasStoredSecret, setHasStoredSecret] = useState(false);

  // Status feedback states
  const [isTesting, setIsTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [availableDatabases, setAvailableDatabases] = useState<string[]>([]);
  const [isFetchingDatabases, setIsFetchingDatabases] = useState(false);

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
      if (initialConfig.ssh_tunnel) {
        setSshEnabled(initialConfig.ssh_tunnel.enabled);
        setSshHost(initialConfig.ssh_tunnel.host || '');
        setSshPort(initialConfig.ssh_tunnel.port || 22);
        setSshUsername(initialConfig.ssh_tunnel.username || '');
        setSshAuthType(
          initialConfig.ssh_tunnel.auth_type === 'PrivateKey' ? 'PrivateKey' : 'Password'
        );
        setSshPassword(initialConfig.ssh_tunnel.password || '');
        setSshKeyPath(initialConfig.ssh_tunnel.private_key_path || '');
      } else {
        setSshEnabled(false);
        setSshHost('');
        setSshPort(22);
        setSshUsername('');
        setSshAuthType('Password');
        setSshPassword('');
        setSshKeyPath('');
      }
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
      setSshEnabled(false);
      setSshHost('');
      setSshPort(22);
      setSshUsername('');
      setSshAuthType('Password');
      setSshPassword('');
      setSshKeyPath('');
    }
    setTestStatus('idle');
    setTestMessage('');
    setValidationError('');
    setAvailableDatabases([]);
    setRememberPassword(true);
  }, [isOpen, initialConfig]);

  // Report whether credentials are already held for this profile, so the user knows an empty
  // password field means "keep the stored one" rather than "no password".
  useEffect(() => {
    if (!isOpen || !initialConfig) {
      setHasStoredSecret(false);
      return;
    }

    let cancelled = false;
    api
      .hasConnectionSecrets(initialConfig.id)
      .then((present) => {
        if (!cancelled) setHasStoredSecret(present);
      })
      .catch(() => {
        if (!cancelled) setHasStoredSecret(false);
      });

    return () => {
      cancelled = true;
    };
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
    setAvailableDatabases([]);

    const defaultP = getDefaultPort(newType);
    if (defaultP > 0) {
      setPort(defaultP);
    }

    if (newType === 'Sqlite') {
      if (!name || name.startsWith('Local ')) setName('Local SQLite');
      if (!database) setDatabase('dyno_dev.db');
      if (!filePath) setFilePath('dyno_dev.db');
    } else if (newType === 'DuckDb') {
      if (!name || name.startsWith('Local ')) setName('Local DuckDB');
      if (!database) setDatabase('dyno_analytics.duckdb');
      if (!filePath) setFilePath('dyno_analytics.duckdb');
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
    const isEmbedded = dbType === 'Sqlite' || dbType === 'DuckDb';
    let targetDb = database.trim();
    if (!isEmbedded && !targetDb) {
      targetDb = dbType === 'Postgres' ? 'postgres' : dbType === 'Mssql' ? 'master' : 'mysql';
    }

    return {
      id,
      name: name.trim() || `${dbType} Connection`,
      db_type: dbType,
      host: !isEmbedded ? host.trim() : undefined,
      port: !isEmbedded ? Number(port) : undefined,
      database: isEmbedded ? (filePath.trim() || database.trim() || ':memory:') : targetDb,
      username: !isEmbedded && username.trim() ? username.trim() : undefined,
      password: !isEmbedded && password ? password : undefined,
      file_path: isEmbedded ? (filePath.trim() || database.trim() || ':memory:') : undefined,
      ssl: !isEmbedded ? ssl : false,
      ssh_tunnel:
        !isEmbedded && sshEnabled && sshHost.trim()
          ? {
              enabled: true,
              host: sshHost.trim(),
              port: Number(sshPort) || 22,
              username: sshUsername.trim(),
              auth_type: sshAuthType,
              password: sshAuthType === 'Password' ? sshPassword : undefined,
              private_key_path: sshAuthType === 'PrivateKey' ? sshKeyPath.trim() : undefined,
            }
          : undefined,
    };
  };

  /**
   * @brief Discovers available databases on remote database server using maintenance database.
   */
  const handleFetchDatabases = async () => {
    setIsFetchingDatabases(true);
    setValidationError('');
    setTestStatus('idle');
    setTestMessage('');

    try {
      const config = buildConfig();
      const dbs = await api.listDatabases(config);
      setAvailableDatabases(dbs);
      if (dbs.length > 0 && !database.trim()) {
        const preferred = dbs.find(
          (d) => !['postgres', 'mysql', 'master', 'template0', 'template1'].includes(d)
        );
        if (preferred) {
          setDatabase(preferred);
        }
      }
    } catch (err: unknown) {
      setTestStatus('error');
      setTestMessage(formatErrorMessage(err));
    } finally {
      setIsFetchingDatabases(false);
    }
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
      setTestMessage(formatErrorMessage(err));
    } finally {
      setIsTesting(false);
    }
  };

  /**
   * @brief Stores or clears this profile's credentials in the OS secret store.
   * @details Secrets are written through IPC and can never be read back by the frontend. Leaving the
   * password field empty keeps whatever is already stored: the modal cannot display an existing
   * credential, so an empty field must not be read as "delete it".
   * @param config Connection profile whose id keys the stored entry.
   * @return Error message when the secret store refused the write, otherwise null.
   */
  const persistSecrets = async (config: ConnectionConfig): Promise<string | null> => {
    try {
      if (!rememberPassword) {
        await api.deleteConnectionSecrets(config.id);
        return null;
      }

      const sshPasswordToStore =
        config.ssh_tunnel?.auth_type === 'Password' ? sshPassword : undefined;

      if (!password && !sshPasswordToStore) {
        // Nothing new was typed; keep any credential already held for this profile.
        return null;
      }

      await api.saveConnectionSecrets(
        config.id,
        password || undefined,
        sshPasswordToStore || undefined,
        undefined
      );
      return null;
    } catch (err: unknown) {
      return formatErrorMessage(err);
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

    const isEmbedded = dbType === 'Sqlite' || dbType === 'DuckDb';
    if (isEmbedded && !filePath.trim() && !database.trim()) {
      setValidationError(
        `Database path or :memory: is required for ${dbType === 'DuckDb' ? 'DuckDB' : 'SQLite'}.`
      );
      return;
    }

    setIsConnecting(true);
    try {
      const config = buildConfig();

      const secretError = await persistSecrets(config);
      if (secretError) {
        setTestStatus('error');
        setTestMessage(
          `Could not store credentials in the system secret store (${secretError}). The password will only be used for this session.`
        );
      }

      const connected = await onConnect(config);
      if (connected !== false) {
        onClose();
      }
    } catch (err: unknown) {
      setTestStatus('error');
      setTestMessage(formatErrorMessage(err));
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
            rememberPassword={rememberPassword}
            setRememberPassword={setRememberPassword}
            hasStoredSecret={hasStoredSecret}
            sshEnabled={sshEnabled}
            setSshEnabled={setSshEnabled}
            sshHost={sshHost}
            setSshHost={setSshHost}
            sshPort={sshPort}
            setSshPort={setSshPort}
            sshUsername={sshUsername}
            setSshUsername={setSshUsername}
            sshAuthType={sshAuthType}
            setSshAuthType={setSshAuthType}
            sshPassword={sshPassword}
            setSshPassword={setSshPassword}
            sshKeyPath={sshKeyPath}
            setSshKeyPath={setSshKeyPath}
            validationError={validationError}
            testStatus={testStatus}
            testMessage={testMessage}
            onFetchDatabases={handleFetchDatabases}
            isFetchingDatabases={isFetchingDatabases}
            availableDatabases={availableDatabases}
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
});
ConnectionModal.displayName = 'ConnectionModal';
