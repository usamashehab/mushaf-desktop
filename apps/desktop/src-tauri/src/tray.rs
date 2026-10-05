//! The tray icon that keeps the Mushaf at hand while its window is closed, so
//! agents can open it again: Open, a pause for the rest of the day, and Quit.

use chrono::{Duration, Local, TimeZone};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime, Wry};

use crate::agents::{now_ms, show_window, Agents};

pub struct Tray {
    pause: MenuItem<Wry>,
}

fn labels(language: &str) -> [&'static str; 4] {
    if language == "ar" {
        ["افتح المصحف", "أوقف التنبيهات حتى الغد", "استأنف التنبيهات", "خروج"]
    } else {
        ["Open the Mushaf", "Pause alerts until tomorrow", "Resume alerts", "Quit"]
    }
}

/// The next local midnight, in ms since the epoch.
fn tomorrow() -> u64 {
    let midnight = (Local::now() + Duration::days(1)).date_naive().and_hms_opt(0, 0, 0).unwrap_or_default();
    Local.from_local_datetime(&midnight).earliest().map(|t| t.timestamp_millis() as u64).unwrap_or(now_ms() + 86_400_000)
}

fn pause_file<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("pause.json"))
}

pub fn load_pause<R: Runtime>(app: &AppHandle<R>) -> Option<u64> {
    let body = std::fs::read(pause_file(app)?).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&body).ok()?;
    value.get("until").and_then(|u| u.as_u64()).filter(|until| *until > now_ms())
}

/// Pauses (or with None resumes) alerts and the opening, from the tray or the reader.
pub fn set_pause<R: Runtime>(app: &AppHandle<R>, until: Option<u64>) {
    app.state::<Agents>().set_paused_until(until);
    if let Some(path) = pause_file(app) {
        let _ = std::fs::create_dir_all(path.parent().unwrap_or(&path));
        let _ = std::fs::write(path, serde_json::json!({ "until": until }).to_string());
    }
    let _ = app.emit_to("main", "agent-pause", until);
    refresh(app);
}

/// Brings the menu up to date with the pause and the reader's language.
pub fn refresh<R: Runtime>(app: &AppHandle<R>) {
    let Some(tray) = app.try_state::<Tray>() else { return };
    let language = app.state::<Agents>().language();
    let [_, pause, resume, _] = labels(&language);
    let paused = app.state::<Agents>().paused_until().is_some();
    let _ = tray.pause.set_text(if paused { resume } else { pause });
}

/// False when the desktop has no tray: then closing the window quits as usual.
pub fn create(app: &AppHandle<Wry>) -> bool {
    let language = app.state::<Agents>().language();
    let [open, pause, _, quit] = labels(&language);
    let build = || -> tauri::Result<MenuItem<Wry>> {
        let open = MenuItem::with_id(app, "open", open, true, None::<&str>)?;
        let pause = MenuItem::with_id(app, "pause", pause, true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", quit, true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&open, &pause, &PredefinedMenuItem::separator(app)?, &quit])?;
        let mut tray = TrayIconBuilder::with_id("main").menu(&menu).tooltip("Mushaf").show_menu_on_left_click(false);
        if let Some(icon) = app.default_window_icon() {
            tray = tray.icon(icon.clone());
        }
        tray.on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_window(app, true),
            "pause" => {
                let paused = app.state::<Agents>().paused_until().is_some();
                set_pause(app, if paused { None } else { Some(tomorrow()) });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_window(tray.app_handle(), true);
            }
        })
        .build(app)?;
        Ok(pause)
    };
    match build() {
        Ok(pause) => {
            app.manage(Tray { pause });
            refresh(app);
            true
        }
        Err(error) => {
            eprintln!("mushaf: no tray icon ({error}); closing the window will quit");
            false
        }
    }
}
