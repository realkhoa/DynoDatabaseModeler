/**
 * @file diffCount.ts
 * @brief Utility calculating pending structural schema differences between live and desired schemas.
 * @details Mirrors the backend diff engine: tables are matched by fully-qualified identity,
 * user-recorded renames count as one change instead of a destructive drop plus create, and column
 * comparisons follow the same field set the backend uses.
 */

import type { DatabaseSchema, TableSchema } from '../types/database';
import { isSameCanonicalType, tableKey } from '../types/database';

/**
 * @brief Computes a composite string signature representing a foreign key definition.
 * @details Concatenates constraint name, source column, target table/column,
 * and referential actions for O(1) set lookup.
 * @param fk Foreign key specification object.
 * @return Unique composite string signature.
 */
function fkSignature(fk: {
  constraint_name: string;
  source_column: string;
  target_table: string;
  target_column: string;
  on_delete: string;
  on_update: string;
}): string {
  return [
    fk.constraint_name,
    fk.source_column,
    fk.target_table,
    fk.target_column,
    fk.on_delete,
    fk.on_update,
  ].join('|');
}

/**
 * @brief Computes the count of structural differences between live and desired database schemas.
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

  const liveTables = new Map<string, TableSchema>(
    live.tables.map((t) => [tableKey(t), t])
  );
  const claimed = new Set<string>();

  // 1. Match desired tables to live counterparts, honouring recorded renames.
  const matched: Array<{ liveTable: TableSchema; desiredTable: TableSchema }> = [];
  const toCreate: TableSchema[] = [];

  for (const desiredTable of desired.tables) {
    const key = tableKey(desiredTable);
    const renameSource = desiredTable.rename_from;

    let liveTable: TableSchema | undefined;
    if (renameSource && liveTables.has(renameSource) && !claimed.has(renameSource)) {
      liveTable = liveTables.get(renameSource);
    } else if (liveTables.has(key) && !claimed.has(key)) {
      liveTable = liveTables.get(key);
    }

    if (liveTable) {
      const liveKey = tableKey(liveTable);
      claimed.add(liveKey);
      matched.push({ liveTable, desiredTable });
      if (liveKey !== key) {
        // A rename is a single non-destructive change.
        count += 1;
      }
    } else {
      toCreate.push(desiredTable);
    }
  }

  // 2. Tables only present in the desired schema.
  count += toCreate.length;

  // 3. Tables only present in the live schema are drops.
  for (const [key] of liveTables) {
    if (!claimed.has(key)) {
      count += 1;
    }
  }

  // 4. Per-table column and foreign key comparison for surviving tables.
  for (const { liveTable, desiredTable } of matched) {
    const liveColMap = new Map(liveTable.columns.map((c) => [c.name, c]));
    const desiredColMap = new Map(desiredTable.columns.map((c) => [c.name, c]));

    for (const [colName] of desiredColMap) {
      if (!liveColMap.has(colName)) {
        count += 1;
      }
    }

    for (const [colName] of liveColMap) {
      if (!desiredColMap.has(colName)) {
        count += 1;
      }
    }

    for (const [colName, desiredCol] of desiredColMap) {
      const liveCol = liveColMap.get(colName);
      if (!liveCol) {
        continue;
      }
      const changed =
        !isSameCanonicalType(liveCol.data_type, desiredCol.data_type) ||
        liveCol.is_nullable !== desiredCol.is_nullable ||
        liveCol.is_primary_key !== desiredCol.is_primary_key ||
        liveCol.is_auto_increment !== desiredCol.is_auto_increment ||
        liveCol.default_value !== desiredCol.default_value;
      if (changed) {
        count += 1;
      }
    }

    const liveFkSet = new Set(liveTable.foreign_keys.map(fkSignature));
    const desiredFkSet = new Set(desiredTable.foreign_keys.map(fkSignature));

    for (const sig of desiredFkSet) {
      if (!liveFkSet.has(sig)) {
        count += 1;
      }
    }
    for (const sig of liveFkSet) {
      if (!desiredFkSet.has(sig)) {
        count += 1;
      }
    }
  }

  return count;
}
