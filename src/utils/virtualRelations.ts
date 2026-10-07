import { VirtualRelationship } from '../types/database';

/**
 * @brief Constructs a consistent localStorage persistence key for virtual relationships.
 * @param dbName Database name or catalog identifier.
 * @return LocalStorage key string.
 */
export function getVirtualRelationsKey(dbName: string): string {
  const sanitized = (dbName || 'default').trim().toLowerCase();
  return `dyno_virtual_relations_${sanitized}`;
}

/**
 * @brief Retrieves all persisted virtual relationships for a given database.
 * @param dbName Database name.
 * @return Array of VirtualRelationship records.
 */
export function loadVirtualRelationships(dbName: string): VirtualRelationship[] {
  try {
    const raw = localStorage.getItem(getVirtualRelationsKey(dbName));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to load virtual relationships from localStorage:', err);
    return [];
  }
}

/**
 * @brief Persists an updated list of virtual relationships to localStorage.
 * @param dbName Database name.
 * @param rels Array of VirtualRelationship records to persist.
 */
export function saveVirtualRelationships(dbName: string, rels: VirtualRelationship[]): void {
  try {
    localStorage.setItem(getVirtualRelationsKey(dbName), JSON.stringify(rels));
  } catch (err) {
    console.error('Failed to save virtual relationships to localStorage:', err);
  }
}

/**
 * @brief Adds a new virtual relationship and saves it to persistence.
 * @param dbName Database name.
 * @param rel New VirtualRelationship record.
 * @return Updated list of VirtualRelationship records.
 */
export function addVirtualRelationship(
  dbName: string,
  rel: VirtualRelationship
): VirtualRelationship[] {
  const existing = loadVirtualRelationships(dbName);
  // Avoid duplicate connections between same source and target columns
  const filtered = existing.filter((item) => item.id !== rel.id);
  const updated = [...filtered, rel];
  saveVirtualRelationships(dbName, updated);
  return updated;
}

/**
 * @brief Removes an existing virtual relationship by its identifier.
 * @param dbName Database name.
 * @param relId Unique identifier of the virtual relationship to remove.
 * @return Updated list of VirtualRelationship records after removal.
 */
export function removeVirtualRelationship(
  dbName: string,
  relId: string
): VirtualRelationship[] {
  const existing = loadVirtualRelationships(dbName);
  const updated = existing.filter((item) => item.id !== relId);
  saveVirtualRelationships(dbName, updated);
  return updated;
}
