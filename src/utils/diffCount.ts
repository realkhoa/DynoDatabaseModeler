/**
 * @file diffCount.ts
 * @brief Utility calculating pending structural schema differences between live and desired schemas.
 * @details Evaluates created tables, dropped tables, added columns, dropped columns,
 * altered columns, and foreign key modifications between two schema snapshots.
 */

import type { DatabaseSchema } from '../types/database';

/**
 * @brief Computes the count of structural differences between live and desired database schemas.
 * @details Compares tables, columns, column attributes, and foreign keys between the schemas.
 * @param live Live database schema introspected from the target database, or null/undefined.
 * @param desired Target working database schema modified in the diagram canvas, or null/undefined.
 * @return Total integer count of pending structural changes.
 */
export function computePendingChangesCount(
  live: DatabaseSchema | null | undefined,
  desired: DatabaseSchema | null | undefined
): number {
  if (!live || !desired) {
    return 0;
  }

  let count = 0;

  // 1. Tables to create: in desired but not in live
  const liveTableMap = new Map(live.tables.map((t) => [t.name, t]));
  const desiredTableMap = new Map(desired.tables.map((t) => [t.name, t]));

  for (const [name] of desiredTableMap) {
    if (!liveTableMap.has(name)) {
      count++;
    }
  }

  // 2. Tables to drop: in live but not in desired
  for (const [name] of liveTableMap) {
    if (!desiredTableMap.has(name)) {
      count++;
    }
  }

  // 3. For tables existing in both: compare columns and foreign keys
  for (const [name, desiredTable] of desiredTableMap) {
    const liveTable = liveTableMap.get(name);
    if (!liveTable) {
      continue;
    }

    const liveColMap = new Map(liveTable.columns.map((c) => [c.name, c]));
    const desiredColMap = new Map(desiredTable.columns.map((c) => [c.name, c]));

    // Columns to add
    for (const [colName] of desiredColMap) {
      if (!liveColMap.has(colName)) {
        count++;
      }
    }

    // Columns to drop
    for (const [colName] of liveColMap) {
      if (!desiredColMap.has(colName)) {
        count++;
      }
    }

    // Columns to alter
    for (const [colName, desiredCol] of desiredColMap) {
      const liveCol = liveColMap.get(colName);
      if (!liveCol) {
        continue;
      }

      const typeChanged =
        JSON.stringify(liveCol.data_type) !== JSON.stringify(desiredCol.data_type);
      const nullableChanged = liveCol.is_nullable !== desiredCol.is_nullable;
      const pkChanged = liveCol.is_primary_key !== desiredCol.is_primary_key;
      const autoIncChanged = liveCol.is_auto_increment !== desiredCol.is_auto_increment;
      const defaultChanged = liveCol.default_value !== desiredCol.default_value;

      if (typeChanged || nullableChanged || pkChanged || autoIncChanged || defaultChanged) {
        count++;
      }
    }

    // Foreign keys
    const liveFkMap = new Map(
      liveTable.foreign_keys.map((fk) => [
        fk.constraint_name || `${fk.source_column}->${fk.target_table}.${fk.target_column}`,
        fk,
      ])
    );
    const desiredFkMap = new Map(
      desiredTable.foreign_keys.map((fk) => [
        fk.constraint_name || `${fk.source_column}->${fk.target_table}.${fk.target_column}`,
        fk,
      ])
    );

    // Foreign keys to add
    for (const [fkKey] of desiredFkMap) {
      if (!liveFkMap.has(fkKey)) {
        count++;
      }
    }

    // Foreign keys to drop
    for (const [fkKey] of liveFkMap) {
      if (!desiredFkMap.has(fkKey)) {
        count++;
      }
    }

    // Foreign keys altered (same key name but changed parameters)
    for (const [fkKey, desiredFk] of desiredFkMap) {
      const liveFk = liveFkMap.get(fkKey);
      if (!liveFk) {
        continue;
      }

      if (
        liveFk.on_delete !== desiredFk.on_delete ||
        liveFk.on_update !== desiredFk.on_update ||
        liveFk.source_column !== desiredFk.source_column ||
        liveFk.target_column !== desiredFk.target_column ||
        liveFk.target_table !== desiredFk.target_table
      ) {
        count++;
      }
    }
  }

  return count;
}
