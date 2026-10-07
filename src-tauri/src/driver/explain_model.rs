//! @file explain_model.rs
//! @brief Data models for database query execution plans and visual explain trees.
//! @details Encapsulates normalized ExecutionPlanNode structures across SQLite, PostgreSQL, MySQL, and MSSQL.

use serde::{Deserialize, Serialize};

/// @brief Represents a hierarchical node in an execution plan graph.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExecutionPlanNode {
    /// @brief Type of execution step or algorithm (e.g., "Seq Scan", "Index Scan", "Nested Loop", "SCAN TABLE", "SEARCH TABLE").
    pub node_type: String,
    /// @brief Target database relation (table or index) being accessed, if applicable.
    pub relation_name: Option<String>,
    /// @brief Relative or absolute optimizer cost assigned to this operation.
    pub cost: f64,
    /// @brief Actual execution duration in milliseconds if available.
    pub actual_time_ms: Option<f64>,
    /// @brief Estimated or processed row count.
    pub rows: u64,
    /// @brief Additional details, predicates, or scan filters.
    pub detail: Option<String>,
    /// @brief Child plan nodes that feed rows into this operation.
    pub children: Vec<ExecutionPlanNode>,
}

impl ExecutionPlanNode {
    /// @brief Constructs a new execution plan node.
    /// @param node_type Operation type label.
    /// @param relation_name Optional table or index name.
    /// @param cost Optimizer cost.
    /// @param rows Estimated rows.
    /// @param detail Optional execution details or filter predicates.
    /// @return Initialized ExecutionPlanNode instance.
    pub fn new(
        node_type: impl Into<String>,
        relation_name: Option<String>,
        cost: f64,
        rows: u64,
        detail: Option<String>,
    ) -> Self {
        Self {
            node_type: node_type.into(),
            relation_name,
            cost,
            actual_time_ms: None,
            rows,
            detail,
            children: Vec::new(),
        }
    }
}
