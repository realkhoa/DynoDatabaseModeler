/// @brief Initializes and executes the DynoDbModeler desktop application runtime.
/// @details Sets up Tauri plugins, state management, and command handlers.
/// @return Returns unit type `()` on normal termination or panics on critical initialization failure.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
