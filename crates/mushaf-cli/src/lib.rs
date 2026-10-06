//! An app's hook program (`mushaf` for the Mushaf): what agents' hooks run, and
//! a way to open the app from a terminal. Each app builds its own program from
//! [`run`], with its own [`AppId`].
//!
//! `<program> hook <agent>` must never slow an agent down or fail its turn: it
//! reads the hook's payload, passes on the little the app needs, and always
//! exits 0, silently, within a few seconds at most.

use std::io::{IsTerminal, Read};
use std::path::PathBuf;
use std::process::{Command, ExitCode, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use mushaf_ipc::{home_dir, Request, Response};
use mushaf_protocol::{normalize, AppId, Kind};

/// println! that doesn't panic when the reader has gone (`mushaf status | head -1`).
macro_rules! say {
    ($($arg:tt)*) => {{
        use std::io::Write;
        let _ = writeln!(std::io::stdout(), $($arg)*);
    }};
}

/// What the program prints for `help`: the app's own lines, then the ones every app shares.
fn usage(app: &AppId, about: &str, open_help: &str) -> String {
    let slug = app.slug;
    let title = app.title;
    let lines = [
        (format!("{slug} open [place]"), open_help.to_owned()),
        (format!("{slug} status"), format!("The agents at work, and when {title} opens for them")),
        (format!("{slug} integrations [list]"), format!("Which agents have {title}'s hooks")),
        (
            format!("{slug} integrations install [agent]"),
            "Add the hooks to one agent (claude, codex, cursor, opencode,\n                                           agy, deepseek), or to every agent found".to_owned(),
        ),
        (format!("{slug} integrations uninstall [agent]"), "Take them out again (your own hooks stay)".to_owned()),
    ];
    let mut text = format!("{slug} — {about}\n\nUsage:\n");
    for (command, help) in lines {
        text += &format!("  {command:<39}  {help}\n");
    }
    text += &format!("  {slug} hook <agent> [started|finished|attention|ended]\n");
    text += "                                           What an agent's hook runs; reads the hook's JSON on stdin\n";
    text += &format!("  {slug} --version");
    text
}

/// Runs the hook program of `app`. `about` says in a few words what the app is;
/// `open_help` what `open [place]` does in it. `version` is the app's version.
pub fn run(app: &AppId, about: &str, open_help: &str, version: &str) -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match args.as_slice() {
        ["hook", agent, rest @ ..] => {
            hook(app, agent, rest.first().copied());
            ExitCode::SUCCESS
        }
        ["open", place @ ..] => open(app, (!place.is_empty()).then(|| place.join(" "))),
        ["status"] => status(app),
        ["integrations"] | ["integrations", "list"] => integrations_list(app),
        ["integrations", action @ ("install" | "uninstall"), agent @ ..] => integrations(app, action, agent.first().copied()),
        ["--version" | "-V" | "version"] => {
            say!("{} {version}", app.slug);
            ExitCode::SUCCESS
        }
        [] | ["help" | "--help" | "-h", ..] => {
            say!("{}", usage(app, about, open_help));
            ExitCode::SUCCESS
        }
        _ => {
            eprintln!("{}", usage(app, about, open_help));
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

fn hook(app: &AppId, agent: &str, kind: Option<&str>) {
    deadline(Duration::from_secs(3), 0);
    let mut payload = String::new();
    let stdin = std::io::stdin();
    if !stdin.is_terminal() {
        let _ = stdin.lock().take(1 << 20).read_to_string(&mut payload);
    }
    let mut payload = serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null);
    if agent == "agy" {
        // Antigravity waits for a JSON answer; an empty one changes nothing.
        say!("{{}}");
        // No hook tells of a task stopped with Esc, but the CLI's log does.
        let conversation = payload.get("conversationId").and_then(|id| id.as_str()).unwrap_or_default();
        if let Some(log) = agy_log(conversation) {
            payload["transcript_path"] = serde_json::Value::String(log.to_string_lossy().into_owned());
        }
    }
    if agent == "deepseek" {
        // DeepSeek TUI says which session and folder in its environment, not on stdin.
        if !payload.is_object() {
            payload = serde_json::json!({});
        }
        for (key, variable) in [("session_id", "DEEPSEEK_SESSION_ID"), ("workspace", "DEEPSEEK_WORKSPACE")] {
            if let Ok(value) = std::env::var(variable) {
                payload[key] = serde_json::Value::String(value);
            }
        }
    }
    let forced = kind.and_then(Kind::parse);
    let Some(event) = normalize(agent, &payload, forced, now_ms()) else { return };
    let starts = event.kind == Kind::Started;
    let request = Request::Event(event);
    if mushaf_ipc::send(app, &request).is_ok() {
        return;
    }
    if !starts {
        // Only a starting task wakes the app. An end is kept for it, so it doesn't
        // take the task for one still at work when it next starts.
        if let Request::Event(event) = &request {
            keep_missed(app, event);
        }
        return;
    }
    if launch_app(app, true).is_ok() {
        let _ = send_until(app, &request, Instant::now() + Duration::from_millis(2500));
    }
}

/// The log of the Antigravity CLI holding a conversation: of the latest few,
/// the one that names it, or else the latest.
fn agy_log(conversation: &str) -> Option<PathBuf> {
    use std::io::{Seek, SeekFrom};
    const TAIL: u64 = 512 * 1024;
    let dir = home_dir().join(".gemini").join("antigravity-cli").join("log");
    let mut logs: Vec<_> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "log"))
        .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
        .collect();
    logs.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    logs.truncate(4);
    let names = |path: &PathBuf| -> Option<bool> {
        let mut file = std::fs::File::open(path).ok()?;
        let length = file.metadata().ok()?.len();
        file.seek(SeekFrom::Start(length.saturating_sub(TAIL))).ok()?;
        let mut tail = Vec::new();
        file.take(TAIL).read_to_end(&mut tail).ok()?;
        Some(String::from_utf8_lossy(&tail).contains(conversation))
    };
    let named = (!conversation.is_empty()).then(|| logs.iter().find(|(_, path)| names(path) == Some(true))).flatten();
    named.or(logs.first()).map(|(_, path)| path.clone())
}

/// Adds an event to the missed list; a list grown past 256 KB starts over.
fn keep_missed(app: &AppId, event: &mushaf_protocol::AgentEvent) {
    use std::io::Write;
    let path = mushaf_ipc::missed_path(app);
    let Ok(mut line) = serde_json::to_string(event) else { return };
    line.push('\n');
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let full = std::fs::metadata(&path).is_ok_and(|meta| meta.len() > 256 * 1024);
    let file = std::fs::OpenOptions::new().create(true).append(!full).write(true).truncate(full).open(&path);
    if let Ok(mut file) = file {
        let _ = file.write_all(line.as_bytes());
    }
}

/// Retries while the app starts up.
fn send_until(app: &AppId, request: &Request, until: Instant) -> std::io::Result<Response> {
    loop {
        match mushaf_ipc::send(app, request) {
            Ok(response) => return Ok(response),
            Err(error) if Instant::now() >= until => return Err(error),
            Err(_) => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}

fn app_path(app: &AppId) -> Option<PathBuf> {
    if let Some(path) = std::env::var_os(app.env_var("APP")) {
        return Some(PathBuf::from(path));
    }
    let name = if cfg!(windows) { format!("{}.exe", app.program) } else { app.program.to_owned() };
    let beside = std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.join(name)));
    if let Some(path) = beside.filter(|path| path.is_file()) {
        return Some(path);
    }
    // Where the app last said it lives.
    let locator = std::fs::read(mushaf_ipc::locator_path(app)).ok()?;
    let locator: serde_json::Value = serde_json::from_slice(&locator).ok()?;
    locator.get("app").and_then(|app| app.as_str()).map(PathBuf::from).filter(|path| path.is_file())
}

/// Starts the app on its own, so it outlives this hook and the agent's terminal.
fn launch_app(app: &AppId, background: bool) -> std::io::Result<()> {
    let path = app_path(app).ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, format!("{} app is not installed", app.title)))?;
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

fn open(app: &AppId, place: Option<String>) -> ExitCode {
    deadline(Duration::from_secs(20), 1);
    let request = Request::Open { place };
    let response = match mushaf_ipc::send(app, &request) {
        Ok(response) => Ok(response),
        Err(_) => match launch_app(app, true) {
            Ok(()) => send_until(app, &request, Instant::now() + Duration::from_secs(15)),
            Err(error) => Err(error),
        },
    };
    match response {
        Ok(Response { ok: true, .. }) => ExitCode::SUCCESS,
        Ok(Response { error, .. }) => {
            eprintln!("{}: {}", app.slug, error.unwrap_or_else(|| format!("{} could not open there", app.title)));
            ExitCode::FAILURE
        }
        Err(error) => {
            eprintln!("{}: could not reach {} app ({error})", app.slug, app.title);
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

fn status(app: &AppId) -> ExitCode {
    deadline(Duration::from_secs(5), 1);
    let title = app.title;
    let Ok(response) = mushaf_ipc::send(app, &Request::Status) else {
        say!("{} app is not running.", app.title_case());
        return ExitCode::SUCCESS;
    };
    say!("{} app {} is running.", app.title_case(), response.version.unwrap_or_default());
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
            (true, _) => format!("{title} opened for it"),
            (false, Some(at)) if at > now => format!("{title} opens in {}", minutes(at - now)),
            (false, Some(_)) => format!("ready: {title} opens once you are not busy"),
            (false, None) => format!("{title} won't open for it"),
        };
        let name = mushaf_protocol::agent_name(&session.agent);
        say!("  {name}{project}: working for {} — {when}", minutes(now.saturating_sub(session.started_at)));
    }
    ExitCode::SUCCESS
}

fn cli_path(app: &AppId) -> PathBuf {
    std::env::current_exe().and_then(|exe| exe.canonicalize()).unwrap_or_else(|_| PathBuf::from(app.slug))
}

fn integrations_list(app: &AppId) -> ExitCode {
    let home = home_dir();
    let cli = cli_path(app);
    for agent in mushaf_agents::AGENTS {
        let status = match agent.status(&home, &cli, app) {
            Ok(mushaf_agents::Status::Missing) => "not installed on this machine".to_owned(),
            Ok(mushaf_agents::Status::Off) => "off".to_owned(),
            Ok(mushaf_agents::Status::On) => format!("on ({})", agent.config_path(&home, app).display()),
            Ok(mushaf_agents::Status::Stale) => format!("on, but out of date: run `{} integrations install`", app.slug),
            Err(error) => format!("unreadable: {error}"),
        };
        say!("{:<14} {status}", agent.name);
    }
    ExitCode::SUCCESS
}

fn integrations(app: &AppId, action: &str, id: Option<&str>) -> ExitCode {
    let home = home_dir();
    let cli = cli_path(app);
    let agents: Vec<_> = match id {
        Some(id) => match mushaf_agents::find(id) {
            Some(agent) => vec![agent],
            None => {
                let ids: Vec<_> = mushaf_agents::AGENTS.iter().map(|agent| agent.id).collect();
                eprintln!("{}: no agent called {id}; try one of {}", app.slug, ids.join(", "));
                return ExitCode::from(2);
            }
        },
        None => mushaf_agents::AGENTS.iter().copied().filter(|agent| agent.detect(&home)).collect(),
    };
    if agents.is_empty() {
        let names: Vec<_> = mushaf_agents::AGENTS.iter().map(|agent| agent.name).collect();
        say!("No coding agent found (looked for {}).", names.join(", "));
        return ExitCode::SUCCESS;
    }
    let mut failed = false;
    for agent in agents {
        let result = if action == "install" { agent.install(&home, &cli, app) } else { agent.uninstall(&home, app) };
        match result {
            Ok(changed) => {
                let done = match (action, changed) {
                    ("install", true) => "hooks added".to_owned(),
                    ("install", false) => "hooks already in place".to_owned(),
                    (_, true) => "hooks removed".to_owned(),
                    (_, false) => format!("had no hooks of {}", app.title),
                };
                say!("{}: {done} ({})", agent.name, agent.config_path(&home, app).display());
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
