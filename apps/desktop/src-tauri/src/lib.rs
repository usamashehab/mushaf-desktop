mod fonts;
mod settings;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        // First, so a second launch only brings the open window forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .register_asynchronous_uri_scheme_protocol("mushaf", fonts::protocol)
        .invoke_handler(tauri::generate_handler![
            fonts::fonts_missing,
            fonts::download_fonts,
            settings::load_settings,
            settings::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("Mushaf could not start");
}
