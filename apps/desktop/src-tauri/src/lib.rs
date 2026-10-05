mod agents;
mod fonts;
mod sessions;
mod settings;
mod tray;

use tauri::{Manager, WindowEvent};

/// Started by an agent's hook: stay in the tray until there's something to show.
const BACKGROUND: &str = "--background";

pub fn run() {
    let background = std::env::args().any(|arg| arg == BACKGROUND);
    tauri::Builder::default()
        // First, so a second launch only brings the open window forward.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !args.iter().any(|arg| arg == BACKGROUND) {
                agents::show_window(app, true);
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .register_asynchronous_uri_scheme_protocol("mushaf", fonts::protocol)
        .setup(move |app| {
            let handle = app.handle();
            let stored = settings::read(handle);
            app.manage(agents::Agents::new(&stored, tray::load_pause(handle)));
            let has_tray = tray::create(handle);
            if let Some(window) = app.get_webview_window("main") {
                if has_tray {
                    // Closing hides to the tray, so agents can bring the Mushaf back.
                    let hide = window.clone();
                    window.on_window_event(move |event| {
                        if let WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            let _ = hide.hide();
                        }
                    });
                }
                if !background || !has_tray {
                    agents::show_window(handle, true);
                }
            }
            agents::write_locator(handle);
            agents::start(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fonts::fonts_missing,
            fonts::download_fonts,
            settings::load_settings,
            settings::save_settings,
            agents::agent_state,
            agents::take_open_place,
            agents::pause_alerts,
            agents::integrations_status,
            agents::integrations_set,
        ])
        .run(tauri::generate_context!())
        .expect("Mushaf could not start");
}
