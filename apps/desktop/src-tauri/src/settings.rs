//! The reader's settings, kept as one JSON file in the app's config folder. The
//! reader owns their shape (and migrates old ones); this side only stores them.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("settings.json"))
        .map_err(|error| error.to_string())
}

/// The settings as last saved, or null when there are none (or they don't parse).
#[tauri::command]
pub fn load_settings<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    let path = settings_path(&app)?;
    Ok(std::fs::read(path)
        .ok()
        .and_then(|body| serde_json::from_slice(&body).ok())
        .unwrap_or(serde_json::Value::Null))
}

/// Writes to a temporary file first, so a crash mid-save keeps the old settings.
#[tauri::command]
pub fn save_settings<R: Runtime>(app: AppHandle<R>, settings: serde_json::Value) -> Result<(), String> {
    let path = settings_path(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    }
    let partial = path.with_extension("json.part");
    let body = serde_json::to_vec_pretty(&settings).map_err(|error| error.to_string())?;
    std::fs::write(&partial, body).map_err(|error| error.to_string())?;
    std::fs::rename(&partial, &path).map_err(|error| error.to_string())
}
