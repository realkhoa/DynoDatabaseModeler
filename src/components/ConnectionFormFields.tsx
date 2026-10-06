/**
 * @file ConnectionFormFields.tsx
 * @brief Subcomponent rendering input fields and status banners for database connections.
 * @details Separates connection form controls from modal dialog presentation logic.
 */

import React from 'react';
import { CheckCircle2, AlertCircle, Shield } from 'lucide-react';
import type { DatabaseType } from '../types/database';

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
  /** @brief SQLite database file path. */
  filePath: string;
  /** @brief State setter for SQLite file path. */
  setFilePath: (val: string) => void;
  /** @brief SSL encryption flag. */
  ssl: boolean;
  /** @brief State setter for SSL encryption flag. */
  setSsl: (val: boolean) => void;
  /** @brief Validation error message, if any. */
  validationError: string;
  /** @brief Status of connectivity test. */
  testStatus: 'idle' | 'success' | 'error';
  /** @brief Connectivity test message. */
  testMessage: string;
}

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
  validationError,
  testStatus,
  testMessage,
}) => {
  return (
    <div className="space-y-4">
      {/* Engine Selector */}
      <div>
        <label className="block text-[11px] font-semibold text-[#8c919a] uppercase tracking-wider mb-1.5">
          Database Engine
        </label>
        <div className="grid grid-cols-4 gap-1.5 bg-[#18191c] p-1 rounded-md border border-[#35373c]">
          {(
            [
              { type: 'Postgres', label: 'PostgreSQL' },
              { type: 'Sqlite', label: 'SQLite' },
              { type: 'MySql', label: 'MySQL' },
              { type: 'Mssql', label: 'SQL Server' },
            ] as const
          ).map(({ type, label }) => (
            <button
              key={type}
              type="button"
              onClick={() => onEngineChange(type)}
              className={`py-1.5 px-2 rounded text-center font-medium transition-colors ${
                dbType === type
                  ? 'bg-[#3a82f7] text-white shadow-sm'
                  : 'text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#26282d]'
              }`}
            >
              {label}
            </button>
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

      {/* SQLite Specific Fields */}
      {dbType === 'Sqlite' ? (
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
            placeholder="/path/to/database.db or :memory:"
            className="w-full bg-[#18191c] border border-[#35373c] rounded px-3 py-1.5 font-mono text-[#e6e8ea] focus:outline-none focus:border-[#3a82f7]"
          />
          <p className="mt-1 text-[11px] text-[#8c919a]">
            Use <code className="text-[#3a82f7]">:memory:</code> for an isolated in-memory SQLite database.
          </p>
        </div>
      ) : (
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
            <label
              htmlFor="conn-database"
              className="block text-[11px] font-semibold text-[#8c919a] uppercase tracking-wider mb-1"
            >
              Database
            </label>
            <input
              id="conn-database"
              type="text"
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
              placeholder="Database name"
              className="w-full bg-[#18191c] border border-[#35373c] rounded px-3 py-1.5 text-[#e6e8ea] focus:outline-none focus:border-[#3a82f7]"
            />
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
                className="w-full bg-[#18191c] border border-[#35373c] rounded px-3 py-1.5 text-[#e6e8ea] focus:outline-none focus:border-[#3a82f7]"
              />
            </div>
          </div>

          {/* SSL Checkbox */}
          <div className="flex items-center gap-2 pt-1">
            <input
              id="conn-ssl"
              type="checkbox"
              checked={ssl}
              onChange={(e) => setSsl(e.target.checked)}
              className="rounded bg-[#18191c] border-[#35373c] text-[#3a82f7] focus:ring-0 focus:ring-offset-0"
            />
            <label
              htmlFor="conn-ssl"
              className="flex items-center gap-1.5 text-xs text-[#e6e8ea] cursor-pointer select-none"
            >
              <Shield className="w-3.5 h-3.5 text-[#8c919a]" />
              <span>Use SSL / TLS Encryption</span>
            </label>
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
        <div className="flex items-center gap-2 p-2.5 rounded bg-red-500/10 border border-red-500/30 text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="truncate">{testMessage}</span>
        </div>
      )}
    </div>
  );
};
