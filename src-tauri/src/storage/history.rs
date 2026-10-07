//! @file history.rs
//! @brief SQLite-backed persistent query execution history and snippet storage.
//! @details Manages local persistence for executed queries, execution durations, row metrics, and favorite status.

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

/// @brief Represents a persistent query execution record.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QueryHistoryRecord {
    /// @brief Primary key identifier.
    pub id: i64,
    /// @brief Executed SQL statement text.
    pub query_text: String,
    /// @brief ISO 8601 execution timestamp.
    pub executed_at: String,
    /// @brief Wall-clock execution duration in milliseconds.
    pub duration_ms: u64,
    /// @brief Number of rows affected or returned.
    pub rows_count: u64,
    /// @brief Execution status ("success" or "error").
    pub status: String,
    /// @brief Whether the user bookmarked or starred this query.
    pub is_favorite: bool,
}

/// @brief Initializes the local SQLite schema for query history if not already present.
/// @param pool Reference to SQLite connection pool.
/// @return Result with Ok(()) or AppError on migration failure.
pub async fn init_history_schema(pool: &SqlitePool) -> Result<(), AppError> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS query_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query_text TEXT NOT NULL,
            executed_at TEXT NOT NULL,
            duration_ms INTEGER NOT NULL,
            rows_count INTEGER NOT NULL,
            status TEXT NOT NULL,
            is_favorite INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_query_history_favorite ON query_history(is_favorite);
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| AppError::Database(format!("Failed to initialize query history: {}", e)))?;

    Ok(())
}

/// @brief Records a new query execution in the history log.
/// @param pool Reference to SQLite connection pool.
/// @param query_text Executed SQL query text.
/// @param duration_ms Elapsed execution duration.
/// @param rows_count Number of affected/returned rows.
/// @param status Status string ("success" or "error").
/// @return Populated QueryHistoryRecord instance.
pub async fn record_query(
    pool: &SqlitePool,
    query_text: &str,
    duration_ms: u64,
    rows_count: u64,
    status: &str,
) -> Result<QueryHistoryRecord, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let res = sqlx::query(
        r#"
        INSERT INTO query_history (query_text, executed_at, duration_ms, rows_count, status, is_favorite)
        VALUES (?, ?, ?, ?, ?, 0)
        "#,
    )
    .bind(query_text)
    .bind(&now)
    .bind(duration_ms as i64)
    .bind(rows_count as i64)
    .bind(status)
    .execute(pool)
    .await
    .map_err(|e| AppError::Database(format!("Failed to record query history: {}", e)))?;

    let id = res.last_insert_rowid();

    Ok(QueryHistoryRecord {
        id,
        query_text: query_text.to_string(),
        executed_at: now,
        duration_ms,
        rows_count,
        status: status.to_string(),
        is_favorite: false,
    })
}

/// @brief Retrieves the latest query execution history records.
/// @param pool Reference to SQLite connection pool.
/// @param limit Maximum number of records to return.
/// @return Vector of QueryHistoryRecord instances ordered by latest first.
pub async fn get_history(
    pool: &SqlitePool,
    limit: usize,
) -> Result<Vec<QueryHistoryRecord>, AppError> {
    let rows = sqlx::query(
        r#"
        SELECT id, query_text, executed_at, duration_ms, rows_count, status, is_favorite
        FROM query_history
        ORDER BY id DESC
        LIMIT ?
        "#,
    )
    .bind(limit as i64)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Database(format!("Failed to fetch query history: {}", e)))?;

    let mut records = Vec::with_capacity(rows.len());
    for row in rows {
        records.push(QueryHistoryRecord {
            id: row.try_get::<i64, _>("id").unwrap_or(0),
            query_text: row.try_get::<String, _>("query_text").unwrap_or_default(),
            executed_at: row.try_get::<String, _>("executed_at").unwrap_or_default(),
            duration_ms: row.try_get::<i64, _>("duration_ms").map(|v| v as u64).unwrap_or(0),
            rows_count: row.try_get::<i64, _>("rows_count").map(|v| v as u64).unwrap_or(0),
            status: row.try_get::<String, _>("status").unwrap_or_default(),
            is_favorite: row.try_get::<i64, _>("is_favorite").map(|v| v != 0).unwrap_or(false),
        });
    }

    Ok(records)
}

/// @brief Toggles favorite/bookmark status for a specific history record.
/// @param pool Reference to SQLite connection pool.
/// @param id Record primary key.
/// @return Updated favorite boolean state.
pub async fn toggle_favorite(pool: &SqlitePool, id: i64) -> Result<bool, AppError> {
    let row = sqlx::query("SELECT is_favorite FROM query_history WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?
        .ok_or_else(|| AppError::Database(format!("History record {} not found", id)))?;

    let current: i64 = row.try_get::<i64, _>("is_favorite").unwrap_or(0);
    let next = if current == 0 { 1 } else { 0 };

    sqlx::query("UPDATE query_history SET is_favorite = ? WHERE id = ?")
        .bind(next)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(next != 0)
}

/// @brief Clears non-favorite history records from storage.
/// @param pool Reference to SQLite connection pool.
/// @return Ok(()) on success.
pub async fn clear_history(pool: &SqlitePool) -> Result<(), AppError> {
    sqlx::query("DELETE FROM query_history WHERE is_favorite = 0")
        .execute(pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}
