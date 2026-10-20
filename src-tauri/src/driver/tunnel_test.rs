//! @file tunnel_test.rs
//! @brief Unit and integration tests for the SSH bastion tunnel.
//! @details Covers configuration validation, genuine SSH protocol failure reporting, and a real
//! end-to-end forwarding test that runs an in-process SSH server plus a TCP echo server and pushes
//! bytes through the tunnel.

use super::tunnel::{SshAuthType, SshTunnel, SshTunnelConfig};

use russh::server::Server;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// @brief Operating-system backed random source for the test SSH host key.
struct TestRng;

impl rand_core::TryRng for TestRng {
    type Error = core::convert::Infallible;

    fn try_next_u32(&mut self) -> Result<u32, Self::Error> {
        let mut bytes = [0u8; 4];
        getrandom::fill(&mut bytes).expect("operating system randomness");
        Ok(u32::from_le_bytes(bytes))
    }

    fn try_next_u64(&mut self) -> Result<u64, Self::Error> {
        let mut bytes = [0u8; 8];
        getrandom::fill(&mut bytes).expect("operating system randomness");
        Ok(u64::from_le_bytes(bytes))
    }

    fn try_fill_bytes(&mut self, dest: &mut [u8]) -> Result<(), Self::Error> {
        getrandom::fill(dest).expect("operating system randomness");
        Ok(())
    }
}

impl rand_core::TryCryptoRng for TestRng {}

#[tokio::test]
async fn test_ssh_tunnel_config_default_and_serialization() {
    let config = SshTunnelConfig::default();
    assert!(!config.enabled);
    assert_eq!(config.port, 22);
    assert_eq!(config.auth_type, SshAuthType::Password);

    let json = serde_json::to_string(&config).expect("Serialize SSH config");
    let deserialized: SshTunnelConfig =
        serde_json::from_str(&json).expect("Deserialize SSH config");
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
    assert!(
        err.contains("host cannot be empty"),
        "unexpected error: {err}"
    );
}

#[tokio::test]
async fn test_ssh_tunnel_invalid_private_key_path_fails() {
    let config = SshTunnelConfig {
        enabled: true,
        host: "bastion.example.com".to_string(),
        username: "deploy".to_string(),
        auth_type: SshAuthType::PrivateKey,
        private_key_path: Some("/nonexistent/path/to/key.pem".to_string()),
        ..Default::default()
    };

    let result = SshTunnel::establish(&config, "db.internal.net", 5432).await;
    assert!(result.is_err());
    let err = result.err().unwrap().to_string();
    assert!(
        err.contains("private key file not found"),
        "unexpected error: {err}"
    );
}

#[tokio::test]
async fn test_ssh_tunnel_missing_password_fails_validation() {
    let config = SshTunnelConfig {
        enabled: true,
        host: "bastion.example.com".to_string(),
        username: "deploy".to_string(),
        auth_type: SshAuthType::Password,
        password: None,
        ..Default::default()
    };

    let result = SshTunnel::establish(&config, "db.internal.net", 5432).await;
    assert!(result.is_err());
    assert!(result
        .err()
        .unwrap()
        .to_string()
        .contains("SSH password is required"));
}

#[tokio::test]
async fn test_ssh_tunnel_agent_auth_is_rejected_explicitly() {
    let config = SshTunnelConfig {
        enabled: true,
        host: "bastion.example.com".to_string(),
        username: "deploy".to_string(),
        auth_type: SshAuthType::Agent,
        ..Default::default()
    };

    let result = SshTunnel::establish(&config, "db.internal.net", 5432).await;
    assert!(result.is_err());
    assert!(result
        .err()
        .unwrap()
        .to_string()
        .contains("agent authentication is not supported"));
}

#[tokio::test]
async fn test_ssh_tunnel_reports_real_protocol_failure() {
    // A plain TCP listener that never speaks SSH: the tunnel must fail with a real SSH handshake
    // error instead of silently binding a useless local port.
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");

    let config = SshTunnelConfig {
        enabled: true,
        host: "127.0.0.1".to_string(),
        port: addr.port(),
        username: "deploy".to_string(),
        password: Some("secret".to_string()),
        ..Default::default()
    };

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        SshTunnel::establish(&config, "db.internal.net", 5432),
    )
    .await
    .expect("establish must not hang");

    assert!(result.is_err(), "connecting to a non-SSH port must fail");
    let message = result.err().unwrap().to_string();
    assert!(
        message.contains("SSH connection to bastion") || message.contains("SSH handshake"),
        "unexpected error: {message}"
    );
}

/// @brief In-process SSH server used to exercise real forwarding.
struct TestSshServer;

/// @brief SSH server handler accepting one fixed credential pair and forwarding TCP channels.
struct TestSshHandler;

impl russh::server::Handler for TestSshHandler {
    type Error = russh::Error;

    /// @brief Accepts the test credential pair only.
    async fn auth_password(
        &mut self,
        user: &str,
        password: &str,
    ) -> Result<russh::server::Auth, Self::Error> {
        if user == "tester" && password == "secret" {
            Ok(russh::server::Auth::Accept)
        } else {
            Ok(russh::server::Auth::reject())
        }
    }

    /// @brief Accepts a `direct-tcpip` request and pipes it to the requested destination.
    async fn channel_open_direct_tcpip(
        &mut self,
        channel: russh::Channel<russh::server::Msg>,
        host_to_connect: &str,
        port_to_connect: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: russh::server::ChannelOpenHandle,
        _session: &mut russh::server::Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;

        let target = format!("{}:{}", host_to_connect, port_to_connect);
        tokio::spawn(async move {
            if let Ok(mut upstream) = TcpStream::connect(&target).await {
                let mut stream = channel.into_stream();
                let _ = tokio::io::copy_bidirectional(&mut stream, &mut upstream).await;
            }
        });

        Ok(())
    }
}

impl russh::server::Server for TestSshServer {
    type Handler = TestSshHandler;

    /// @brief Creates a handler for each connecting client.
    fn new_client(&mut self, _peer_addr: Option<std::net::SocketAddr>) -> TestSshHandler {
        TestSshHandler
    }
}

/// @brief Starts a TCP echo server that returns every byte it receives.
/// @return Port the echo server listens on.
async fn start_echo_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind echo");
    let port = listener.local_addr().expect("echo addr").port();

    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            tokio::spawn(async move {
                let mut buffer = [0u8; 64];
                loop {
                    match socket.read(&mut buffer).await {
                        Ok(0) | Err(_) => break,
                        Ok(read) => {
                            if socket.write_all(&buffer[..read]).await.is_err() {
                                break;
                            }
                        }
                    }
                }
            });
        }
    });

    port
}

/// @brief Verifies that bytes written to the tunnel's loopback port reach the remote target and echo back.
#[tokio::test]
async fn test_ssh_tunnel_forwards_traffic_end_to_end() {
    let echo_port = start_echo_server().await;

    // Start an in-process SSH server acting as the bastion.
    let ssh_listener = TcpListener::bind("127.0.0.1:0").await.expect("bind ssh");
    let ssh_port = ssh_listener.local_addr().expect("ssh addr").port();

    let host_key = russh::keys::PrivateKey::random(&mut TestRng, russh::keys::Algorithm::Ed25519)
        .expect("generate host key");

    let server_config = Arc::new(russh::server::Config {
        keys: vec![host_key],
        ..Default::default()
    });

    let mut server = TestSshServer;
    let mut running = server.run_on_socket(server_config, &ssh_listener);
    let shutdown = running.handle();

    // The server future borrows the listener, so it is driven in this task alongside the client
    // work instead of being spawned; tunnel side tasks still run on the runtime.
    let client_work = async {
        let config = SshTunnelConfig {
            enabled: true,
            host: "127.0.0.1".to_string(),
            port: ssh_port,
            username: "tester".to_string(),
            auth_type: SshAuthType::Password,
            password: Some("secret".to_string()),
            ..Default::default()
        };

        let tunnel = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            SshTunnel::establish(&config, "127.0.0.1", echo_port),
        )
        .await
        .expect("establish must not hang")
        .unwrap_or_else(|err| panic!("tunnel must be established: {err}"));

        assert!(tunnel.local_port > 0);
        assert_eq!(tunnel.remote_host, "127.0.0.1");
        assert_eq!(tunnel.remote_port, echo_port);
        assert_eq!(tunnel.bastion_host, "127.0.0.1");

        // Push bytes through the tunnel; the echo server proves the channel reached the target.
        let payload = b"ping-through-bastion";
        let mut client = TcpStream::connect(("127.0.0.1", tunnel.local_port))
            .await
            .expect("connect to tunnel port");
        client.write_all(payload).await.expect("write");

        let mut buffer = vec![0u8; payload.len()];
        tokio::time::timeout(
            std::time::Duration::from_secs(20),
            client.read_exact(&mut buffer),
        )
        .await
        .expect("read must not hang")
        .expect("read echoed bytes");
        assert_eq!(&buffer, payload);
    };

    tokio::select! {
        () = client_work => {}
        _ = &mut running => panic!("in-process SSH server stopped before forwarding completed"),
    }

    shutdown.shutdown("test complete".to_string());
}
