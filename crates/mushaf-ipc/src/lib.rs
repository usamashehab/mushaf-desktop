//! The local socket an app's hook command and the app talk over: a Unix socket
//! in a folder only the user can open, or a named pipe on Windows. One request
//! per connection, as one line of JSON, answered by one line of JSON. Each app
//! ([`AppId`]) has its own socket and its own folder in the home folder.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::PathBuf;

use interprocess::local_socket::{prelude::*, Listener, ListenerOptions, Name, Stream};
use mushaf_protocol::{AgentEvent, AppId};
use serde::{Deserialize, Serialize};

/// A request longer than this is not ours.
const MAX_LINE: u64 = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Request {
    /// An agent's hook fired.
    Event(AgentEvent),
    /// Show the app, at a place when one is given (for the Mushaf: "50", "2:255", "البقرة").
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
    /// When the app opens for it, if it will.
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

/// Where the app's socket lives. `<ENV>_SOCKET` (`MUSHAF_SOCKET`) overrides it
/// (tests, several users' dev builds).
pub fn socket_path(app: &AppId) -> PathBuf {
    if let Some(path) = std::env::var_os(app.env_var("SOCKET")) {
        return PathBuf::from(path);
    }
    let slug = app.slug;
    #[cfg(windows)]
    {
        let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".into());
        let user: String = user.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
        PathBuf::from(format!(r"\\.\pipe\{slug}-{user}"))
    }
    #[cfg(not(windows))]
    {
        let file = format!("{slug}.sock");
        match std::env::var_os("XDG_RUNTIME_DIR").filter(|dir| !dir.is_empty()) {
            Some(dir) => PathBuf::from(dir).join(slug).join(file),
            None => app_dir(app).join("run").join(file),
        }
    }
}

/// The user's home folder.
pub fn home_dir() -> PathBuf {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}

/// The app's folder in the home folder: `~/.mushaf`.
pub fn app_dir(app: &AppId) -> PathBuf {
    home_dir().join(format!(".{}", app.slug))
}

/// Where the hooks keep the events the app missed while it wasn't running (a
/// task finishing, a session ending), one JSON event a line, for the app to
/// take when it starts.
pub fn missed_path(app: &AppId) -> PathBuf {
    app_dir(app).join("missed.jsonl")
}

/// Where the app keeps the tasks at work, to know them again after a restart.
pub fn sessions_path(app: &AppId) -> PathBuf {
    app_dir(app).join("sessions.json")
}

/// Where the app says where its program is, for the hook command to start it.
pub fn locator_path(app: &AppId) -> PathBuf {
    app_dir(app).join("locator.json")
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
pub fn send(app: &AppId, request: &Request) -> io::Result<Response> {
    let path = socket_path(app);
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
pub fn listen(app: &AppId) -> io::Result<Listener> {
    let path = socket_path(app);
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
    use mushaf_protocol::{Kind, MUSHAF};

    #[test]
    fn requests_round_trip_over_the_socket() {
        let dir = tempfile::tempdir().unwrap();
        #[cfg(unix)]
        std::env::set_var("MUSHAF_SOCKET", dir.path().join("run").join("test.sock"));
        #[cfg(windows)]
        std::env::set_var("MUSHAF_SOCKET", format!(r"\\.\pipe\mushaf-test-{}", std::process::id()));

        assert!(send(&MUSHAF, &Request::Status).is_err(), "nothing listens yet");

        let listener = listen(&MUSHAF).unwrap();
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

        let event = AgentEvent { v: 1, agent: "claude".into(), session: "s".into(), kind: Kind::Started, project: None, transcript: None, at: 1 };
        assert!(send(&MUSHAF, &Request::Event(event)).unwrap().ok);
        assert!(send(&MUSHAF, &Request::Open { place: Some("2:255".into()) }).unwrap().ok);
        assert_eq!(send(&MUSHAF, &Request::Status).unwrap().sessions, Some(vec![]));
    }

    #[test]
    fn each_app_has_its_own_socket_and_folder() {
        let other = AppId { slug: "goals", program: "goals-desktop", title: "Goals", env: "GOALS" };
        assert_ne!(socket_path(&MUSHAF), socket_path(&other));
        assert!(app_dir(&MUSHAF).ends_with(".mushaf"));
        assert!(missed_path(&other).ends_with(".goals/missed.jsonl"));
        assert!(sessions_path(&MUSHAF).ends_with(".mushaf/sessions.json"));
        #[cfg(not(windows))]
        assert!(socket_path(&other).ends_with("goals/goals.sock") || socket_path(&other).ends_with("run/goals.sock"));
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
