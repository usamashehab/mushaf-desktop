//! The app's side of the agents: the socket `mushaf` talks to, the session
//! engine behind it, and what its actions do to the window.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use mushaf_ipc::{Request, Response, Session};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_notification::NotificationExt;

use crate::sessions::{Action, Alert, AlertKind, Engine, Prefs, WindowState};

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

fn notification_text(alert: &Alert, language: &str) -> (String, String) {
    let agent = mushaf_protocol::agent_name(&alert.agent);
    let project = alert.project.clone().unwrap_or_default();
    match (language, alert.kind) {
        ("ar", AlertKind::Finished) => (format!("أنهى {agent} عمله"), project),
        ("ar", AlertKind::Attention) => (format!("{agent} ينتظرك"), project),
        (_, AlertKind::Finished) => (format!("{agent} finished"), project),
        (_, AlertKind::Attention) => (format!("{agent} is waiting for you"), project),
    }
}

fn run<R: Runtime>(app: &AppHandle<R>, actions: Vec<Action>) {
    let agents = app.state::<Agents>();
    for action in actions {
        match action {
            Action::Open { focus } => show_window(app, focus),
            Action::Alert(alert) => {
                if alert.banner {
                    let _ = app.emit_to("main", "agent-alert", &alert);
                }
                if alert.notify {
                    let (title, body) = notification_text(&alert, &agents.language.lock().unwrap());
                    let mut builder = app.notification().builder().title(title).body(body);
                    if alert.sound && !alert.banner {
                        builder = builder.sound("default");
                    }
                    let _ = builder.show();
                }
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
        let actions = agents.engine.lock().unwrap().on_tick(now_ms(), &prefs, window);
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
