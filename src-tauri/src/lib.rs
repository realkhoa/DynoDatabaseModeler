//! @file lib.rs
//! @brief DynoDbModeler application core library entry point.

pub mod commands;
pub mod diff;
pub mod driver;
pub mod error;
pub mod model;
pub mod state;

#[cfg(test)]
mod commands_test;

/// @brief Initializes and executes the DynoDbModeler desktop application runtime.
/// @details Sets up Tauri plugins, state management, and command handlers.
/// @return Returns unit type `()` on normal termination or panics on critical initialization failure.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::cmd_test_connection,
            commands::cmd_connect,
            commands::cmd_introspect_schema,
            commands::cmd_compute_diff,
            commands::cmd_generate_ddl,
            commands::cmd_execute_migration,
            commands::cmd_execute_query,
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
