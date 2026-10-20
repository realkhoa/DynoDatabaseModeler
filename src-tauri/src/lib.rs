//! @file lib.rs
//! @brief DynoDbModeler application core library entry point.

use tauri::Manager;

pub mod commands;
pub mod diff;
pub mod driver;
pub mod error;
pub mod model;
pub mod state;
pub mod storage;

#[cfg(test)]
mod commands_test;

/// @brief Initializes and executes the DynoDbModeler desktop application runtime.
/// @details Sets up Tauri plugins, state management, local storage location, and command handlers.
/// @return Returns unit type `()` on normal termination or panics on critical initialization failure.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::cmd_test_connection,
            commands::cmd_connect,
            commands::cmd_introspect_schema,
            commands::cmd_get_primary_keys,
            commands::cmd_compute_diff,
            commands::cmd_generate_ddl,
            commands::cmd_execute_migration,
            commands::cmd_execute_query,
            commands::cmd_disconnect,
            commands::cmd_update_rows,
            commands::cmd_explain_query,
            commands::cmd_record_query_history,
            commands::cmd_get_query_history,
            commands::cmd_toggle_favorite_query,
            commands::cmd_clear_query_history,
            commands::cmd_list_databases,
            commands::cmd_list_active_databases,
            commands::cmd_switch_database,
            commands::cmd_save_connection_secrets,
            commands::cmd_delete_connection_secrets,
            commands::cmd_has_connection_secrets,
        ])
        .setup(|app| {
            // Persist query history inside the application data directory so it survives restarts.
            let state = app.state::<state::AppState>();
            match app.path().app_data_dir() {
                Ok(dir) => state.configure_storage(dir),
                Err(err) => eprintln!(
                    "DynoDbModeler: app data directory unavailable ({}); falling back to a temporary storage directory",
                    err
                ),
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
