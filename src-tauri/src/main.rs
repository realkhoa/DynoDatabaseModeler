// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// @brief Main entry point for DynoDbModeler application binary.
/// @return Returns unit type `()`, process lifecycle managed by Tauri runtime.
fn main() {
    dyno_db_modeler_lib::run();
}
