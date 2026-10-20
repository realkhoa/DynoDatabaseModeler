//! @file tunnel.rs
//! @brief SSH bastion tunnel port forwarding management for remote database connections.
//! @details Implements real SSH port forwarding: a loopback listener is bound locally and every
//! accepted client connection opens an SSH `direct-tcpip` channel through the bastion to the
//! database endpoint, then copies bytes in both directions.

use crate::error::AppError;
use russh::client;
use russh::keys::{
    check_known_hosts, load_secret_key, PrivateKeyWithHashAlg, PublicKeyOrCertificate,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::copy_bidirectional;
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

/// @brief SSH client event handler.
/// @details Host keys are verified against the user's `known_hosts` file. A key that was previously
/// recorded and has since changed aborts the connection (man-in-the-middle protection); a host that
/// has no entry yet is accepted on first use.
struct ClientHandler {
    /// @brief Bastion host name, used for known-hosts lookups.
    host: String,
    /// @brief Bastion port, used for known-hosts lookups.
    port: u16,
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    /// @brief Verifies the bastion's public key against the local known-hosts store.
    /// @param server_public_key Public key presented by the bastion.
    /// @return `Ok(true)` to accept the connection, `Ok(false)` to refuse it.
    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let key: russh::keys::PublicKey = match server_public_key {
            PublicKeyOrCertificate::PublicKey { key, .. } => key.clone(),
            PublicKeyOrCertificate::Certificate(cert) => cert.public_key().clone().into(),
        };

        match check_known_hosts(&self.host, self.port, &key) {
            // Recorded and still matching.
            Ok(true) => Ok(true),
            // No entry for this host yet: trust on first use, matching OpenSSH's default behaviour.
            Ok(false) => Ok(true),
            // A previously recorded key changed: refuse, this is the man-in-the-middle signal.
            Err(russh::keys::Error::KeyChanged { .. }) => Ok(false),
            // Unreadable or absent known_hosts file: do not block connectivity on it.
            Err(_) => Ok(true),
        }
    }
}

/// @brief Active SSH bastion port forwarding session.
/// @details Owns a loopback listener plus the SSH session that carries forwarded traffic. Dropping
/// the tunnel shuts the listener down, which is why the owning connection must keep it alive.
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
    /// @brief Background task running the accept loop and owning the SSH session.
    listener_task: Option<tokio::task::JoinHandle<()>>,
}

impl SshTunnel {
    /// @brief Establishes an SSH tunnel and binds a local loopback port for database traffic forwarding.
    /// @details Performs the SSH handshake with a bounded timeout, authenticates, then starts an
    /// accept loop that opens one `direct-tcpip` channel per local connection.
    /// @param config Bastion connection settings.
    /// @param remote_db_host Hostname of the database server as seen by the bastion.
    /// @param remote_db_port Port of the database server on the remote network.
    /// @return Active SshTunnel instance with bound local port.
    /// @throws AppError if validation, the SSH handshake, authentication or binding fails.
    pub async fn establish(
        config: &SshTunnelConfig,
        remote_db_host: &str,
        remote_db_port: u16,
    ) -> Result<Self, AppError> {
        Self::validate(config)?;

        let ssh_config = Arc::new(client::Config {
            inactivity_timeout: Some(Duration::from_secs(600)),
            ..Default::default()
        });

        let handler = ClientHandler {
            host: config.host.trim().to_string(),
            port: config.port,
        };

        let connect_future = client::connect(
            ssh_config,
            (config.host.trim().to_string(), config.port),
            handler,
        );

        let mut session = tokio::time::timeout(Duration::from_secs(15), connect_future)
            .await
            .map_err(|_| {
                AppError::Connection(format!(
                    "SSH handshake with bastion {}:{} timed out after 15s",
                    config.host, config.port
                ))
            })?
            .map_err(|e| {
                AppError::Connection(format!(
                    "SSH connection to bastion {}:{} failed: {}",
                    config.host, config.port, e
                ))
            })?;

        Self::authenticate(&mut session, config).await?;

        // Bind the loopback listener only after the SSH session is usable.
        let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| {
            AppError::Connection(format!("Failed to bind local tunnel port: {}", e))
        })?;

        let local_port = listener
            .local_addr()
            .map_err(|e| AppError::Connection(format!("Failed to read bound socket addr: {}", e)))?
            .port();

        let (shutdown_tx, mut shutdown_rx) = oneshot::channel();
        let session = Arc::new(session);
        let remote_host = remote_db_host.to_string();

        let listener_task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => break,
                    accepted = listener.accept() => {
                        let Ok((client_stream, peer)) = accepted else { break };
                        let session = session.clone();
                        let remote_host = remote_host.clone();
                        tokio::spawn(async move {
                            let target = remote_host.clone();
                            match session
                                .channel_open_direct_tcpip(
                                    remote_host,
                                    u32::from(remote_db_port),
                                    "127.0.0.1",
                                    u32::from(peer.port()),
                                )
                                .await
                            {
                                Ok(channel) => {
                                    let mut remote_stream = channel.into_stream();
                                    let mut client_stream = client_stream;
                                    let _ = copy_bidirectional(&mut client_stream, &mut remote_stream).await;
                                }
                                Err(err) => {
                                    eprintln!(
                                        "DynoDbModeler: SSH forwarding to {}:{} failed: {}",
                                        target, remote_db_port, err
                                    );
                                }
                            }
                        });
                    }
                }
            }
        });

        Ok(Self {
            local_port,
            remote_host: remote_db_host.to_string(),
            remote_port: remote_db_port,
            bastion_host: config.host.clone(),
            shutdown_tx: Some(shutdown_tx),
            listener_task: Some(listener_task),
        })
    }

    /// @brief Validates bastion configuration before any network activity.
    /// @param config Bastion connection settings.
    /// @return Ok(()) when the configuration is usable.
    fn validate(config: &SshTunnelConfig) -> Result<(), AppError> {
        if config.host.trim().is_empty() {
            return Err(AppError::Config(
                "SSH bastion host cannot be empty".to_string(),
            ));
        }
        if config.username.trim().is_empty() {
            return Err(AppError::Config(
                "SSH bastion username cannot be empty".to_string(),
            ));
        }

        match config.auth_type {
            SshAuthType::Password => {
                if config.password.as_deref().unwrap_or("").is_empty() {
                    return Err(AppError::Config(
                        "SSH password is required for password authentication".to_string(),
                    ));
                }
            }
            SshAuthType::PrivateKey => {
                let path = config.private_key_path.as_deref().unwrap_or("").trim();
                if path.is_empty() {
                    return Err(AppError::Config(
                        "SSH private key path is required for key authentication".to_string(),
                    ));
                }
                if !std::path::Path::new(path).exists() {
                    return Err(AppError::Config(format!(
                        "SSH private key file not found: {}",
                        path
                    )));
                }
            }
            SshAuthType::Agent => {
                return Err(AppError::Config(
                    "SSH agent authentication is not supported by this build; use a password or a \
                     private key file."
                        .to_string(),
                ));
            }
        }

        Ok(())
    }

    /// @brief Authenticates the SSH session with the configured method.
    /// @param session Connected SSH session handle.
    /// @param config Bastion connection settings.
    /// @return Ok(()) when authentication is accepted.
    async fn authenticate(
        session: &mut russh::client::Handle<ClientHandler>,
        config: &SshTunnelConfig,
    ) -> Result<(), AppError> {
        let user = config.username.trim().to_string();

        let result = match config.auth_type {
            SshAuthType::Password => session
                .authenticate_password(user, config.password.clone().unwrap_or_default())
                .await
                .map_err(|e| AppError::Connection(format!("SSH authentication failed: {}", e)))?,
            SshAuthType::PrivateKey => {
                let key = load_secret_key(
                    config.private_key_path.as_deref().unwrap_or_default(),
                    config.passphrase.as_deref(),
                )
                .map_err(|e| {
                    AppError::Connection(format!("Failed to load SSH private key: {}", e))
                })?;

                let hash_alg = session
                    .best_supported_rsa_hash()
                    .await
                    .ok()
                    .flatten()
                    .flatten();
                let key = PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg);

                session
                    .authenticate_publickey(user, key)
                    .await
                    .map_err(|e| {
                        AppError::Connection(format!("SSH authentication failed: {}", e))
                    })?
            }
            SshAuthType::Agent => {
                return Err(AppError::Config(
                    "SSH agent authentication is not supported by this build".to_string(),
                ));
            }
        };

        if result.success() {
            Ok(())
        } else {
            Err(AppError::Connection(
                "SSH bastion rejected the supplied credentials".to_string(),
            ))
        }
    }

    /// @brief Closes the SSH tunnel and releases the bound loopback port.
    pub fn close(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        if let Some(task) = self.listener_task.take() {
            task.abort();
        }
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        self.close();
    }
}
