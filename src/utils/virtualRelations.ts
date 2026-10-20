import { VirtualRelationship } from '../types/database';

/**
 * @brief Constructs a consistent localStorage persistence key for virtual relationships.
 * @param scopeId Connection scope identifier (see `connectionScope`).
 * @return LocalStorage key string.
 */
export function getVirtualRelationsKey(scopeId: string): string {
  const sanitized = (scopeId || 'default').trim().toLowerCase();
  return `dyno_virtual_relations_${sanitized}`;
}

/**
 * @brief Retrieves all persisted virtual relationships for a given connection scope.
 * @param scopeId Connection scope identifier.
 * @return Array of VirtualRelationship records.
 */
export function loadVirtualRelationships(scopeId: string): VirtualRelationship[] {
  try {
    const raw = localStorage.getItem(getVirtualRelationsKey(scopeId));
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
 * @param scopeId Connection scope identifier.
 * @param rels Array of VirtualRelationship records to persist.
 */
export function saveVirtualRelationships(scopeId: string, rels: VirtualRelationship[]): void {
  try {
    localStorage.setItem(getVirtualRelationsKey(scopeId), JSON.stringify(rels));
  } catch (err) {
    console.error('Failed to save virtual relationships to localStorage:', err);
  }
}

/**
 * @brief Adds a new virtual relationship and saves it to persistence.
 * @param scopeId Connection scope identifier.
 * @param rel New VirtualRelationship record.
 * @return Updated list of VirtualRelationship records.
 */
export function addVirtualRelationship(
  scopeId: string,
  rel: VirtualRelationship
): VirtualRelationship[] {
  const existing = loadVirtualRelationships(scopeId);
  // Avoid duplicate connections between same source and target columns
  const filtered = existing.filter((item) => item.id !== rel.id);
  const updated = [...filtered, rel];
  saveVirtualRelationships(scopeId, updated);
  return updated;
}

/**
 * @brief Removes an existing virtual relationship by its identifier.
 * @param scopeId Connection scope identifier.
 * @param relId Unique identifier of the virtual relationship to remove.
 * @return Updated list of VirtualRelationship records after removal.
 */
export function removeVirtualRelationship(
  scopeId: string,
  relId: string
): VirtualRelationship[] {
  const existing = loadVirtualRelationships(scopeId);
  const updated = existing.filter((item) => item.id !== relId);
  saveVirtualRelationships(scopeId, updated);
  return updated;
}
