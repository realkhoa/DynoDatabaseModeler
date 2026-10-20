//! @file mod.rs
//! @brief Local SQLite storage subsystem for DynoDbModeler application metadata.
//! @details Houses persistent storage for executed SQL query history, favorite query snippets,
//! and operating-system backed credential storage for saved connection profiles.

pub mod history;
pub mod secrets;

pub use history::QueryHistoryRecord;
pub use secrets::ConnectionSecrets;

#[cfg(test)]
mod history_test;
