//! @file secrets.rs
//! @brief Operating-system backed credential storage for saved connection profiles.
//! @details Database and SSH secrets are kept in the platform secret store (Windows Credential
//! Manager, macOS Keychain, Linux Secret Service) instead of the webview's `localStorage`. The
//! frontend can write and delete secrets but can never read them back: only the backend resolves
//! them while opening a connection.

use crate::error::AppError;
use serde::{Deserialize, Serialize};

/// @brief Secret material associated with one saved connection profile.
/// @details Serialized as a single JSON document inside one secret-store entry per profile.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectionSecrets {
    /// @brief Database account password.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub db_password: Option<String>,
    /// @brief SSH bastion password.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_password: Option<String>,
    /// @brief Passphrase protecting the SSH private key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_passphrase: Option<String>,
}

impl ConnectionSecrets {
    /// @brief Indicates whether any secret value is present.
    /// @return `true` when at least one field holds a value.
    pub fn is_empty(&self) -> bool {
        self.db_password.is_none() && self.ssh_password.is_none() && self.ssh_passphrase.is_none()
    }
}

/// @brief Secret-store service name shared by every entry the application writes.
const SERVICE_NAME: &str = "com.dynodbmodeler.app";

/// @brief Builds the secret-store account name for a connection profile.
/// @param connection_id Saved connection profile identifier.
/// @return Account name used as the keyring user field.
fn account_name(connection_id: &str) -> String {
    format!("connection:{}", connection_id)
}

/// @brief Persists secrets for one connection profile.
/// @details An empty secret set removes any previously stored entry instead of writing a blank one.
/// @param connection_id Saved connection profile identifier.
/// @param secrets Secret material to store.
/// @return Ok(()) when stored or cleared.
#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
pub fn save(connection_id: &str, secrets: &ConnectionSecrets) -> Result<(), AppError> {
    if secrets.is_empty() {
        return delete(connection_id);
    }

    let entry = keyring::Entry::new(SERVICE_NAME, &account_name(connection_id))
        .map_err(|e| AppError::Internal(format!("Secret store unavailable: {}", e)))?;

    let payload = serde_json::to_string(secrets)
        .map_err(|e| AppError::Internal(format!("Failed to encode credentials: {}", e)))?;

    entry
        .set_password(&payload)
        .map_err(|e| AppError::Internal(format!("Failed to store credentials: {}", e)))
}

/// @brief Loads secrets for one connection profile.
/// @param connection_id Saved connection profile identifier.
/// @return Stored secrets, or `None` when no entry exists.
#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
pub fn load(connection_id: &str) -> Result<Option<ConnectionSecrets>, AppError> {
    let entry = keyring::Entry::new(SERVICE_NAME, &account_name(connection_id))
        .map_err(|e| AppError::Internal(format!("Secret store unavailable: {}", e)))?;

    match entry.get_password() {
        Ok(payload) => match serde_json::from_str::<ConnectionSecrets>(&payload) {
            Ok(secrets) => Ok(Some(secrets)),
            // A legacy or externally written value is treated as the raw database password.
            Err(_) => Ok(Some(ConnectionSecrets {
                db_password: Some(payload),
                ..Default::default()
            })),
        },
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Internal(format!(
            "Failed to read stored credentials: {}",
            e
        ))),
    }
}

/// @brief Removes stored secrets for one connection profile.
/// @param connection_id Saved connection profile identifier.
/// @return Ok(()) when removed or when no entry existed.
#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
pub fn delete(connection_id: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new(SERVICE_NAME, &account_name(connection_id))
        .map_err(|e| AppError::Internal(format!("Secret store unavailable: {}", e)))?;

    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Internal(format!(
            "Failed to delete stored credentials: {}",
            e
        ))),
    }
}

/// @brief Reports whether stored secrets exist for a connection profile.
/// @param connection_id Saved connection profile identifier.
/// @return `true` when an entry can be read.
#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
pub fn exists(connection_id: &str) -> bool {
    matches!(load(connection_id), Ok(Some(_)))
}

/// @brief Platforms without a supported secret store reject credential persistence explicitly.
/// @param _connection_id Saved connection profile identifier.
/// @param _secrets Secret material to store.
/// @return Always an AppError explaining the platform limitation.
#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn save(_connection_id: &str, _secrets: &ConnectionSecrets) -> Result<(), AppError> {
    Err(AppError::Internal(
        "No operating system secret store is available on this platform".to_string(),
    ))
}

/// @brief Platforms without a supported secret store never return stored secrets.
/// @param _connection_id Saved connection profile identifier.
/// @return Always `None`.
#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn load(_connection_id: &str) -> Result<Option<ConnectionSecrets>, AppError> {
    Ok(None)
}

/// @brief Platforms without a supported secret store have nothing to remove.
/// @param _connection_id Saved connection profile identifier.
/// @return Always Ok(()).
#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn delete(_connection_id: &str) -> Result<(), AppError> {
    Ok(())
}

/// @brief Platforms without a supported secret store never report stored secrets.
/// @param _connection_id Saved connection profile identifier.
/// @return Always `false`.
#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn exists(_connection_id: &str) -> bool {
    false
}

/// @brief Fills missing credential fields on a configuration from the secret store.
/// @details Values already supplied by the caller always win, so a password typed into the dialog
/// is never overwritten by a previously stored one.
/// @param config Connection configuration to complete in place.
/// @return Ok(()) when no secret store error occurred.
pub fn apply_to_config(
    config: &mut crate::model::connection::ConnectionConfig,
) -> Result<(), AppError> {
    let Some(stored) = load(&config.id)? else {
        return Ok(());
    };

    if config.password.is_none() {
        config.password = stored.db_password;
    }

    if let Some(tunnel) = config.ssh_tunnel.as_mut() {
        if tunnel.password.is_none() {
            tunnel.password = stored.ssh_password;
        }
        if tunnel.passphrase.is_none() {
            tunnel.passphrase = stored.ssh_passphrase;
        }
    }

    Ok(())
}
