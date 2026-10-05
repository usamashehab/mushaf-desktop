//! The app's side of the agents: the socket `mushaf` talks to, the session
//! engine behind it, and what its actions do to the window.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use mushaf_ipc::{Request, Response, Session};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_notification::NotificationExt;

use crate::sessions::{Action, AlertKind, Engine, Notice, Prefs, WindowState};

pub struct Agents {
    engine: Mutex<Engine>,
    prefs: Mutex<Prefs>,
    language: Mutex<String>,
    /// A place `mushaf open` asked for before the reader was ready to take it.
    pending_open: Mutex<Option<String>>,
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

impl Agents {
    pub fn new(settings: &serde_json::Value, paused_until: Option<u64>) -> Self {
        Agents {
            engine: Mutex::new(Engine::paused(paused_until)),
            prefs: Mutex::new(Prefs::from_settings(settings)),
            language: Mutex::new(language_of(settings)),
            pending_open: Mutex::new(None),
        }
    }

    /// The reader saved its settings.
    pub fn settings_changed(&self, settings: &serde_json::Value) {
        *self.prefs.lock().unwrap() = Prefs::from_settings(settings);
        *self.language.lock().unwrap() = language_of(settings);
    }

    pub fn paused_until(&self) -> Option<u64> {
        let engine = self.engine.lock().unwrap();
        engine.paused_until.filter(|_| engine.is_paused(now_ms()))
    }

    pub fn language(&self) -> String {
        self.language.lock().unwrap().clone()
    }

    pub fn set_paused_until(&self, until: Option<u64>) {
        self.engine.lock().unwrap().paused_until = until;
    }
}

fn language_of(settings: &serde_json::Value) -> String {
    settings.get("language").and_then(|l| l.as_str()).unwrap_or("ar").to_owned()
}

fn window_state<R: Runtime>(app: &AppHandle<R>) -> WindowState {
    let Some(window) = app.get_webview_window("main") else { return WindowState::default() };
    let visible = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
    WindowState { visible, focused: visible && window.is_focused().unwrap_or(false) }
}

/// Shows the reader window, in front when `focus`.
pub fn show_window<R: Runtime>(app: &AppHandle<R>, focus: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        if focus {
            // Some window managers refuse focus to a window that wasn't clicked;
            // a moment on top gets it in front anyway.
            let _ = window.set_always_on_top(true);
            let _ = window.set_focus();
            let _ = window.set_always_on_top(false);
        }
    }
}

/// "Claude", "Claude and Codex", "Claude, Codex and Cursor"; in Arabic with و.
fn names(agents: &[&str], language: &str) -> String {
    let mut names: Vec<String> = agents.iter().map(|agent| mushaf_protocol::agent_name(agent)).collect();
    names.dedup();
    match (language, names.as_slice()) {
        (_, []) => String::new(),
        (_, [one]) => one.clone(),
        ("ar", [first, rest @ ..]) => rest.iter().fold(first.clone(), |text, name| format!("{text} و{name}")),
        (_, [rest @ .., last]) => format!("{} and {last}", rest.join(", ")),
    }
}

fn finished_text(names: &str, language: &str) -> String {
    if language == "ar" { format!("انتهى عمل {names}") } else { format!("{names} finished") }
}

fn waiting_text(names: &str, language: &str, many: bool) -> String {
    match (language, many) {
        ("ar", _) => format!("ينتظرك {names}"),
        (_, true) => format!("{names} are waiting for you"),
        (_, false) => format!("{names} is waiting for you"),
    }
}

/// One notification for alerts that came together: who waits for the user
/// first, then who finished, then the projects.
fn notice_text(notice: &Notice, language: &str) -> (String, String) {
    match notice {
        Notice::Working(agents) => {
            let agents: Vec<&str> = agents.iter().map(String::as_str).collect();
            let who = names(&agents, language);
            if language == "ar" {
                ("المصحف جاهز".into(), format!("يعمل {who} منذ مدة. افتح المصحف من شريط النظام."))
            } else {
                let have = if agents.len() > 1 { "have" } else { "has" };
                ("The Mushaf is ready".into(), format!("{who} {have} been at work a while. Open the Mushaf from the tray."))
            }
        }
        Notice::Alerts(alerts) => {
            let of = |kind: AlertKind| alerts.iter().filter(|alert| alert.kind == kind).map(|alert| alert.agent.as_str()).collect::<Vec<_>>();
            let (waiting, finished) = (of(AlertKind::Attention), of(AlertKind::Finished));
            let waiting_line = (!waiting.is_empty()).then(|| waiting_text(&names(&waiting, language), language, waiting.len() > 1));
            let finished_line = (!finished.is_empty()).then(|| finished_text(&names(&finished, language), language));
            let mut projects: Vec<&str> = alerts.iter().filter_map(|alert| alert.project.as_deref()).collect();
            projects.dedup();
            let projects = projects.join(if language == "ar" { "، " } else { ", " });
            match (waiting_line, finished_line) {
                (Some(title), Some(also)) => (title, format!("{also} — {projects}").trim_end_matches(" — ").to_owned()),
                (Some(title), None) | (None, Some(title)) => (title, projects),
                (None, None) => (String::new(), projects),
            }
        }
    }
}

fn run<R: Runtime>(app: &AppHandle<R>, actions: Vec<Action>) {
    let agents = app.state::<Agents>();
    for action in actions {
        match action {
            Action::Open { focus } => show_window(app, focus),
            Action::Alert(alert) => {
                let _ = app.emit_to("main", "agent-alert", &alert);
            }
            Action::Notify { notice, sound } => {
                let (title, body) = notice_text(&notice, &agents.language.lock().unwrap());
                let mut builder = app.notification().builder().title(title).body(body);
                if sound {
                    builder = builder.sound("default");
                }
                let _ = builder.show();
            }
            Action::Sessions => {
                let sessions = agents.engine.lock().unwrap().sessions();
                let _ = app.emit_to("main", "agent-sessions", &sessions);
            }
        }
    }
}

fn handle<R: Runtime>(app: &AppHandle<R>, request: Request) -> Response {
    let agents = app.state::<Agents>();
    match request {
        Request::Event(event) => {
            let prefs = agents.prefs.lock().unwrap().clone();
            let window = window_state(app);
            let actions = agents.engine.lock().unwrap().on_event(&event, now_ms(), &prefs, window);
            run(app, actions);
            Response::ok()
        }
        Request::Open { place } => {
            if let Some(place) = place {
                *agents.pending_open.lock().unwrap() = Some(place.clone());
                let _ = app.emit_to("main", "open-place", &place);
            }
            show_window(app, true);
            Response::ok()
        }
        Request::Status => {
            let (sessions, heard) = {
                let engine = agents.engine.lock().unwrap();
                (engine.sessions(), engine.heard())
            };
            Response { sessions: Some(sessions), heard: Some(heard), version: Some(app.package_info().version.to_string()), ..Response::ok() }
        }
    }
}

/// Reads the end of a transcript (never more) to see whether its task was interrupted.
fn transcript_interrupted(agent: &str, session: &str, path: &str) -> bool {
    use std::io::{Read, Seek, SeekFrom};
    const TAIL: u64 = 64 * 1024;
    let Ok(mut file) = std::fs::File::open(path) else { return false };
    let length = file.metadata().map(|m| m.len()).unwrap_or(0);
    if file.seek(SeekFrom::Start(length.saturating_sub(TAIL))).is_err() {
        return false;
    }
    let mut tail = Vec::new();
    if file.take(TAIL).read_to_end(&mut tail).is_err() {
        return false;
    }
    mushaf_protocol::was_interrupted(agent, session, &String::from_utf8_lossy(&tail))
}

/// Starts the socket server and the once-a-second clock. A second app can't
/// get here (single instance), so taking over a leftover socket is safe.
pub fn start<R: Runtime>(app: &AppHandle<R>) {
    match mushaf_ipc::listen() {
        Ok(listener) => {
            let handle_app = app.clone();
            std::thread::spawn(move || mushaf_ipc::serve(listener, move |request| handle(&handle_app, request)));
        }
        Err(error) => eprintln!("mushaf: agents can't reach the app: {error}"),
    }
    let tick_app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        let agents = tick_app.state::<Agents>();
        let prefs = agents.prefs.lock().unwrap().clone();
        let window = window_state(&tick_app);
        let idle = crate::idle::idle_ms();
        let actions = agents.engine.lock().unwrap().on_tick(now_ms(), &prefs, window, idle, &transcript_interrupted);
        run(&tick_app, actions);
    });
}

/// The `mushaf` program that came with this app, beside its own binary.
pub fn cli_path() -> Option<PathBuf> {
    let name = if cfg!(windows) { "mushaf.exe" } else { "mushaf" };
    let exe = std::env::current_exe().ok()?;
    let path = exe.parent()?.join(name);
    path.is_file().then_some(path)
}

/// Tells `mushaf` (and the terminal plugin) where the app is.
pub fn write_locator<R: Runtime>(app: &AppHandle<R>) {
    let dir = mushaf_ipc::home_dir().join(".mushaf");
    let locator = serde_json::json!({
        "app": std::env::current_exe().ok(),
        "cli": cli_path(),
        "version": app.package_info().version.to_string(),
    });
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(dir.join("locator.json"), serde_json::to_vec_pretty(&locator).unwrap_or_default());
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentState {
    sessions: Vec<Session>,
    paused_until: Option<u64>,
}

#[tauri::command]
pub fn agent_state(agents: State<'_, Agents>) -> AgentState {
    // One lock at a time: the guard of a field's temporary lives to the end of the statement.
    let sessions = agents.engine.lock().unwrap().sessions();
    AgentState { sessions, paused_until: agents.paused_until() }
}

/// The place `mushaf open` asked for, once.
#[tauri::command]
pub fn take_open_place(agents: State<'_, Agents>) -> Option<String> {
    agents.pending_open.lock().unwrap().take()
}

#[tauri::command]
pub fn pause_alerts<R: Runtime>(app: AppHandle<R>, until: Option<u64>) {
    crate::tray::set_pause(&app, until);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Integration {
    id: &'static str,
    name: &'static str,
    status: &'static str,
    note: Option<&'static str>,
    config_path: String,
    error: Option<String>,
}

fn integration(agent: &mushaf_agents::Agent, cli: Option<&PathBuf>) -> Integration {
    let home = mushaf_ipc::home_dir();
    let status = match cli {
        Some(cli) => agent.status(&home, cli),
        None => agent.status(&home, &PathBuf::from("mushaf")),
    };
    Integration {
        id: agent.id,
        name: agent.name,
        status: status.as_ref().map(|s| s.as_str()).unwrap_or("error"),
        note: agent.note,
        config_path: agent.config_path(&home).display().to_string(),
        error: status.err().map(|e| e.to_string()),
    }
}

#[tauri::command]
pub fn integrations_status() -> Vec<Integration> {
    let cli = cli_path();
    mushaf_agents::AGENTS.iter().map(|agent| integration(agent, cli.as_ref())).collect()
}

#[tauri::command]
pub fn integrations_set(id: String, on: bool) -> Result<Integration, String> {
    let agent = mushaf_agents::find(&id).ok_or_else(|| format!("no agent called {id}"))?;
    let home = mushaf_ipc::home_dir();
    if on {
        let cli = cli_path().ok_or("the mushaf command is missing from this install")?;
        agent.install(&home, &cli).map_err(|e| e.to_string())?;
    } else {
        agent.uninstall(&home).map_err(|e| e.to_string())?;
    }
    Ok(integration(&agent, cli_path().as_ref()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions::Alert;

    fn alert(agent: &str, kind: AlertKind, project: &str) -> Alert {
        Alert { agent: agent.into(), project: Some(project.into()), kind, at: 0, worked_ms: None, banner: false, notify: true, sound: false }
    }

    #[test]
    fn one_notification_names_every_agent() {
        let finished = Notice::Alerts(vec![alert("claude", AlertKind::Finished, "api"), alert("codex", AlertKind::Finished, "web")]);
        assert_eq!(notice_text(&finished, "en"), ("Claude and Codex finished".into(), "api, web".into()));
        assert_eq!(notice_text(&finished, "ar"), ("انتهى عمل Claude وCodex".into(), "api، web".into()));
        let mixed = Notice::Alerts(vec![
            alert("claude", AlertKind::Finished, "api"),
            alert("codex", AlertKind::Attention, "api"),
            alert("agy", AlertKind::Finished, "site"),
        ]);
        assert_eq!(notice_text(&mixed, "en"), ("Codex is waiting for you".into(), "Claude and Antigravity finished — api, site".into()));
        let one = Notice::Alerts(vec![alert("cursor", AlertKind::Attention, "api")]);
        assert_eq!(notice_text(&one, "ar").0, "ينتظرك Cursor");
        let working = Notice::Working(vec!["claude".into(), "codex".into(), "opencode".into()]);
        assert_eq!(notice_text(&working, "en").1, "Claude, Codex and OpenCode have been at work a while. Open the Mushaf from the tray.");
    }
}
