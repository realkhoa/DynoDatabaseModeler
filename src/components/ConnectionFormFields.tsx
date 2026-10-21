/**
 * @file ConnectionFormFields.tsx
 * @brief Subcomponent rendering input fields and status banners for database connections.
 * @details Separates connection form controls from modal dialog presentation logic, supporting
 * PostgreSQL, MySQL, MariaDB, SQL Server, SQLite, CockroachDB, ClickHouse, Redshift, LibSQL, DuckDB,
 * and Universal / Any SQL database engines.
 */

import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Shield,
  Terminal,
  RefreshCw,
  Loader2,
  Globe,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { DatabaseType } from '../types/database';
import { isEmbeddedEngine, isUniversalEngine } from '../types/database';

/**
 * @brief Properties accepted by ConnectionFormFields.
 */
export interface ConnectionFormFieldsProps {
  /** @brief Connection profile name. */
  name: string;
  /** @brief State setter for connection profile name. */
  setName: (val: string) => void;
  /** @brief Selected database engine. */
  dbType: DatabaseType;
  /** @brief Handler for changing database engine. */
  onEngineChange: (type: DatabaseType) => void;
  /** @brief Host address for network databases. */
  host: string;
  /** @brief State setter for host. */
  setHost: (val: string) => void;
  /** @brief Network port number. */
  port: number;
  /** @brief State setter for port number. */
  setPort: (val: number) => void;
  /** @brief Target database catalog name. */
  database: string;
  /** @brief State setter for database catalog name. */
  setDatabase: (val: string) => void;
  /** @brief Authentication username. */
  username: string;
  /** @brief State setter for username. */
  setUsername: (val: string) => void;
  /** @brief Authentication password. */
  password: string;
  /** @brief State setter for password. */
  setPassword: (val: string) => void;
  /** @brief SQLite / LibSQL / DuckDB database file path. */
  filePath: string;
  /** @brief State setter for file path. */
  setFilePath: (val: string) => void;
  /** @brief SSL encryption flag. */
  ssl: boolean;
  /** @brief State setter for SSL encryption flag. */
  setSsl: (val: boolean) => void;
  /** @brief Whether the password should be stored in the operating system secret store. */
  rememberPassword: boolean;
  /** @brief State setter for the remember-password preference. */
  setRememberPassword: (val: boolean) => void;
  /** @brief Whether a credential is already held for the profile being edited. */
  hasStoredSecret?: boolean;
  /** @brief Whether SSH bastion tunnel is enabled. */
  sshEnabled: boolean;
  /** @brief State setter for SSH tunnel enabled flag. */
  setSshEnabled: (val: boolean) => void;
  /** @brief SSH bastion host. */
  sshHost: string;
  /** @brief State setter for SSH host. */
  setSshHost: (val: string) => void;
  /** @brief SSH bastion port. */
  sshPort: number;
  /** @brief State setter for SSH port. */
  setSshPort: (val: number) => void;
  /** @brief SSH username. */
  sshUsername: string;
  /** @brief State setter for SSH username. */
  setSshUsername: (val: string) => void;
  /** @brief SSH auth method. */
  sshAuthType: 'Password' | 'PrivateKey';
  /** @brief State setter for SSH auth method. */
  setSshAuthType: (val: 'Password' | 'PrivateKey') => void;
  /** @brief SSH password. */
  sshPassword: string;
  /** @brief State setter for SSH password. */
  setSshPassword: (val: string) => void;
  /** @brief SSH private key path. */
  sshKeyPath: string;
  /** @brief State setter for SSH private key path. */
  setSshKeyPath: (val: string) => void;
  /** @brief Raw connection string or database URL for Universal mode. */
  connectionUrl?: string;
  /** @brief State setter for connection URL. */
  setConnectionUrl?: (val: string) => void;
  /** @brief Explicit dialect family for Universal mode. */
  dialectFamily?: string;
  /** @brief State setter for dialect family. */
  setDialectFamily?: (val: string) => void;
  /** @brief Validation error message, if any. */
  validationError: string;
  /** @brief Status of connectivity test. */
  testStatus: 'idle' | 'success' | 'error';
  /** @brief Connectivity test message. */
  testMessage: string;
  /** @brief Optional callback to discover available databases on remote server. */
  onFetchDatabases?: () => void;
  /** @brief Flag indicating active discovery query on remote server. */
  isFetchingDatabases?: boolean;
  /** @brief Discovered list of database names available on remote server. */
  availableDatabases?: string[];
}

const ENGINE_GROUPS: {
  category: string;
  engines: { type: DatabaseType; label: string; badge?: string }[];
}[] = [
  {
    category: 'Popular',
    engines: [
      { type: 'Postgres', label: 'PostgreSQL' },
      { type: 'MySql', label: 'MySQL' },
      { type: 'MariaDb', label: 'MariaDB' },
      { type: 'Mssql', label: 'SQL Server' },
      { type: 'Sqlite', label: 'SQLite' },
    ],
  },
  {
    category: 'Cloud & Analytics',
    engines: [
      { type: 'CockroachDb', label: 'CockroachDB', badge: 'Cloud' },
      { type: 'ClickHouse', label: 'ClickHouse', badge: 'Analytics' },
      { type: 'Redshift', label: 'Redshift', badge: 'AWS' },
      { type: 'LibSql', label: 'LibSQL', badge: 'Edge' },
      { type: 'DuckDb', label: 'DuckDB', badge: 'Analytics' },
    ],
  },
  {
    category: 'NoSQL & Cache',
    engines: [
      { type: 'Redis', label: 'Redis / KeyDB / Valkey', badge: 'Cache/KV' },
    ],
  },
  {
    category: 'Universal / Any Database',
    engines: [
      { type: 'Universal', label: '⚡ Universal / Any SQL', badge: 'URL & Dialect' },
    ],
  },
];

/**
 * @brief Renders the database configuration form fields and feedback banners.
 * @param props Input values, state setters, and status feedback flags.
 * @return Rendered form controls.
 */
export const ConnectionFormFields: React.FC<ConnectionFormFieldsProps> = ({
  name,
  setName,
  dbType,
  onEngineChange,
  host,
  setHost,
  port,
  setPort,
  database,
  setDatabase,
  username,
  setUsername,
  password,
  setPassword,
  filePath,
  setFilePath,
  ssl,
  setSsl,
  rememberPassword,
  setRememberPassword,
  hasStoredSecret = false,
  onFetchDatabases,
  isFetchingDatabases = false,
  availableDatabases = [],
  sshEnabled,
  setSshEnabled,
  sshHost,
  setSshHost,
  sshPort,
  setSshPort,
  sshUsername,
  setSshUsername,
  sshAuthType,
  setSshAuthType,
  sshPassword,
  setSshPassword,
  sshKeyPath,
  setSshKeyPath,
  connectionUrl = '',
  setConnectionUrl,
  dialectFamily = 'postgres',
  setDialectFamily,
  validationError,
  testStatus,
  testMessage,
}) => {
  const [showAdvancedDirectParams, setShowAdvancedDirectParams] = useState(false);
  const isEmbedded = isEmbeddedEngine(dbType);
  const isUniversal = isUniversalEngine(dbType);

  return (
    <div className="space-y-4">
      {/* Categorized Engine Selector */}
      <div className="space-y-2">
        <label className="block text-[11px] font-semibold text-[#8c919a] uppercase tracking-wider">
          Database Engine
        </label>
        <div className="space-y-2 bg-[#18191c] p-2 rounded-lg border border-[#35373c]">
          {ENGINE_GROUPS.map((group) => (
            <div key={group.category} className="space-y-1">
              <span className="text-[10px] uppercase font-bold text-[#8c919a]/70 tracking-wider px-1">
                {group.category}
              </span>
              <div
                className={`grid gap-1.5 ${
                  group.engines.length === 1
                    ? 'grid-cols-1'
                    : group.engines.length <= 5
                    ? 'grid-cols-5'
                    : 'grid-cols-3'
                }`}
              >
                {group.engines.map(({ type, label, badge }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => onEngineChange(type)}
                    className={`py-1.5 px-2 rounded text-center text-xs font-medium transition-colors flex items-center justify-center gap-1.5 relative ${
                      dbType === type
                        ? 'bg-[#3a82f7] text-white shadow-sm ring-1 ring-[#5a9cff]'
                        : 'bg-[#222429] text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#2c2e34]'
                    }`}
                  >
                    <span>{label}</span>
                    {badge && (
                      <span
                        className={`text-[9px] px-1 py-0.2 rounded font-normal ${
                          dbType === type
                            ? 'bg-black/20 text-white'
                            : 'bg-[#35373c] text-[#8c919a]'
                        }`}
                      >
                        {badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Connection Name */}
      <div>
        <label
          htmlFor="conn-name"
          className="block text-[11px] font-semibold text-[#8c919a] uppercase tracking-wider mb-1"
        >
          Connection Name
        </label>
        <input
          id="conn-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Production PostgreSQL"
          className="w-full bg-[#18191c] border border-[#35373c] rounded px-3 py-1.5 text-[#e6e8ea] focus:outline-none focus:border-[#3a82f7]"
        />
      </div>

      {/* Universal Connection Mode */}
      {isUniversal && (
        <div className="space-y-3 p-3 bg-[#18191c] border border-[#3a82f7]/40 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-[#3a82f7]" />
              <span className="text-xs font-semibold text-[#e6e8ea]">Universal / Any SQL Database</span>
            </div>
            <span className="text-[10px] bg-[#3a82f7]/20 text-[#3a82f7] px-2 py-0.5 rounded font-medium">
              URL & Dialect
            </span>
          </div>

          <div>
            <label
              htmlFor="conn-url"
              className="block text-[11px] font-semibold text-[#8c919a] uppercase tracking-wider mb-1"
            >
              Connection URL / String
            </label>
            <textarea
              id="conn-url"
              data-testid="universal-connection-url"
              rows={2}
              value={connectionUrl}
              onChange={(e) => setConnectionUrl?.(e.target.value)}
              placeholder="postgresql://user:password@hostname:5432/dbname?sslmode=require"
              className="w-full bg-[#141517] border border-[#35373c] rounded px-3 py-1.5 font-mono text-xs text-[#e6e8ea] focus:outline-none focus:border-[#3a82f7]"
            />
            {/* Quick Presets */}
            <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] items-center">
              <span className="text-[#8c919a] mr-1">Presets:</span>
              {[
                { label: 'Postgres', url: 'postgresql://postgres:secret@localhost:5432/postgres', dialect: 'postgres' },
                { label: 'MySQL', url: 'mysql://root:secret@localhost:3306/mysql', dialect: 'mysql' },
                { label: 'Redis', url: 'redis://:secret@localhost:6379/0', dialect: 'redis' },
                { label: 'SQLite', url: 'sqlite:app.db', dialect: 'sqlite' },
                { label: 'DuckDB', url: 'duckdb:analytics.duckdb', dialect: 'duckdb' },
                { label: 'SQL Server', url: 'sqlserver://sa:secret@localhost:1433/master', dialect: 'mssql' },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setConnectionUrl?.(p.url);
                    setDialectFamily?.(p.dialect);
                  }}
                  className="px-1.5 py-0.5 rounded bg-[#26282d] hover:bg-[#35373c] text-[#8c919a] hover:text-[#e6e8ea] transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dialect Family Selector */}
          <div>
            <label
              htmlFor="conn-dialect"
              className="block text-[11px] font-semibold text-[#8c919a] uppercase tracking-wider mb-1"
            >
              Dialect Family
            </label>
            <select
              id="conn-dialect"
              data-testid="universal-dialect-family"
              value={dialectFamily}
              onChange={(e) => setDialectFamily?.(e.target.value)}
              className="w-full bg-[#141517] border border-[#35373c] rounded px-3 py-1.5 text-xs text-[#e6e8ea] focus:outline-none focus:border-[#3a82f7]"
            >
              <option value="postgres">PostgreSQL-compatible (CockroachDB, Redshift, Timescale, Supabase, Neon)</option>
              <option value="mysql">MySQL-compatible (MariaDB, ClickHouse, TiDB, SingleStore)</option>
              <option value="redis">Redis-compatible (Redis, KeyDB, Dragonfly, Valkey)</option>
              <option value="sqlite">SQLite-compatible (LibSQL, Turso, Cloudflare D1)</option>
              <option value="mssql">MSSQL-compatible (SQL Server, Azure SQL)</option>
              <option value="duckdb">DuckDB-compatible (MotherDuck, local files)</option>
              <option value="ansi">Generic ANSI SQL</option>
            </select>
          </div>

          {/* Collapsible toggle for direct host/port override */}
          <button
            type="button"
            onClick={() => setShowAdvancedDirectParams((prev) => !prev)}
            className="text-[11px] text-[#3a82f7] hover:underline flex items-center gap-1 cursor-pointer pt-1"
          >
            {showAdvancedDirectParams ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span>{showAdvancedDirectParams ? 'Hide direct parameters' : 'Or configure via host, port & credentials'}</span>
          </button>
        </div>
      )}

      {/* Embedded File Path Inputs (SQLite / DuckDB / LibSQL) */}
      {isEmbedded && (
        <div>
          <label
            htmlFor="conn-file-path"
            className="block text-[11px] font-semibold text-[#8c919a] uppercase tracking-wider mb-1"
          >
            Database File Path or :memory:
          </label>
          <input
            id="conn-file-path"
            type="text"
            value={filePath}
            onChange={(e) => {
              setFilePath(e.target.value);
              setDatabase(e.target.value);
            }}
            placeholder={
              dbType === 'DuckDb'
                ? '/path/to/analytics.duckdb or :memory:'
                : dbType === 'LibSql'
                ? '/path/to/replica.db or :memory:'
                : '/path/to/database.db or :memory:'
            }
            className="w-full bg-[#18191c] border border-[#35373c] rounded px-3 py-1.5 font-mono text-[#e6e8ea] focus:outline-none focus:border-[#3a82f7]"
          />
          <p className="mt-1 text-[11px] text-[#8c919a]">
            Use <code className="text-[#3a82f7]">:memory:</code> for an isolated in-memory{' '}
            {dbType === 'DuckDb' ? 'DuckDB' : dbType === 'LibSql' ? 'LibSQL' : 'SQLite'} database.
          </p>
        </div>
      )}

      {/* Remote Network Database Fields */}
      {(!isEmbedded || (isUniversal && showAdvancedDirectParams)) && !(!isUniversal && isEmbedded) && (
        <>
          {/* Host and Port */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label
                htmlFor="conn-host"
                className="block text-[11px] font-semibold text-[#8c919a] uppercase tracking-wider mb-1"
              >
                Host
              </label>
              <input
                id="conn-host"
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="localhost or 127.0.0.1"
                className="w-full bg-[#18191c] border border-[#35373c] rounded px-3 py-1.5 text-[#e6e8ea] focus:outline-none focus:border-[#3a82f7]"
              />
            </div>
            <div>
              <label
                htmlFor="conn-port"
                className="block text-[11px] font-semibold text-[#8c919a] uppercase tracking-wider mb-1"
              >
                Port
              </label>
              <input
                id="conn-port"
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="w-full bg-[#18191c] border border-[#35373c] rounded px-3 py-1.5 font-mono text-[#e6e8ea] focus:outline-none focus:border-[#3a82f7]"
              />
            </div>
          </div>

          {/* Database Name */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="conn-database"
                className="block text-[11px] font-semibold text-[#8c919a] uppercase tracking-wider"
              >
                {dbType === 'Redis' ? 'Database Index' : 'Database'}{' '}
                <span className="text-[10px] font-normal lowercase text-[#8c919a]/70">
                  {dbType === 'Redis' ? '(e.g. 0-15 · defaults to 0)' : '(optional · defaults to maintenance db)'}
                </span>
              </label>
              {onFetchDatabases && (
                <button
                  type="button"
                  onClick={onFetchDatabases}
                  disabled={isFetchingDatabases}
                  className="text-[11px] text-[#3a82f7] hover:text-[#5a9cff] hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  title="Discover databases on this server"
                >
                  {isFetchingDatabases ? (
                    <Loader2 className="w-3 h-3 animate-spin text-[#3a82f7]" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  <span>{isFetchingDatabases ? 'Fetching...' : 'Fetch Databases'}</span>
                </button>
              )}
            </div>
            <input
              id="conn-database"
              type="text"
              list="conn-available-databases"
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
              placeholder={
                dbType === 'Redis'
                  ? '0 (Database index 0-15)'
                  : dbType === 'Postgres' || dbType === 'CockroachDb' || dbType === 'Redshift'
                  ? 'postgres (default if blank)'
                  : dbType === 'Mssql'
                  ? 'master (default if blank)'
                  : dbType === 'MySql' || dbType === 'MariaDb'
                  ? 'mysql (optional)'
                  : dbType === 'ClickHouse'
                  ? 'default'
                  : 'Database name'
              }
              className="w-full bg-[#18191c] border border-[#35373c] rounded px-3 py-1.5 text-[#e6e8ea] focus:outline-none focus:border-[#3a82f7]"
            />
            {availableDatabases.length > 0 && (
              <datalist id="conn-available-databases">
                {availableDatabases.map((db) => (
                  <option key={db} value={db} />
                ))}
              </datalist>
            )}

            {/* Discovered database quick select badges */}
            {availableDatabases.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                <span className="text-[10px] text-[#8c919a] mr-1">Found ({availableDatabases.length}):</span>
                {availableDatabases.map((db) => {
                  const isSelected = database.trim() === db;
                  return (
                    <button
                      key={db}
                      type="button"
                      onClick={() => setDatabase(db)}
                      className={`text-[10px] px-1.5 py-0.5 rounded cursor-pointer transition-colors border ${
                        isSelected
                          ? 'bg-[#3a82f7]/20 border-[#3a82f7] text-[#3a82f7] font-medium'
                          : 'bg-[#26282d] border-[#35373c] text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#35373c]'
                      }`}
                    >
                      {db}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Username and Password */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="conn-username"
                className="block text-[11px] font-semibold text-[#8c919a] uppercase tracking-wider mb-1"
              >
                User
              </label>
              <input
                id="conn-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                className="w-full bg-[#18191c] border border-[#35373c] rounded px-3 py-1.5 text-[#e6e8ea] focus:outline-none focus:border-[#3a82f7]"
              />
            </div>
            <div>
              <label
                htmlFor="conn-password"
                className="block text-[11px] font-semibold text-[#8c919a] uppercase tracking-wider mb-1"
              >
                Password
              </label>
              <input
                id="conn-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                className="w-full bg-[#18191c] border border-[#35373c] rounded px-3 py-1.5 text-[#e6e8ea] focus:outline-none focus:border-[#3a82f7]"
              />
              <p className="mt-1 text-[10px] text-[#8c919a]">
                {hasStoredSecret
                  ? 'A password is already stored for this profile. Leave this field empty to keep it.'
                  : 'Passwords are kept in the operating system credential store and are never written to browser storage.'}
              </p>
            </div>
          </div>

          {/* SSL and Credentials Options */}
          <div className="space-y-2 pt-1 border-t border-[#2c2e33]">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-[#e6e8ea]">
                <input
                  type="checkbox"
                  checked={rememberPassword}
                  onChange={(e) => setRememberPassword(e.target.checked)}
                  className="rounded bg-[#18191c] border-[#35373c] text-[#3a82f7] focus:ring-0 focus:ring-offset-0"
                />
                <span className="font-medium">Remember password securely</span>
              </label>
              <div
                className="flex items-center gap-1 text-[11px] text-[#8c919a]"
                title="Uses native OS keychain (Windows Credential Manager, macOS Keychain, Linux Secret Service)"
              >
                <Shield className="w-3.5 h-3.5 text-[#3a82f7]" />
                <span>OS Keychain</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-[#e6e8ea]">
                <input
                  type="checkbox"
                  checked={ssl}
                  onChange={(e) => setSsl(e.target.checked)}
                  className="rounded bg-[#18191c] border-[#35373c] text-[#3a82f7] focus:ring-0 focus:ring-offset-0"
                />
                <span className="font-medium">Require SSL/TLS encryption</span>
              </label>
            </div>
          </div>

          {/* SSH Bastion Tunnel Options */}
          <div className="pt-2 border-t border-[#2c2e33]">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-[#e6e8ea]">
                <input
                  type="checkbox"
                  data-testid="ssh-tunnel-enable"
                  checked={sshEnabled}
                  onChange={(e) => setSshEnabled(e.target.checked)}
                  className="rounded bg-[#18191c] border-[#35373c] text-[#3a82f7] focus:ring-0 focus:ring-offset-0"
                />
                <span className="font-medium">Use SSH Bastion Tunnel</span>
              </label>
              <div className="flex items-center gap-1 text-[11px] text-[#8c919a]">
                <Terminal className="w-3.5 h-3.5 text-[#3a82f7]" />
                <span>Port Forwarding</span>
              </div>
            </div>

            {sshEnabled && (
              <div className="mt-3 p-3 bg-[#141517] border border-[#2c2e33] rounded space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label
                      htmlFor="ssh-host"
                      className="block text-[10px] font-semibold text-[#8c919a] uppercase tracking-wider mb-1"
                    >
                      SSH Host
                    </label>
                    <input
                      id="ssh-host"
                      data-testid="ssh-tunnel-host"
                      type="text"
                      value={sshHost}
                      onChange={(e) => setSshHost(e.target.value)}
                      placeholder="bastion.example.com"
                      className="w-full bg-[#18191c] border border-[#35373c] rounded px-2.5 py-1 text-xs text-[#e6e8ea] focus:outline-none focus:border-[#3a82f7]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="ssh-port"
                      className="block text-[10px] font-semibold text-[#8c919a] uppercase tracking-wider mb-1"
                    >
                      SSH Port
                    </label>
                    <input
                      id="ssh-port"
                      data-testid="ssh-tunnel-port"
                      type="number"
                      value={sshPort}
                      onChange={(e) => setSshPort(Number(e.target.value))}
                      className="w-full bg-[#18191c] border border-[#35373c] rounded px-2.5 py-1 text-xs text-[#e6e8ea] focus:outline-none focus:border-[#3a82f7]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="ssh-username"
                      className="block text-[10px] font-semibold text-[#8c919a] uppercase tracking-wider mb-1"
                    >
                      SSH User
                    </label>
                    <input
                      id="ssh-username"
                      data-testid="ssh-tunnel-user"
                      type="text"
                      value={sshUsername}
                      onChange={(e) => setSshUsername(e.target.value)}
                      placeholder="ubuntu / root"
                      className="w-full bg-[#18191c] border border-[#35373c] rounded px-2.5 py-1 text-xs text-[#e6e8ea] focus:outline-none focus:border-[#3a82f7]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="ssh-auth-type"
                      className="block text-[10px] font-semibold text-[#8c919a] uppercase tracking-wider mb-1"
                    >
                      Auth Method
                    </label>
                    <select
                      id="ssh-auth-type"
                      data-testid="ssh-tunnel-auth"
                      value={sshAuthType}
                      onChange={(e) => setSshAuthType(e.target.value as 'Password' | 'PrivateKey')}
                      className="w-full bg-[#18191c] border border-[#35373c] rounded px-2.5 py-1 text-xs text-[#e6e8ea] focus:outline-none focus:border-[#3a82f7]"
                    >
                      <option value="Password">Password</option>
                      <option value="PrivateKey">Private Key</option>
                    </select>
                  </div>
                </div>

                {sshAuthType === 'Password' ? (
                  <div>
                    <label
                      htmlFor="ssh-password"
                      className="block text-[10px] font-semibold text-[#8c919a] uppercase tracking-wider mb-1"
                    >
                      SSH Password
                    </label>
                    <input
                      id="ssh-password"
                      data-testid="ssh-tunnel-password"
                      type="password"
                      value={sshPassword}
                      onChange={(e) => setSshPassword(e.target.value)}
                      placeholder="SSH Password"
                      className="w-full bg-[#18191c] border border-[#35373c] rounded px-2.5 py-1 text-xs text-[#e6e8ea] focus:outline-none focus:border-[#3a82f7]"
                    />
                  </div>
                ) : (
                  <div>
                    <label
                      htmlFor="ssh-key-path"
                      className="block text-[10px] font-semibold text-[#8c919a] uppercase tracking-wider mb-1"
                    >
                      Private Key Path
                    </label>
                    <input
                      id="ssh-key-path"
                      data-testid="ssh-tunnel-keypath"
                      type="text"
                      value={sshKeyPath}
                      onChange={(e) => setSshKeyPath(e.target.value)}
                      placeholder="~/.ssh/id_rsa or /path/to/key.pem"
                      className="w-full bg-[#18191c] border border-[#35373c] rounded px-2.5 py-1 text-xs text-[#e6e8ea] focus:outline-none focus:border-[#3a82f7]"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Feedback Banners */}
      {validationError && (
        <div className="flex items-center gap-2 p-2.5 rounded bg-red-500/10 border border-red-500/30 text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      {testStatus === 'success' && (
        <div className="flex items-center gap-2 p-2.5 rounded bg-[#20c997]/10 border border-[#20c997]/30 text-[#20c997]">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{testMessage}</span>
        </div>
      )}

      {testStatus === 'error' && (
        <div className="flex items-start gap-2 p-2.5 rounded bg-red-500/10 border border-red-500/30 text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="break-words leading-relaxed">{testMessage}</span>
        </div>
      )}
    </div>
  );
};
