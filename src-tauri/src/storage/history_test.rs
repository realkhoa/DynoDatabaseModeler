//! @file history_test.rs
//! @brief Unit tests for query execution history persistence and favorite toggling.

use super::history::*;
use sqlx::sqlite::SqlitePoolOptions;

#[tokio::test]
async fn test_query_history_workflow() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("Failed to create in-memory sqlite pool");

    init_history_schema(&pool)
        .await
        .expect("Failed to initialize schema");

    // 1. Record two queries
    let r1 = record_query(&pool, "SELECT * FROM users", 12, 10, "success")
        .await
        .expect("Failed to record query 1");
    let r2 = record_query(&pool, "INVALID SQL STATEMENT", 2, 0, "error")
        .await
        .expect("Failed to record query 2");

    assert_eq!(r1.query_text, "SELECT * FROM users");
    assert_eq!(r1.status, "success");
    assert!(!r1.is_favorite);

    assert_eq!(r2.status, "error");

    // 2. Fetch history (latest first)
    let history = get_history(&pool, 10)
        .await
        .expect("Failed to fetch history");
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].id, r2.id);
    assert_eq!(history[1].id, r1.id);

    // 3. Toggle favorite on r1
    let is_fav = toggle_favorite(&pool, r1.id)
        .await
        .expect("Failed to toggle favorite");
    assert!(is_fav);

    let updated_history = get_history(&pool, 10)
        .await
        .expect("Failed to fetch history");
    let fav_item = updated_history.iter().find(|h| h.id == r1.id).unwrap();
    assert!(fav_item.is_favorite);

    // 4. Clear history: clears non-favorites (r2), keeps favorite (r1)
    clear_history(&pool).await.expect("Failed to clear history");

    let remaining = get_history(&pool, 10)
        .await
        .expect("Failed to fetch history");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, r1.id);
}
