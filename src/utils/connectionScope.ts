/**
 * @file connectionScope.ts
 * @brief Stable per-connection identity used to scope locally persisted diagram data.
 * @details Virtual relationships and canvas layout are stored locally per database. Keying them by
 * database name alone makes two different servers that both host a database called `postgres`
 * overwrite each other's diagram data, so the endpoint identity is part of the key.
 */

import type { ConnectionConfig } from '../types/database';

/**
 * @brief Builds a stable scope identifier for a connection profile.
 * @param config Active connection configuration, or null when disconnected.
 * @return Scope string such as `postgres://db.internal:5432/app`, or `default` when unavailable.
 */
export function connectionScope(config: ConnectionConfig | null | undefined): string {
  if (!config) {
    return 'default';
  }

  if (config.db_type === 'Sqlite' || config.db_type === 'DuckDb') {
    const target = (config.file_path || config.database || ':memory:').trim().toLowerCase();
    return `${config.db_type.toLowerCase()}://${target}`;
  }

  const host = (config.host || 'localhost').trim().toLowerCase();
  const port = config.port ?? '';
  const database = (config.database || '').trim().toLowerCase();
  return `${config.db_type.toLowerCase()}://${host}:${port}/${database}`;
}
