/**
 * @file dataTransfer.ts
 * @brief Multi-format data serialization and export utilities (CSV, JSON, Markdown, SQL INSERT).
 * @details Provides RFC 4180 compliant CSV generation, structured JSON serialization,
 * GitHub-flavored Markdown table formatting, dialect-safe SQL INSERT statement generation,
 * and browser-level Blob download triggering.
 */

/**
 * @brief Supported export formats for tabular dataset transfer.
 */
export type ExportFormat = 'csv' | 'json' | 'markdown' | 'sql';

/**
 * @brief Configuration options for CSV data export.
 */
export interface CsvExportOptions {
  /** @brief Custom delimiter character (defaults to comma ','). */
  delimiter?: string;
  /** @brief Whether to enclose all field values in quotes regardless of content (defaults to false). */
  quoteAll?: boolean;
}

/**
 * @brief Configuration options for SQL INSERT export.
 */
export interface SqlExportOptions {
  /** @brief Destination table identifier for generated INSERT statements. */
  tableName: string;
}

/**
 * @brief Formats a single tabular cell value into an RFC 4180 compliant CSV field.
 * @details Encloses value in double quotes if quoteAll is enabled or if the value
 * contains delimiters, quotation marks, or newline characters. Replaces internal
 * quotation marks with doubled quotes ("").
 * @param val Cell value of arbitrary type.
 * @param delimiter Field delimiter string.
 * @param quoteAll Flag indicating whether all fields must be quoted.
 * @return Formatted CSV field string.
 */
function formatCsvField(val: any, delimiter: string, quoteAll: boolean): string {
  if (val === null || val === undefined) {
    return quoteAll ? '""' : '';
  }

  let strVal: string;
  if (typeof val === 'object') {
    try {
      strVal = JSON.stringify(val);
    } catch {
      strVal = String(val);
    }
  } else {
    strVal = String(val);
  }

  const needsQuotes =
    quoteAll ||
    strVal.includes(delimiter) ||
    strVal.includes('"') ||
    strVal.includes('\n') ||
    strVal.includes('\r');

  if (needsQuotes) {
    const escaped = strVal.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  return strVal;
}

/**
 * @brief Serializes tabular dataset into RFC 4180 compliant CSV text.
 * @param columns Array of column header labels.
 * @param rows 2D array of tabular rows.
 * @param options CSV export configuration options.
 * @return RFC 4180 compliant CSV string.
 */
export function exportAsCsv(
  columns: string[],
  rows: any[][],
  options?: CsvExportOptions
): string {
  const delimiter = options?.delimiter ?? ',';
  const quoteAll = options?.quoteAll ?? false;

  const headerRow = columns
    .map((col) => formatCsvField(col, delimiter, quoteAll))
    .join(delimiter);

  if (rows.length === 0) {
    return headerRow;
  }

  const dataRows = rows.map((row) =>
    columns
      .map((_, colIdx) => formatCsvField(row[colIdx], delimiter, quoteAll))
      .join(delimiter)
  );

  return [headerRow, ...dataRows].join('\n');
}

/**
 * @brief Serializes tabular dataset into a JSON array of column-keyed row objects.
 * @param columns Array of column header labels.
 * @param rows 2D array of tabular rows.
 * @param pretty Whether to format output with 2-space indentation (defaults to true).
 * @return JSON string representing the dataset.
 */
export function exportAsJson(
  columns: string[],
  rows: any[][],
  pretty: boolean = true
): string {
  const objects = rows.map((row) => {
    const obj: Record<string, any> = {};
    columns.forEach((col, idx) => {
      obj[col] = row[idx];
    });
    return obj;
  });

  return pretty ? JSON.stringify(objects, null, 2) : JSON.stringify(objects);
}

/**
 * @brief Formats a single tabular cell value for inclusion in a Markdown table.
 * @details Replaces internal vertical pipes with escaped pipes (\\|) and converts
 * line breaks to HTML `<br/>` tags to preserve Markdown table layout.
 * @param val Cell value of arbitrary type.
 * @return Cleaned string safe for Markdown table cells.
 */
function formatMarkdownCell(val: any): string {
  if (val === null || val === undefined) {
    return '';
  }

  let strVal: string;
  if (typeof val === 'object') {
    try {
      strVal = JSON.stringify(val);
    } catch {
      strVal = String(val);
    }
  } else {
    strVal = String(val);
  }

  return strVal
    .replace(/\|/g, '\\|')
    .replace(/\r\n|\n|\r/g, '<br/>');
}

/**
 * @brief Serializes tabular dataset into a GitHub-flavored Markdown table.
 * @param columns Array of column header labels.
 * @param rows 2D array of tabular rows.
 * @return Formatted Markdown table string.
 */
export function exportAsMarkdown(columns: string[], rows: any[][]): string {
  if (columns.length === 0) {
    return '';
  }

  const headerLine = `| ${columns.map(formatMarkdownCell).join(' | ')} |`;
  const separatorLine = `| ${columns.map(() => '---').join(' | ')} |`;

  const dataLines = rows.map(
    (row) => `| ${columns.map((_, i) => formatMarkdownCell(row[i])).join(' | ')} |`
  );

  return [headerLine, separatorLine, ...dataLines].join('\n');
}

/**
 * @brief Formats a value into a dialect-safe SQL literal.
 * @details Single quotes are doubled and backslashes are escaped by doubling as well, so the literal
 * stays correct for servers that treat backslash as an escape character
 * (`standard_conforming_strings = off`, MySQL's default).
 * @param val Arbitrary cell value.
 * @return SQL literal string.
 */
function formatSqlLiteral(val: any): string {
  if (val === null || val === undefined) {
    return 'NULL';
  }

  if (typeof val === 'number') {
    return Number.isFinite(val) ? String(val) : 'NULL';
  }

  if (typeof val === 'boolean') {
    return val ? 'TRUE' : 'FALSE';
  }

  let strVal: string;
  if (typeof val === 'object') {
    try {
      strVal = JSON.stringify(val);
    } catch {
      strVal = String(val);
    }
  } else {
    strVal = String(val);
  }

  const escaped = strVal.replace(/\\/g, '\\\\').replace(/'/g, "''");
  return `'${escaped}'`;
}

/**
 * @brief Quotes an identifier for use in generated SQL.
 * @details Identifiers are wrapped in double quotes with embedded quotes doubled, which is accepted
 * by PostgreSQL, SQLite, MySQL (with ANSI_QUOTES off MySQL still accepts double quotes for
 * identifiers) and most tooling. Reserved words such as `order` or `select` therefore stay usable
 * as column names.
 * @param identifier Raw identifier text.
 * @return Double-quoted identifier.
 */
function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * @brief Serializes tabular dataset into a series of SQL INSERT statements.
 * @param columns Array of column header labels.
 * @param rows 2D array of tabular rows.
 * @param options SQL export configuration options specifying table name.
 * @return Formatted SQL INSERT statements string.
 */
export function exportAsSqlInserts(
  columns: string[],
  rows: any[][],
  options: SqlExportOptions
): string {
  if (rows.length === 0 || columns.length === 0) {
    return '';
  }

  const rawTable = options.tableName.trim() || 'exported_table';
  const targetTable = rawTable
    .split('.')
    .map((part) => quoteSqlIdentifier(part))
    .join('.');
  const colList = columns.map(quoteSqlIdentifier).join(', ');

  const statements = rows.map((row) => {
    const valList = columns
      .map((_, i) => formatSqlLiteral(row[i]))
      .join(', ');
    return `INSERT INTO ${targetTable} (${colList}) VALUES (${valList});`;
  });

  return statements.join('\n');
}

/**
 * @brief Triggers a browser file download using a temporary Blob and anchor element.
 * @param content Textual payload content to save in file.
 * @param filename Default suggested filename for the downloaded artifact.
 * @param mimeType MIME type specification for Blob creation.
 */
export function downloadExportFile(
  content: string,
  filename: string,
  mimeType: string
): void {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = window.URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = 'none';

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl);
  }, 1000);
}
