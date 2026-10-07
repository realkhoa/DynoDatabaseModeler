import { describe, it, expect, beforeEach } from 'vitest';
import {
  getVirtualRelationsKey,
  loadVirtualRelationships,
  saveVirtualRelationships,
  addVirtualRelationship,
  removeVirtualRelationship,
} from './virtualRelations';
import { VirtualRelationship } from '../types/database';

describe('virtualRelations utilities', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const sampleRel: VirtualRelationship = {
    id: 'vr_orders_users',
    sourceTable: 'orders',
    sourceColumn: 'user_id',
    targetTable: 'users',
    targetColumn: 'id',
    name: 'Logical User Ref',
  };

  it('generates consistent sanitized storage keys', () => {
    expect(getVirtualRelationsKey('My_Shop')).toBe('dyno_virtual_relations_my_shop');
    expect(getVirtualRelationsKey('')).toBe('dyno_virtual_relations_default');
  });

  it('loads empty array when no relationships are stored', () => {
    expect(loadVirtualRelationships('test_db')).toEqual([]);
  });

  it('adds and loads virtual relationships correctly', () => {
    const updated = addVirtualRelationship('test_db', sampleRel);
    expect(updated).toHaveLength(1);
    expect(updated[0].name).toBe('Logical User Ref');

    const loaded = loadVirtualRelationships('test_db');
    expect(loaded).toEqual([sampleRel]);
  });

  it('saves and loads virtual relationships correctly', () => {
    saveVirtualRelationships('test_db', [sampleRel]);
    expect(loadVirtualRelationships('test_db')).toEqual([sampleRel]);
  });

  it('removes virtual relationship by id', () => {
    addVirtualRelationship('test_db', sampleRel);
    const updated = removeVirtualRelationship('test_db', 'vr_orders_users');
    expect(updated).toEqual([]);
    expect(loadVirtualRelationships('test_db')).toEqual([]);
  });

  it('handles invalid JSON gracefully without throwing', () => {
    localStorage.setItem(getVirtualRelationsKey('broken_db'), 'invalid_json{{');
    expect(loadVirtualRelationships('broken_db')).toEqual([]);
  });
});
