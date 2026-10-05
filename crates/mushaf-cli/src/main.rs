//! `mushaf`: what agents' hooks run, and a way to open the Mushaf from a terminal.
//!
//! `mushaf hook <agent>` must never slow an agent down or fail its turn: it reads
//! the hook's payload, passes on the little the app needs, and always exits 0,
//! silently, within a few seconds at most.

use std::io::{IsTerminal, Read};
use std::path::PathBuf;
use std::process::{Command, ExitCode, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use mushaf_ipc::{home_dir, send, Request, Response};
use mushaf_protocol::{normalize, Kind};

/// println! that doesn't panic when the reader has gone (`mushaf status | head -1`).
macro_rules! say {
    ($($arg:tt)*) => {{
        use std::io::Write;
        let _ = writeln!(std::io::stdout(), $($arg)*);
    }};
}

const USAGE: &str = "\
mushaf — the Madinah Mushaf, opened while your coding agent works

Usage:
  mushaf open [place]                      Show the Mushaf: a page (50), an ayah (2:255) or a surah (البقرة)
  mushaf status                            The agents at work, and when the Mushaf opens for them
  mushaf integrations [list]               Which agents have the Mushaf's hooks
  mushaf integrations install [agent]      Add the hooks to Claude Code, Codex, or every agent found
  mushaf integrations uninstall [agent]    Take them out again (your own hooks stay)
  mushaf hook <agent> [started|finished|attention|ended]
                                           What an agent's hook runs; reads the hook's JSON on stdin
  mushaf --version";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match args.as_slice() {
        ["hook", agent, rest @ ..] => {
            hook(agent, rest.first().copied());
            ExitCode::SUCCESS
        }
        ["open", place @ ..] => open((!place.is_empty()).then(|| place.join(" "))),
        ["status"] => status(),
        ["integrations"] | ["integrations", "list"] => integrations_list(),
        ["integrations", action @ ("install" | "uninstall"), agent @ ..] => integrations(action, agent.first().copied()),
        ["--version" | "-V" | "version"] => {
            say!("mushaf {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        [] | ["help" | "--help" | "-h", ..] => {
            say!("{USAGE}");
            ExitCode::SUCCESS
        }
        _ => {
            eprintln!("{USAGE}");
            ExitCode::from(2)
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Ends the process after `limit`, whatever it is waiting on.
fn deadline(limit: Duration, code: i32) {
    std::thread::spawn(move || {
        std::thread::sleep(limit);
        std::process::exit(code);
    });
}

fn hook(agent: &str, kind: Option<&str>) {
    deadline(Duration::from_secs(3), 0);
    let mut payload = String::new();
    let stdin = std::io::stdin();
    if !stdin.is_terminal() {
        let _ = stdin.lock().take(1 << 20).read_to_string(&mut payload);
    }
    let payload = serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null);
    let forced = kind.and_then(Kind::parse);
    let Some(event) = normalize(agent, &payload, forced, now_ms()) else { return };
    let starts = event.kind == Kind::Started;
    let request = Request::Event(event);
    if send(&request).is_ok() || !starts {
        // Only a starting task wakes the app: an end with nothing open has nothing to show.
        return;
    }
    if launch_app(true).is_ok() {
        let _ = send_until(&request, Instant::now() + Duration::from_millis(2500));
    }
}

/// Retries while the app starts up.
fn send_until(request: &Request, until: Instant) -> std::io::Result<Response> {
    loop {
        match send(request) {
            Ok(response) => return Ok(response),
            Err(error) if Instant::now() >= until => return Err(error),
            Err(_) => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}

fn app_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("MUSHAF_APP") {
        return Some(PathBuf::from(path));
    }
    let name = if cfg!(windows) { "mushaf-desktop.exe" } else { "mushaf-desktop" };
    let beside = std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.join(name)));
    if let Some(path) = beside.filter(|path| path.is_file()) {
        return Some(path);
    }
    // Where the app last said it lives.
    let locator = std::fs::read(home_dir().join(".mushaf").join("locator.json")).ok()?;
    let locator: serde_json::Value = serde_json::from_slice(&locator).ok()?;
    locator.get("app").and_then(|app| app.as_str()).map(PathBuf::from).filter(|path| path.is_file())
}

/// Starts the app on its own, so it outlives this hook and the agent's terminal.
fn launch_app(background: bool) -> std::io::Result<()> {
    let path = app_path().ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "the Mushaf app is not installed"))?;
    let mut command = Command::new(path);
    if background {
        command.arg("--background");
    }
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    command.spawn().map(drop)
}

fn open(place: Option<String>) -> ExitCode {
    deadline(Duration::from_secs(20), 1);
    let request = Request::Open { place };
    let response = match send(&request) {
        Ok(response) => Ok(response),
        Err(_) => match launch_app(true) {
            Ok(()) => send_until(&request, Instant::now() + Duration::from_secs(15)),
            Err(error) => Err(error),
        },
    };
    match response {
        Ok(Response { ok: true, .. }) => ExitCode::SUCCESS,
        Ok(Response { error, .. }) => {
            eprintln!("mushaf: {}", error.unwrap_or_else(|| "the Mushaf could not open there".into()));
            ExitCode::FAILURE
        }
        Err(error) => {
            eprintln!("mushaf: could not reach the Mushaf app ({error})");
            ExitCode::FAILURE
        }
    }
}

fn minutes(ms: u64) -> String {
    let minutes = ms / 60_000;
    if minutes == 0 {
        format!("{}s", ms / 1000)
    } else {
        format!("{minutes} min")
    }
}

fn status() -> ExitCode {
    deadline(Duration::from_secs(5), 1);
    let Ok(response) = send(&Request::Status) else {
        say!("The Mushaf app is not running.");
        return ExitCode::SUCCESS;
    };
    say!("The Mushaf app {} is running.", response.version.unwrap_or_default());
    let now = now_ms();
    for heard in response.heard.unwrap_or_default() {
        let project = heard.project.map(|p| format!(" on {p}")).unwrap_or_default();
        let kind = format!("{:?}", heard.kind).to_lowercase();
        let name = mushaf_protocol::agent_name(&heard.agent);
        say!("Last heard from {name}: {kind}{project}, {} ago.", minutes(now.saturating_sub(heard.at)));
    }
    let sessions = response.sessions.unwrap_or_default();
    if sessions.is_empty() {
        say!("No agent is at work.");
    }
    for session in sessions {
        let project = session.project.map(|p| format!(" on {p}")).unwrap_or_default();
        let when = match (session.opened, session.opens_at) {
            (true, _) => "the Mushaf opened for it".to_owned(),
            (false, Some(at)) if at > now => format!("the Mushaf opens in {}", minutes(at - now)),
            (false, Some(_)) => "the Mushaf opens now".to_owned(),
            (false, None) => "the Mushaf won't open for it".to_owned(),
        };
        let name = mushaf_protocol::agent_name(&session.agent);
        say!("  {name}{project}: working for {} — {when}", minutes(now.saturating_sub(session.started_at)));
    }
    ExitCode::SUCCESS
}

fn cli_path() -> PathBuf {
    std::env::current_exe().and_then(|exe| exe.canonicalize()).unwrap_or_else(|_| PathBuf::from("mushaf"))
}

fn integrations_list() -> ExitCode {
    let home = home_dir();
    let cli = cli_path();
    for agent in mushaf_agents::AGENTS {
        let status = match agent.status(&home, &cli) {
            Ok(mushaf_agents::Status::Missing) => "not installed on this machine".to_owned(),
            Ok(mushaf_agents::Status::Off) => "off".to_owned(),
            Ok(mushaf_agents::Status::On) => format!("on ({})", agent.config_path(&home).display()),
            Ok(mushaf_agents::Status::Stale) => "on, but out of date: run `mushaf integrations install`".to_owned(),
            Err(error) => format!("unreadable: {error}"),
        };
        say!("{:<12} {status}", agent.name);
    }
    ExitCode::SUCCESS
}

fn integrations(action: &str, id: Option<&str>) -> ExitCode {
    let home = home_dir();
    let cli = cli_path();
    let agents: Vec<_> = match id {
        Some(id) => match mushaf_agents::find(id) {
            Some(agent) => vec![agent],
            None => {
                eprintln!("mushaf: no agent called {id}; try claude or codex");
                return ExitCode::from(2);
            }
        },
        None => mushaf_agents::AGENTS.iter().copied().filter(|agent| agent.detect(&home)).collect(),
    };
    if agents.is_empty() {
        say!("No coding agent found (looked for Claude Code and Codex).");
        return ExitCode::SUCCESS;
    }
    let mut failed = false;
    for agent in agents {
        let result = if action == "install" { agent.install(&home, &cli) } else { agent.uninstall(&home) };
        match result {
            Ok(changed) => {
                let done = match (action, changed) {
                    ("install", true) => "hooks added",
                    ("install", false) => "hooks already in place",
                    (_, true) => "hooks removed",
                    (_, false) => "had no Mushaf hooks",
                };
                say!("{}: {done} ({})", agent.name, agent.config_path(&home).display());
                if action == "install" {
                    if let Some(note) = agent.note {
                        say!("  {note}");
                    }
                }
            }
            Err(error) => {
                failed = true;
                eprintln!("{}: {error}", agent.name);
            }
        }
    }
    if failed {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}
