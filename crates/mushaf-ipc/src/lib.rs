//! The local socket the `mushaf` command and the app talk over: a Unix socket in
//! a folder only the user can open, or a named pipe on Windows. One request per
//! connection, as one line of JSON, answered by one line of JSON.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::PathBuf;

use interprocess::local_socket::{prelude::*, Listener, ListenerOptions, Name, Stream};
use mushaf_protocol::AgentEvent;
use serde::{Deserialize, Serialize};

/// A request longer than this is not ours.
const MAX_LINE: u64 = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Request {
    /// An agent's hook fired.
    Event(AgentEvent),
    /// Show the Mushaf, at a place when one is given ("50", "2:255", "البقرة").
    Open {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        place: Option<String>,
    },
    /// What the app knows of the agents at work.
    Status,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub agent: String,
    pub session: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    /// ms since the epoch.
    pub started_at: u64,
    /// When the Mushaf opens for it, if it will.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opens_at: Option<u64>,
    pub opened: bool,
}

/// The last thing the app heard from an agent: how a user (or a test) sees its hooks work.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Heard {
    pub agent: String,
    pub kind: mushaf_protocol::Kind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    /// ms since the epoch.
    pub at: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Response {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sessions: Option<Vec<Session>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heard: Option<Vec<Heard>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

impl Response {
    pub fn ok() -> Self {
        Response { ok: true, ..Default::default() }
    }
    pub fn error(message: impl Into<String>) -> Self {
        Response { ok: false, error: Some(message.into()), ..Default::default() }
    }
}

/// Where the socket lives. `MUSHAF_SOCKET` overrides it (tests, several users' dev builds).
pub fn socket_path() -> PathBuf {
    if let Some(path) = std::env::var_os("MUSHAF_SOCKET") {
        return PathBuf::from(path);
    }
    #[cfg(windows)]
    {
        let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".into());
        let user: String = user.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
        PathBuf::from(format!(r"\\.\pipe\mushaf-{user}"))
    }
    #[cfg(not(windows))]
    {
        match std::env::var_os("XDG_RUNTIME_DIR").filter(|dir| !dir.is_empty()) {
            Some(dir) => PathBuf::from(dir).join("mushaf").join("mushaf.sock"),
            None => home_dir().join(".mushaf").join("run").join("mushaf.sock"),
        }
    }
}

/// The user's home folder.
pub fn home_dir() -> PathBuf {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}

fn name(path: &std::path::Path) -> io::Result<Name<'_>> {
    #[cfg(windows)]
    {
        use interprocess::local_socket::GenericNamespaced;
        let text = path.to_string_lossy();
        text.trim_start_matches(r"\\.\pipe\").to_owned().to_ns_name::<GenericNamespaced>()
    }
    #[cfg(not(windows))]
    {
        use interprocess::local_socket::GenericFilePath;
        path.to_fs_name::<GenericFilePath>()
    }
}

/// Sends one request and waits for the answer. Fails fast when nothing listens.
/// Callers that must not hang bound the whole call themselves (the CLI exits on a timer).
pub fn send(request: &Request) -> io::Result<Response> {
    let path = socket_path();
    let mut stream = Stream::connect(name(&path)?)?;
    let mut line = serde_json::to_vec(request)?;
    line.push(b'\n');
    stream.write_all(&line)?;
    stream.flush()?;
    let mut answer = String::new();
    BufReader::new(stream).take(MAX_LINE).read_line(&mut answer)?;
    serde_json::from_str(&answer).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

/// Starts listening, taking over a socket a crashed app left behind.
/// The socket's folder is made private to the user first.
pub fn listen() -> io::Result<Listener> {
    let path = socket_path();
    #[cfg(unix)]
    if let Some(dir) = path.parent() {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    ListenerOptions::new().name(name(&path)?).try_overwrite(true).create_sync()
}

/// Answers requests until the listener fails, one thread per connection so a
/// slow client never holds up the rest.
pub fn serve<F>(listener: Listener, handle: F)
where
    F: Fn(Request) -> Response + Send + Sync + 'static,
{
    let handle = std::sync::Arc::new(handle);
    for connection in listener.incoming() {
        let Ok(stream) = connection else { continue };
        let handle = handle.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stream);
            let mut line = String::new();
            if (&mut reader).take(MAX_LINE).read_line(&mut line).is_err() {
                return;
            }
            let response = match serde_json::from_str::<Request>(&line) {
                Ok(request) => handle(request),
                Err(error) => Response::error(format!("bad request: {error}")),
            };
            let mut out = serde_json::to_vec(&response).unwrap_or_default();
            out.push(b'\n');
            let _ = reader.get_mut().write_all(&out);
            let _ = reader.get_mut().flush();
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mushaf_protocol::Kind;

    #[test]
    fn requests_round_trip_over_the_socket() {
        let dir = tempfile::tempdir().unwrap();
        #[cfg(unix)]
        std::env::set_var("MUSHAF_SOCKET", dir.path().join("run").join("test.sock"));
        #[cfg(windows)]
        std::env::set_var("MUSHAF_SOCKET", format!(r"\\.\pipe\mushaf-test-{}", std::process::id()));

        assert!(send(&Request::Status).is_err(), "nothing listens yet");

        let listener = listen().unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.path().join("run")).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o700);
        }
        std::thread::spawn(move || {
            serve(listener, |request| match request {
                Request::Event(event) => Response { ok: event.kind == Kind::Started, ..Default::default() },
                Request::Open { place } => Response { ok: place.as_deref() == Some("2:255"), ..Default::default() },
                Request::Status => Response { sessions: Some(vec![]), ..Response::ok() },
            })
        });

        let event = AgentEvent { v: 1, agent: "claude".into(), session: "s".into(), kind: Kind::Started, project: None, at: 1 };
        assert!(send(&Request::Event(event)).unwrap().ok);
        assert!(send(&Request::Open { place: Some("2:255".into()) }).unwrap().ok);
        assert_eq!(send(&Request::Status).unwrap().sessions, Some(vec![]));
    }

    #[test]
    fn the_wire_format_is_tagged_json() {
        let open = serde_json::to_string(&Request::Open { place: None }).unwrap();
        assert_eq!(open, r#"{"type":"open"}"#);
        let event: Request = serde_json::from_str(
            r#"{"type":"event","v":1,"agent":"codex","session":"x","kind":"finished","at":3}"#,
        )
        .unwrap();
        assert!(matches!(event, Request::Event(AgentEvent { kind: Kind::Finished, .. })));
    }
}
