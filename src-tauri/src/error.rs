//! @file error.rs
//! @brief Unified application error types for DynoDbModeler backend operations.
//! @details Defines errors serialized across the Tauri IPC boundary to the frontend user interface.

use serde::Serialize;
use thiserror::Error;

/// @brief Application error enum serialized over Tauri IPC to the frontend.
/// @details Categorizes errors arising from database access, connection handshakes, introspection,
/// migration generation, and configuration parsing.
#[derive(Debug, Error, Serialize, Clone, PartialEq, Eq)]
pub enum AppError {
    /// @brief Relational database execution or query errors.
    #[error("Database error: {0}")]
    Database(String),

    /// @brief Connection failure, timeout, or authentication rejection.
    #[error("Connection error: {0}")]
    Connection(String),

    /// @brief Metadata and catalog introspection failures.
    #[error("Schema introspection error: {0}")]
    Introspection(String),

    /// @brief Migration script planning, validation, or execution errors.
    #[error("Migration error: {0}")]
    Migration(String),

    /// @brief Invalid parameters or configuration specification.
    #[error("Invalid configuration: {0}")]
    Config(String),

    /// @brief Unexpected internal subsystem errors.
    #[error("Internal error: {0}")]
    Internal(String),
}
