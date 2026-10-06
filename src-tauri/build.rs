/// @brief Build script executed by Cargo before compiling the crate.
/// @details Invokes tauri-build to prepare context, permissions, and icons.
fn main() {
    tauri_build::build();
}
