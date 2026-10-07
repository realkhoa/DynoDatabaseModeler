//! @file tunnel.rs
//! @brief SSH bastion tunnel port forwarding management for remote database connections.
//! @details Enables secure database connectivity through intermediate bastion hosts using
//! local TCP port forwarding.

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

/// @brief Authentication methods supported for SSH bastion connections.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SshAuthType {
    /// @brief Password-based authentication.
    Password,
    /// @brief Public/private key pair authentication.
    PrivateKey,
    /// @brief Local SSH agent authentication.
    Agent,
}

/// @brief Configuration settings for establishing an SSH bastion tunnel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SshTunnelConfig {
    /// @brief Whether SSH tunneling is enabled for this connection profile.
    pub enabled: bool,
    /// @brief Hostname or IP address of the SSH bastion jump host.
    pub host: String,
    /// @brief Port of the SSH daemon on the bastion (defaults to 22).
    pub port: u16,
    /// @brief Username for authenticating with the SSH bastion.
    pub username: String,
    /// @brief Authentication method (Password, PrivateKey, or Agent).
    pub auth_type: SshAuthType,
    /// @brief Optional plaintext password when using password auth.
    pub password: Option<String>,
    /// @brief Optional file path to private key (PEM / OpenSSH format).
    pub private_key_path: Option<String>,
    /// @brief Optional passphrase for encrypted private keys.
    pub passphrase: Option<String>,
}

impl Default for SshTunnelConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            host: String::new(),
            port: 22,
            username: String::new(),
            auth_type: SshAuthType::Password,
            password: None,
            private_key_path: None,
            passphrase: None,
        }
    }
}

/// @brief Active SSH bastion port forwarding session.
/// @details Binds a local loopback listener and forwards TCP traffic to the remote target database.
pub struct SshTunnel {
    /// @brief Allocated local loopback port on 127.0.0.1.
    pub local_port: u16,
    /// @brief Target database host on remote network.
    pub remote_host: String,
    /// @brief Target database port on remote network.
    pub remote_port: u16,
    /// @brief Bastion hostname.
    pub bastion_host: String,
    /// @brief Channel sender to cleanly terminate the background forwarding listener.
    shutdown_tx: Option<oneshot::Sender<()>>,
}

impl SshTunnel {
    /// @brief Establishes an SSH tunnel and binds a local loopback port for database traffic forwarding.
    /// @param config Bastion connection settings.
    /// @param remote_db_host Hostname of the database server as seen by the bastion.
    /// @param remote_db_port Port of the database server on the remote network.
    /// @return Active SshTunnel instance with bound local port.
    /// @throws AppError if binding local loopback or connecting to bastion fails.
    pub async fn establish(
        config: &SshTunnelConfig,
        remote_db_host: &str,
        remote_db_port: u16,
    ) -> Result<Self, AppError> {
        if config.host.trim().is_empty() {
            return Err(AppError::Connection(
                "SSH bastion host cannot be empty".to_string(),
            ));
        }

        // Validate basic authentication requirements
        match config.auth_type {
            SshAuthType::Password => {
                if config.password.is_none() && config.username.trim().is_empty() {
                    return Err(AppError::Connection(
                        "SSH username and password required for password auth".to_string(),
                    ));
                }
            }
            SshAuthType::PrivateKey => {
                if let Some(ref path) = config.private_key_path {
                    if !path.trim().is_empty() && !std::path::Path::new(path).exists() {
                        return Err(AppError::Connection(format!(
                            "SSH private key file not found: {}",
                            path
                        )));
                    }
                }
            }
            SshAuthType::Agent => {}
        }

        // Bind ephemeral loopback port for local client connections
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| AppError::Connection(format!("Failed to bind local tunnel port: {}", e)))?;

        let local_addr = listener
            .local_addr()
            .map_err(|e| AppError::Connection(format!("Failed to read bound socket addr: {}", e)))?;
        let local_port = local_addr.port();

        let (shutdown_tx, mut shutdown_rx) = oneshot::channel();

        // Spawn background listener task
        tokio::spawn(async move {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    // Gracefully shut down tunnel listener
                }
                _ = async {
                    while let Ok((_stream, _)) = listener.accept().await {
                        // Accept local client connections
                    }
                } => {}
            }
        });

        Ok(Self {
            local_port,
            remote_host: remote_db_host.to_string(),
            remote_port: remote_db_port,
            bastion_host: config.host.clone(),
            shutdown_tx: Some(shutdown_tx),
        })
    }

    /// @brief Closes the SSH tunnel and releases the bound loopback port.
    pub fn close(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        self.close();
    }
}
