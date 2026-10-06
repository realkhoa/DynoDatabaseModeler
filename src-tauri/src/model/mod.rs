//! @file mod.rs
//! @brief Module definitions and re-exports for the core database modeling domain.
//! @details Exposes schema definitions, connection configurations, and associated domain models.

pub mod connection;
pub mod schema;

#[cfg(test)]
mod tests;
