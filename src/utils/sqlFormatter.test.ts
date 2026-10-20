/**
 * @file sqlFormatter.test.ts
 * @brief Unit tests for the SQL beautifier and formatting engine.
 */

import { describe, it, expect } from 'vitest';
import { formatSql, MAJOR_CLAUSES } from './sqlFormatter';

describe('sqlFormatter', () => {
  it('formats simple SELECT statement with uppercase keywords and clause indentation', () => {
    const raw = 'select id, name, email from users where id > 10;';
    const expected = [
      'SELECT',
      '  id,',
      '  name,',
      '  email',
      'FROM',
      '  users',
      'WHERE',
      '  id > 10;',
    ].join('\n');
    expect(formatSql(raw)).toBe(expected);
  });

  it('formats JOIN and ORDER BY clauses properly', () => {
    const raw =
      'select u.id, o.total from users u left join orders o on u.id = o.user_id order by o.total desc limit 10;';
    const formatted = formatSql(raw);
    expect(formatted).toContain('LEFT JOIN');
    expect(formatted).toContain('ORDER BY');
    expect(formatted).toContain('LIMIT');
    expect(formatted.startsWith('SELECT')).toBe(true);
  });

  it('preserves string literals with lowercase text and special characters', () => {
    const raw = "select id from users where status = 'active and pending' and name = 'john select from';";
    const formatted = formatSql(raw);
    expect(formatted).toContain("'active and pending'");
    expect(formatted).toContain("'john select from'");
  });

  it('preserves single-line and multi-line comments', () => {
    const raw = '-- fetch active users\nselect id from users; /* end of query */';
    const formatted = formatSql(raw);
    expect(formatted).toContain('-- fetch active users');
    expect(formatted).toContain('/* end of query */');
  });

  it('handles empty or blank input gracefully', () => {
    expect(formatSql('')).toBe('');
    expect(formatSql('   ')).toBe('');
    expect(formatSql('\n\t')).toBe('');
  });

  it('formats INSERT INTO and VALUES statements', () => {
    const raw = "insert into users (id, name, email) values (1, 'Alice', 'alice@example.com');";
    const formatted = formatSql(raw);
    expect(formatted).toContain('INSERT INTO');
    expect(formatted).toContain('VALUES');
    expect(formatted).toContain("(1, 'Alice', 'alice@example.com');");
  });

  it('formats UPDATE and SET statements with multiple assignments', () => {
    const raw = "update users set name = 'Bob', age = 30 where id = 1;";
    const formatted = formatSql(raw);
    expect(formatted).toContain('UPDATE');
    expect(formatted).toContain('SET');
    expect(formatted).toContain("  name = 'Bob',");
    expect(formatted).toContain('  age = 30');
    expect(formatted).toContain('WHERE');
    expect(formatted).toContain('  id = 1;');
  });

  it('formats DELETE FROM statements', () => {
    const raw = 'delete from users where id = 5;';
    const formatted = formatSql(raw);
    expect(formatted).toContain('DELETE FROM');
    expect(formatted).toContain('WHERE');
  });

  it('handles functions and subqueries without breaking inner commas', () => {
    const raw = 'select id, coalesce(display_name, full_name, username) as label from accounts;';
    const formatted = formatSql(raw);
    expect(formatted).toContain('  id,');
    expect(formatted).toContain('  COALESCE(display_name, full_name, username) AS label');
  });

  it('preserves quoted identifiers in double quotes, backticks, and brackets', () => {
    const raw = 'select "from", `where`, [select] from [users];';
    const formatted = formatSql(raw);
    expect(formatted).toContain('"from"');
    expect(formatted).toContain('`where`');
    expect(formatted).toContain('[select]');
    expect(formatted).toContain('[users]');
  });

  it('formats multiple statements separated by semicolons', () => {
    const raw = 'select 1 from a; select 2 from b;';
    const formatted = formatSql(raw);
    expect(formatted).toContain('SELECT');
    expect(formatted).toContain('FROM');
    expect(formatted).toContain('  1');
    expect(formatted).toContain('  2');
  });

  it('is idempotent on already formatted SQL', () => {
    const raw = 'select id, name, email from users where id > 10;';
    const firstPass = formatSql(raw);
    const secondPass = formatSql(firstPass);
    expect(secondPass).toBe(firstPass);
  });

  it('exports MAJOR_CLAUSES list containing standard SQL major clauses', () => {
    expect(MAJOR_CLAUSES).toBeDefined();
    expect(MAJOR_CLAUSES).toContain('SELECT');
    expect(MAJOR_CLAUSES).toContain('FROM');
    expect(MAJOR_CLAUSES).toContain('WHERE');
    expect(MAJOR_CLAUSES).toContain('ORDER BY');
    expect(MAJOR_CLAUSES).toContain('GROUP BY');
  });
});
