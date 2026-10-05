//! How long the user has left the keyboard and mouse, as the system tells it.
//! None when it can't tell: then the Mushaf opens on time, as if they had.

pub fn idle_ms() -> Option<u64> {
    platform::idle_ms()
}

/// GNOME (on X11 and Wayland) through its idle monitor, then KDE through the
/// screensaver service, both on the session bus. Other desktops: unknown.
#[cfg(target_os = "linux")]
mod platform {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use zbus::blocking::Connection;

    const SOURCES: [(&str, &str, &str, &str); 2] = [
        ("org.gnome.Mutter.IdleMonitor", "/org/gnome/Mutter/IdleMonitor/Core", "org.gnome.Mutter.IdleMonitor", "GetIdletime"),
        ("org.freedesktop.ScreenSaver", "/org/freedesktop/ScreenSaver", "org.freedesktop.ScreenSaver", "GetSessionIdleTime"),
    ];
    /// When no source answers, ask again only after this long.
    const RETRY_AFTER: Duration = Duration::from_secs(60);

    struct State {
        connection: Option<Connection>,
        /// The source that answered last.
        source: Option<usize>,
        quiet_until: Option<Instant>,
    }

    static STATE: Mutex<State> = Mutex::new(State { connection: None, source: None, quiet_until: None });

    pub fn idle_ms() -> Option<u64> {
        let mut state = STATE.lock().ok()?;
        if state.quiet_until.is_some_and(|until| Instant::now() < until) {
            return None;
        }
        if state.connection.is_none() {
            state.connection = Connection::session().ok();
        }
        let connection = state.connection.clone();
        let tried: Vec<usize> = state.source.map_or_else(|| (0..SOURCES.len()).collect(), |source| vec![source]);
        for source in tried {
            if let Some(ms) = connection.as_ref().and_then(|connection| ask(connection, SOURCES[source])) {
                state.source = Some(source);
                return Some(ms);
            }
        }
        // Gone, or never there: look for any source again in a while.
        *state = State { connection: None, source: None, quiet_until: Some(Instant::now() + RETRY_AFTER) };
        None
    }

    fn ask(connection: &Connection, (destination, path, interface, method): (&str, &str, &str, &str)) -> Option<u64> {
        let reply = connection.call_method(Some(destination), path, Some(interface), method, &()).ok()?;
        let body = reply.body();
        // Milliseconds: a u64 from GNOME, a u32 from KDE.
        body.deserialize::<u64>().ok().or_else(|| body.deserialize::<u32>().ok().map(u64::from))
    }
}

#[cfg(any(windows, target_os = "macos"))]
mod platform {
    pub fn idle_ms() -> Option<u64> {
        user_idle::UserIdle::get_time().ok().map(|idle| idle.as_milliseconds() as u64)
    }
}

#[cfg(not(any(target_os = "linux", windows, target_os = "macos")))]
mod platform {
    pub fn idle_ms() -> Option<u64> {
        None
    }
}
