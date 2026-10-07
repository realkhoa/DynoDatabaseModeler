//! @file tunnel_test.rs
//! @brief Unit tests for SSH bastion tunnel configuration and port forwarding manager.

use super::tunnel::{SshAuthType, SshTunnel, SshTunnelConfig};

#[tokio::test]
async fn test_ssh_tunnel_config_default_and_serialization() {
    let config = SshTunnelConfig::default();
    assert!(!config.enabled);
    assert_eq!(config.port, 22);
    assert_eq!(config.auth_type, SshAuthType::Password);

    let json = serde_json::to_string(&config).expect("Serialize SSH config");
    let deserialized: SshTunnelConfig = serde_json::from_str(&json).expect("Deserialize SSH config");
    assert_eq!(config, deserialized);
}

#[tokio::test]
async fn test_ssh_tunnel_empty_host_fails() {
    let config = SshTunnelConfig {
        enabled: true,
        host: "   ".to_string(),
        ..Default::default()
    };

    let result = SshTunnel::establish(&config, "db.internal.net", 5432).await;
    assert!(result.is_err());
    let err = result.err().unwrap().to_string();
    assert!(err.contains("host cannot be empty"));
}

#[tokio::test]
async fn test_ssh_tunnel_invalid_private_key_path_fails() {
    let config = SshTunnelConfig {
        enabled: true,
        host: "bastion.example.com".to_string(),
        auth_type: SshAuthType::PrivateKey,
        private_key_path: Some("/nonexistent/path/to/key.pem".to_string()),
        ..Default::default()
    };

    let result = SshTunnel::establish(&config, "db.internal.net", 5432).await;
    assert!(result.is_err());
    let err = result.err().unwrap().to_string();
    assert!(err.contains("private key file not found"));
}

#[tokio::test]
async fn test_ssh_tunnel_establish_allocates_port_and_closes() {
    let config = SshTunnelConfig {
        enabled: true,
        host: "bastion.example.com".to_string(),
        username: "deploy".to_string(),
        password: Some("secret".to_string()),
        ..Default::default()
    };

    let mut tunnel = SshTunnel::establish(&config, "10.0.0.5", 3306)
        .await
        .expect("Establish tunnel");

    assert!(tunnel.local_port > 0);
    assert_eq!(tunnel.remote_host, "10.0.0.5");
    assert_eq!(tunnel.remote_port, 3306);
    assert_eq!(tunnel.bastion_host, "bastion.example.com");

    tunnel.close();
}
