//! @file mod.rs
//! @brief Local SQLite storage subsystem for DynoDbModeler application metadata.
//! @details Houses persistent storage for executed SQL query history and favorite query snippets.

pub mod history;

pub use history::QueryHistoryRecord;

#[cfg(test)]
mod history_test;
