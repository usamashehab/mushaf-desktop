//! Adds an app's hooks to a coding agent's settings, and takes them out again.
//!
//! The agent's file is edited, never replaced: every hook the user already has
//! stays as it was, a copy of the file is kept before the first change, and the
//! file is written only when something changed. An app's hooks are the commands
//! that run its hook program (`mushaf` for the Mushaf, see [`AppId`]) with
//! `hook` as their first argument, so two apps' hooks never touch each other.
//! OpenCode takes a plugin instead: a file of the app's own in its plugin folder.

use std::io;
use std::path::{Path, PathBuf};

use mushaf_protocol::AppId;
use serde_json::{json, Map, Value};

/// How an agent holds its hooks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Format {
    /// Claude Code and Codex: `hooks.<Event>` lists groups, `{matcher?, hooks: [handler]}`.
    /// `background`: the agent may run our hook without waiting for it.
    Grouped { events: &'static [(&'static str, Option<&'static str>)], background: bool },
    /// Cursor: `{version: 1, hooks: {<event>: [handler]}}`.
    Flat { events: &'static [&'static str] },
    /// Antigravity: `{<hook name>: {<Event>: [handler]}}`, under a name of our own.
    /// Its payload doesn't say which event it is, so each command does.
    Named { events: &'static [(&'static str, &'static str)] },
    /// DeepSeek TUI (Codewhale): `[[hooks.hooks]]` tables in `config.toml`, each
    /// with its event; the command says which event it is.
    Toml { events: &'static [(&'static str, &'static str)] },
    /// OpenCode: a plugin file.
    Plugin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Agent {
    pub id: &'static str,
    pub name: &'static str,
    /// Where the agent lives, in the home folder, and the file holding its hooks
    /// there (`{app}` stands for the app's slug). The first whose folder exists
    /// is used; none existing means the agent isn't on this machine.
    places: &'static [(&'static str, &'static str)],
    format: Format,
    /// What the user has to do once before the hooks run, if anything.
    pub note: Option<&'static str>,
}

pub const CLAUDE: Agent = Agent {
    id: "claude",
    name: "Claude Code",
    places: &[(".claude", ".claude/settings.json")],
    format: Format::Grouped {
        events: &[
            ("UserPromptSubmit", None),
            ("Stop", None),
            ("StopFailure", None),
            ("Notification", Some("permission_prompt|elicitation_dialog")),
            ("SessionEnd", None),
        ],
        background: true,
    },
    note: None,
};

pub const CODEX: Agent = Agent {
    id: "codex",
    name: "Codex",
    places: &[(".codex", ".codex/hooks.json")],
    format: Format::Grouped {
        events: &[("UserPromptSubmit", None), ("Stop", None), ("PermissionRequest", None), ("SessionEnd", None)],
        background: false,
    },
    note: Some("Codex asks once to trust new hooks: start codex and choose \"Trust all and continue\"."),
};

pub const CURSOR: Agent = Agent {
    id: "cursor",
    name: "Cursor",
    places: &[(".cursor", ".cursor/hooks.json")],
    format: Format::Flat { events: &["beforeSubmitPrompt", "stop", "sessionEnd"] },
    note: None,
};

pub const OPENCODE: Agent = Agent {
    id: "opencode",
    name: "OpenCode",
    places: &[(".config/opencode", ".config/opencode/plugin/{app}.js")],
    format: Format::Plugin,
    note: Some("OpenCode loads plugins when it starts: restart any OpenCode already open."),
};

pub const ANTIGRAVITY: Agent = Agent {
    id: "agy",
    name: "Antigravity",
    places: &[(".gemini/antigravity-cli", ".gemini/config/hooks.json")],
    format: Format::Named { events: &[("PreInvocation", "started"), ("Stop", "finished")] },
    note: None,
};

pub const DEEPSEEK: Agent = Agent {
    id: "deepseek",
    name: "DeepSeek TUI",
    places: &[(".codewhale", ".codewhale/config.toml"), (".deepseek", ".deepseek/config.toml")],
    format: Format::Toml {
        events: &[("session_busy", "started"), ("session_idle", "finished"), ("waiting_for_user", "attention")],
    },
    note: Some("DeepSeek TUI reads its hooks when it starts: restart any session already open."),
};

pub const AGENTS: &[Agent] = &[CLAUDE, CODEX, CURSOR, OPENCODE, ANTIGRAVITY, DEEPSEEK];

const PLUGIN: &str = include_str!("opencode-plugin.js");

/// How the first line of an app's OpenCode plugin starts, by which it is known as the app's.
fn plugin_mark(app: &AppId) -> String {
    format!("// {}: ", app.title_case())
}

pub fn find(id: &str) -> Option<Agent> {
    AGENTS.iter().copied().find(|agent| agent.id == id)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// The agent isn't on this machine.
    Missing,
    /// None of the app's hooks.
    Off,
    /// All the app's hooks, pointing at this hook program.
    On,
    /// Some of them, or ones pointing at another copy of the program: install again to fix.
    Stale,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Missing => "missing",
            Status::Off => "off",
            Status::On => "on",
            Status::Stale => "stale",
        }
    }
}

/// The command line an agent runs: our program, quoted when its path needs it.
pub fn hook_command(cli: &Path, agent: &str) -> String {
    let program = cli.to_string_lossy();
    if program.contains(|c: char| c.is_whitespace() || c == '\'' || c == '"') {
        format!("\"{}\" hook {agent}", program.replace('"', "\\\""))
    } else {
        format!("{program} hook {agent}")
    }
}

/// The program a command line runs, and the rest of it.
fn split_command(command: &str) -> (String, &str) {
    let command = command.trim_start();
    for quote in ['"', '\''] {
        if let Some(rest) = command.strip_prefix(quote) {
            if let Some(end) = rest.find(quote) {
                return (rest[..end].to_owned(), &rest[end + 1..]);
            }
        }
    }
    let end = command.find(char::is_whitespace).unwrap_or(command.len());
    (command[..end].to_owned(), &command[end..])
}

/// Whether a command line is one of the app's hooks.
pub fn is_ours(command: &str, app: &AppId) -> bool {
    let (program, rest) = split_command(command);
    // Either separator, so a Windows path reads right everywhere.
    let file = program.rsplit(['/', '\\']).next().unwrap_or("");
    let stem = file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(file);
    stem.eq_ignore_ascii_case(app.slug) && rest.trim_start().starts_with("hook ")
}

/// Our hooks in a file: (event, command) pairs.
type Hooks = Vec<(String, String)>;

impl Agent {
    fn place(&self, home: &Path) -> Option<(&'static str, &'static str)> {
        self.places.iter().copied().find(|(dir, _)| home.join(dir).is_dir())
    }

    pub fn config_path(&self, home: &Path, app: &AppId) -> PathBuf {
        let (_, file) = self.place(home).unwrap_or(self.places[0]);
        home.join(file.replace("{app}", app.slug))
    }

    pub fn detect(&self, home: &Path) -> bool {
        self.place(home).is_some()
    }

    /// The hooks we want: (event, command) pairs.
    fn wanted(&self, cli: &Path) -> Hooks {
        let command = hook_command(cli, self.id);
        let pairs = |events: &[(&str, &str)]| events.iter().map(|(event, kind)| (event.to_string(), format!("{command} {kind}"))).collect();
        match self.format {
            Format::Grouped { events, .. } => events.iter().map(|(event, _)| (event.to_string(), command.clone())).collect(),
            Format::Flat { events } => events.iter().map(|event| (event.to_string(), command.clone())).collect(),
            Format::Named { events } | Format::Toml { events } => pairs(events),
            Format::Plugin => vec![],
        }
    }

    pub fn status(&self, home: &Path, cli: &Path, app: &AppId) -> io::Result<Status> {
        if !self.detect(home) {
            return Ok(Status::Missing);
        }
        let path = self.config_path(home, app);
        if self.format == Format::Plugin {
            return Ok(match read_text(&path)? {
                None => Status::Off,
                Some(text) if text == plugin(cli, app) => Status::On,
                Some(text) if text.starts_with(&plugin_mark(app)) => Status::Stale,
                // Someone else's file by that name.
                Some(_) => Status::Off,
            });
        }
        let mut found = match self.format {
            Format::Toml { .. } => toml_ours(&read_toml(&path)?, app),
            _ => read_json(&path)?.map(|root| self.json_ours(&root, app)).unwrap_or_default(),
        };
        let mut wanted = self.wanted(cli);
        found.sort();
        wanted.sort();
        Ok(if found.is_empty() {
            Status::Off
        } else if found == wanted {
            Status::On
        } else {
            Status::Stale
        })
    }

    /// Adds the app's hooks (replacing any earlier ones of its own). True when the file changed.
    pub fn install(&self, home: &Path, cli: &Path, app: &AppId) -> io::Result<bool> {
        // Already in place: leave the file alone, so another app's hooks keep their order.
        if self.status(home, cli, app)? == Status::On {
            return Ok(false);
        }
        let path = self.config_path(home, app);
        match self.format {
            Format::Plugin => {
                let before = read_text(&path)?;
                if before.as_deref().is_some_and(|text| !text.starts_with(&plugin_mark(app))) {
                    return Err(invalid(format!("{} is not {}'s; move it away first", path.display(), app.title)));
                }
                write_text(&path, before.as_deref(), &plugin(cli, app), false, app)
            }
            Format::Toml { .. } => {
                let mut doc = read_toml(&path)?;
                let before = doc.to_string();
                toml_remove_ours(&mut doc, app);
                toml_add(&mut doc, &self.wanted(cli), &path, app)?;
                write_text(&path, path.exists().then_some(before.as_str()), &doc.to_string(), true, app)
            }
            _ => {
                let before = read_json(&path)?;
                let mut root = before.clone().unwrap_or_else(|| Value::Object(Map::new()));
                self.json_remove_ours(&mut root, app);
                self.json_add(&mut root, cli, &path, app)?;
                write_json(&path, before.as_ref(), &root, true, app)
            }
        }
    }

    /// Takes out the app's hooks only. True when the file changed.
    pub fn uninstall(&self, home: &Path, app: &AppId) -> io::Result<bool> {
        let path = self.config_path(home, app);
        match self.format {
            Format::Plugin => match read_text(&path)? {
                Some(text) if text.starts_with(&plugin_mark(app)) => std::fs::remove_file(&path).map(|()| true),
                _ => Ok(false),
            },
            Format::Toml { .. } => {
                let Some(before) = read_text(&path)? else { return Ok(false) };
                let mut doc = read_toml(&path)?;
                toml_remove_ours(&mut doc, app);
                write_text(&path, Some(&before), &doc.to_string(), false, app)
            }
            _ => {
                let Some(before) = read_json(&path)? else { return Ok(false) };
                let mut root = before.clone();
                self.json_remove_ours(&mut root, app);
                write_json(&path, Some(&before), &root, false, app)
            }
        }
    }

    /// The lists of handlers (by event) in a JSON file, wherever this agent keeps them.
    fn json_lists<'a>(&self, root: &'a Value) -> Vec<(&'a str, &'a Vec<Value>)> {
        let lists = |object: Option<&'a Map<String, Value>>| {
            object.into_iter().flatten().filter_map(|(event, list)| Some((event.as_str(), list.as_array()?))).collect::<Vec<_>>()
        };
        match self.format {
            Format::Named { .. } => root
                .as_object()
                .into_iter()
                .flatten()
                .filter(|(_, spec)| spec.is_object())
                .flat_map(|(_, spec)| lists(spec.as_object()))
                .collect(),
            _ => lists(root.get("hooks").and_then(Value::as_object)),
        }
    }

    fn json_ours(&self, root: &Value, app: &AppId) -> Hooks {
        let mut found = vec![];
        for (event, list) in self.json_lists(root) {
            for entry in list {
                // A handler, or a group of them.
                let handlers = entry.get("hooks").and_then(Value::as_array).map_or(std::slice::from_ref(entry), Vec::as_slice);
                for command in handlers.iter().filter_map(|handler| handler.get("command").and_then(Value::as_str)) {
                    if is_ours(command, app) {
                        found.push((event.to_owned(), command.to_owned()));
                    }
                }
            }
        }
        found
    }

    fn json_remove_ours(&self, root: &mut Value, app: &AppId) {
        match self.format {
            Format::Named { .. } => {
                let Some(object) = root.as_object_mut() else { return };
                let mut emptied = vec![];
                for (name, spec) in object.iter_mut() {
                    let Some(events) = spec.as_object_mut() else { continue };
                    let had = events.values().any(Value::is_array);
                    remove_from_lists(events, app);
                    if had && !events.values().any(Value::is_array) {
                        emptied.push(name.clone());
                    }
                }
                for name in emptied {
                    object.shift_remove(&name);
                }
            }
            _ => {
                let Some(hooks) = root.get_mut("hooks").and_then(Value::as_object_mut) else { return };
                remove_from_lists(hooks, app);
                // Cursor's own empty file is `{"version": 1, "hooks": {}}`.
                if hooks.is_empty() && !matches!(self.format, Format::Flat { .. }) {
                    if let Some(object) = root.as_object_mut() {
                        object.shift_remove("hooks");
                    }
                }
            }
        }
    }

    fn json_add(&self, root: &mut Value, cli: &Path, path: &Path, app: &AppId) -> io::Result<()> {
        let object = root.as_object_mut().ok_or_else(|| invalid(format!("{} is not a JSON object", path.display())))?;
        let handler = |command: &str| json!({ "type": "command", "command": command, "timeout": 10 });
        match self.format {
            Format::Named { .. } => {
                let mut spec = Map::new();
                for (event, command) in self.wanted(cli) {
                    spec.insert(event, json!([handler(&command)]));
                }
                object.insert(app.slug.into(), Value::Object(spec));
                return Ok(());
            }
            Format::Flat { .. } if !object.contains_key("version") => {
                object.shift_insert(0, "version".into(), json!(1));
            }
            _ => {}
        }
        let hooks = object
            .entry("hooks")
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()
            .ok_or_else(|| invalid(format!("\"hooks\" in {} is not an object", path.display())))?;
        for (event, command) in self.wanted(cli) {
            let entry = match self.format {
                Format::Grouped { events, background } => {
                    let matcher = events.iter().find(|(name, _)| *name == event).and_then(|(_, matcher)| *matcher);
                    let mut handler = handler(&command);
                    if background {
                        handler["async"] = Value::Bool(true);
                    }
                    let mut group = Map::new();
                    if let Some(matcher) = matcher {
                        group.insert("matcher".into(), Value::String(matcher.into()));
                    }
                    group.insert("hooks".into(), json!([handler]));
                    Value::Object(group)
                }
                _ => json!({ "command": command }),
            };
            let list = hooks.entry(event.clone()).or_insert_with(|| json!([]));
            let Some(list) = list.as_array_mut() else {
                return Err(invalid(format!("hooks.{event} in {} is not a list", path.display())));
            };
            list.push(entry);
        }
        Ok(())
    }
}

/// Drops the app's handlers from lists of handlers or of groups, then any group
/// or list they leave empty. Ones that were empty before are the user's and stay.
fn remove_from_lists(lists: &mut Map<String, Value>, app: &AppId) {
    let ours = |handler: &Value| handler.get("command").and_then(Value::as_str).is_some_and(|command| is_ours(command, app));
    let mut emptied = vec![];
    for (event, list) in lists.iter_mut() {
        let Some(list) = list.as_array_mut() else { continue };
        let had = list.len();
        list.retain_mut(|entry| {
            let Some(handlers) = entry.get_mut("hooks").and_then(Value::as_array_mut) else { return !ours(entry) };
            let before = handlers.len();
            handlers.retain(|handler| !ours(handler));
            before == handlers.len() || !handlers.is_empty()
        });
        if had > 0 && list.is_empty() {
            emptied.push(event.clone());
        }
    }
    for event in emptied {
        lists.shift_remove(&event);
    }
}

fn plugin(cli: &Path, app: &AppId) -> String {
    let cli = serde_json::to_string(&cli.to_string_lossy()).unwrap_or_default();
    let name: String = app.slug.split(|c: char| !c.is_ascii_alphanumeric()).map(|word| {
        let mut chars = word.chars();
        chars.next().map(|c| c.to_ascii_uppercase().to_string() + chars.as_str()).unwrap_or_default()
    }).collect();
    PLUGIN.replace("__TITLE_CASE__", &app.title_case())
        .replace("__TITLE__", app.title)
        .replace("__SLUG__", app.slug)
        .replace("__EXPORT__", &format!("{name}Plugin"))
        .replace("__CLI__", &cli)
}

fn invalid(message: String) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn read_text(path: &Path) -> io::Result<Option<String>> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

/// The file's JSON, None when there is no file. A file that isn't a JSON object
/// is an error: it is the user's, and we won't guess at it.
fn read_json(path: &Path) -> io::Result<Option<Value>> {
    let Some(body) = read_text(path)? else { return Ok(None) };
    if body.trim().is_empty() {
        return Ok(None);
    }
    match serde_json::from_str::<Value>(&body) {
        Ok(value @ Value::Object(_)) => Ok(Some(value)),
        Ok(_) => Err(invalid(format!("{} is not a JSON object", path.display()))),
        Err(error) => Err(invalid(format!("{} is not valid JSON ({error}); fix it first", path.display()))),
    }
}

fn read_toml(path: &Path) -> io::Result<toml_edit::DocumentMut> {
    let text = read_text(path)?.unwrap_or_default();
    text.parse().map_err(|error| invalid(format!("{} is not valid TOML ({error}); fix it first", path.display())))
}

fn toml_ours(doc: &toml_edit::DocumentMut, app: &AppId) -> Hooks {
    let Some(list) = doc.get("hooks").and_then(|hooks| hooks.get("hooks")).and_then(toml_edit::Item::as_array_of_tables) else {
        return vec![];
    };
    list.iter()
        .filter_map(|hook| {
            let command = hook.get("command")?.as_str()?;
            let event = hook.get("event").and_then(toml_edit::Item::as_str).unwrap_or_default();
            is_ours(command, app).then(|| (event.to_owned(), command.to_owned()))
        })
        .collect()
}

fn toml_remove_ours(doc: &mut toml_edit::DocumentMut, app: &AppId) {
    let Some(hooks) = doc.get_mut("hooks").and_then(toml_edit::Item::as_table_like_mut) else { return };
    let Some(list) = hooks.get_mut("hooks").and_then(toml_edit::Item::as_array_of_tables_mut) else { return };
    let had = list.len();
    list.retain(|hook| !hook.get("command").and_then(toml_edit::Item::as_str).is_some_and(|command| is_ours(command, app)));
    if had > 0 && list.is_empty() {
        hooks.remove("hooks");
        if hooks.is_empty() {
            doc.remove("hooks");
        }
    }
}

fn toml_add(doc: &mut toml_edit::DocumentMut, wanted: &Hooks, path: &Path, app: &AppId) -> io::Result<()> {
    let not_a_table = || invalid(format!("\"hooks\" in {} is not a table", path.display()));
    let hooks = doc.entry("hooks").or_insert_with(|| {
        let mut table = toml_edit::Table::new();
        table.set_implicit(true);
        toml_edit::Item::Table(table)
    });
    let hooks = hooks.as_table_like_mut().ok_or_else(not_a_table)?;
    let list = hooks.entry("hooks").or_insert(toml_edit::Item::ArrayOfTables(Default::default()));
    let list = list.as_array_of_tables_mut().ok_or_else(not_a_table)?;
    for (event, command) in wanted {
        let mut hook = toml_edit::Table::new();
        hook.insert("name", toml_edit::value(app.slug));
        hook.insert("event", toml_edit::value(event.as_str()));
        hook.insert("command", toml_edit::value(command.as_str()));
        hook.insert("background", toml_edit::value(true));
        hook.insert("timeout_secs", toml_edit::value(10));
        list.push(hook);
    }
    Ok(())
}

fn write_json(path: &Path, before: Option<&Value>, after: &Value, keep_original: bool, app: &AppId) -> io::Result<bool> {
    let empty = Value::Object(Map::new());
    if before.unwrap_or(&empty) == after {
        return Ok(false);
    }
    let mut body = serde_json::to_string_pretty(after).map_err(|error| invalid(error.to_string()))?;
    body.push('\n');
    write_text(path, None, &body, keep_original && before.is_some(), app)
}

/// Writes through a temporary file, when the text changed. Keeps a copy of the
/// user's original first, once, when `keep_original`.
fn write_text(path: &Path, before: Option<&str>, after: &str, keep_original: bool, app: &AppId) -> io::Result<bool> {
    if before == Some(after) {
        return Ok(false);
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let backup = path.with_file_name(format!("{}.{}.bak", path.file_name().and_then(|n| n.to_str()).unwrap_or("hooks"), app.slug));
    if keep_original && path.exists() && !backup.exists() {
        std::fs::copy(path, &backup)?;
    }
    let partial = path.with_extension(format!("{}.part", app.slug));
    std::fs::write(&partial, after)?;
    #[cfg(unix)]
    if let Ok(meta) = std::fs::metadata(path) {
        let _ = std::fs::set_permissions(&partial, meta.permissions());
    }
    std::fs::rename(&partial, path)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mushaf_protocol::MUSHAF;

    /// The hooks this machine's user already had in ~/.claude/settings.json.
    const USER_SETTINGS: &str = r#"{
  "model": "opus",
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "python3 /home/u/.claude/hooks/working-hours-gate.py", "timeout": 15 }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "python3 /home/u/.claude/skills/skill-picker/hook.py", "timeout": 6 }] }],
    "PreToolUse": [{ "matcher": "Agent", "hooks": [{ "type": "command", "command": "python3 /home/u/.claude/skills/model-picker/hook.py", "timeout": 6 }] }]
  },
  "statusLine": { "type": "command", "command": "x" }
}"#;

    fn home_with(agent: &Agent, body: Option<&str>) -> tempfile::TempDir {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(agent.places[0].0)).unwrap();
        if let Some(body) = body {
            let path = agent.config_path(home.path(), &MUSHAF);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, body).unwrap();
        }
        home
    }

    fn load(agent: &Agent, home: &Path) -> Value {
        serde_json::from_slice(&std::fs::read(agent.config_path(home, &MUSHAF)).unwrap()).unwrap()
    }

    fn text(agent: &Agent, home: &Path) -> String {
        std::fs::read_to_string(agent.config_path(home, &MUSHAF)).unwrap()
    }

    #[test]
    fn install_keeps_every_hook_the_user_had() {
        let home = home_with(&CLAUDE, Some(USER_SETTINGS));
        let cli = Path::new("/usr/bin/mushaf");
        assert_eq!(CLAUDE.status(home.path(), cli, &MUSHAF).unwrap(), Status::Off);
        assert!(CLAUDE.install(home.path(), cli, &MUSHAF).unwrap());

        let after = load(&CLAUDE, home.path());
        let original: Value = serde_json::from_str(USER_SETTINGS).unwrap();
        assert_eq!(after["model"], "opus");
        assert_eq!(after["statusLine"], original["statusLine"]);
        assert_eq!(after["hooks"]["PreToolUse"], original["hooks"]["PreToolUse"]);
        assert_eq!(after["hooks"]["Stop"][0], original["hooks"]["Stop"][0]);
        assert_eq!(after["hooks"]["UserPromptSubmit"][0], original["hooks"]["UserPromptSubmit"][0]);
        assert_eq!(after["hooks"]["Stop"][1]["hooks"][0]["command"], "/usr/bin/mushaf hook claude");
        assert_eq!(after["hooks"]["Stop"][1]["hooks"][0]["async"], true);
        assert_eq!(after["hooks"]["Notification"][0]["matcher"], "permission_prompt|elicitation_dialog");
        assert_eq!(CLAUDE.status(home.path(), cli, &MUSHAF).unwrap(), Status::On);

        // The original is kept once.
        let backup = home.path().join(".claude/settings.json.mushaf.bak");
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), USER_SETTINGS);

        // Twice is a no-op.
        assert!(!CLAUDE.install(home.path(), cli, &MUSHAF).unwrap());
        assert_eq!(load(&CLAUDE, home.path()), after);

        // Uninstall gives back exactly what the user had.
        assert!(CLAUDE.uninstall(home.path(), &MUSHAF).unwrap());
        assert_eq!(load(&CLAUDE, home.path()), original);
        assert_eq!(CLAUDE.status(home.path(), cli, &MUSHAF).unwrap(), Status::Off);
        assert!(!CLAUDE.uninstall(home.path(), &MUSHAF).unwrap());
    }

    #[test]
    fn keeps_the_users_key_order() {
        let home = home_with(&CLAUDE, Some(USER_SETTINGS));
        CLAUDE.install(home.path(), Path::new("/usr/bin/mushaf"), &MUSHAF).unwrap();
        let text = text(&CLAUDE, home.path());
        let at = |key: &str| text.find(key).unwrap();
        assert!(at("\"model\"") < at("\"hooks\"") && at("\"hooks\"") < at("\"statusLine\""));
        assert!(at("\"Stop\"") < at("\"UserPromptSubmit\"") && at("\"UserPromptSubmit\"") < at("\"PreToolUse\""));
    }

    #[test]
    fn a_moved_mushaf_is_stale_until_installed_again() {
        let home = home_with(&CLAUDE, None);
        CLAUDE.install(home.path(), Path::new("/opt/old/mushaf"), &MUSHAF).unwrap();
        let cli = Path::new("/usr/bin/mushaf");
        assert_eq!(CLAUDE.status(home.path(), cli, &MUSHAF).unwrap(), Status::Stale);
        assert!(CLAUDE.install(home.path(), cli, &MUSHAF).unwrap());
        assert_eq!(CLAUDE.status(home.path(), cli, &MUSHAF).unwrap(), Status::On);
        let after = load(&CLAUDE, home.path());
        assert_eq!(after["hooks"]["Stop"].as_array().unwrap().len(), 1, "the old hook is replaced, not doubled");
    }

    #[test]
    fn codex_gets_its_own_file() {
        let home = home_with(&CODEX, None);
        let cli = Path::new("C:\\Program Files\\Mushaf\\mushaf.exe");
        assert!(CODEX.install(home.path(), cli, &MUSHAF).unwrap());
        let after = load(&CODEX, home.path());
        assert_eq!(
            after["hooks"]["PermissionRequest"][0]["hooks"][0]["command"],
            "\"C:\\Program Files\\Mushaf\\mushaf.exe\" hook codex"
        );
        assert!(after["hooks"]["Stop"][0]["hooks"][0].get("async").is_none());
        assert_eq!(CODEX.status(home.path(), cli, &MUSHAF).unwrap(), Status::On);
        assert!(CODEX.uninstall(home.path(), &MUSHAF).unwrap());
        assert_eq!(load(&CODEX, home.path()), json!({}));
        assert!(!home.path().join(".codex/hooks.json.mushaf.bak").exists(), "there was no file to keep");
    }

    #[test]
    fn cursor_lists_handlers_under_each_event() {
        let users = r#"{"version":1,"hooks":{"afterFileEdit":[{"command":"./format.sh"}],"stop":[{"command":"./audit.sh"}]}}"#;
        let home = home_with(&CURSOR, Some(users));
        let cli = Path::new("/usr/bin/mushaf");
        assert!(CURSOR.install(home.path(), cli, &MUSHAF).unwrap());
        let after = load(&CURSOR, home.path());
        assert_eq!(after["version"], 1);
        assert_eq!(after["hooks"]["stop"], json!([{"command": "./audit.sh"}, {"command": "/usr/bin/mushaf hook cursor"}]));
        assert_eq!(after["hooks"]["beforeSubmitPrompt"], json!([{"command": "/usr/bin/mushaf hook cursor"}]));
        assert_eq!(CURSOR.status(home.path(), cli, &MUSHAF).unwrap(), Status::On);
        assert!(CURSOR.uninstall(home.path(), &MUSHAF).unwrap());
        assert_eq!(load(&CURSOR, home.path()), serde_json::from_str::<Value>(users).unwrap());

        // A new file starts as Cursor's own does.
        let home = home_with(&CURSOR, None);
        CURSOR.install(home.path(), cli, &MUSHAF).unwrap();
        assert!(text(&CURSOR, home.path()).trim_start().starts_with("{\n  \"version\": 1"));
        CURSOR.uninstall(home.path(), &MUSHAF).unwrap();
        assert_eq!(load(&CURSOR, home.path()), json!({"version": 1, "hooks": {}}));
    }

    #[test]
    fn antigravity_gets_a_named_hook_whose_commands_say_the_event() {
        let users = r#"{"lint":{"PostToolUse":[{"matcher":"run_command","hooks":[{"command":"./lint.sh"}]}]}}"#;
        let home = home_with(&ANTIGRAVITY, Some(users));
        let cli = Path::new("/usr/bin/mushaf");
        assert_eq!(ANTIGRAVITY.config_path(home.path(), &MUSHAF), home.path().join(".gemini/config/hooks.json"));
        assert!(ANTIGRAVITY.install(home.path(), cli, &MUSHAF).unwrap());
        let after = load(&ANTIGRAVITY, home.path());
        assert_eq!(after["lint"], serde_json::from_str::<Value>(users).unwrap()["lint"]);
        assert_eq!(after["mushaf"]["PreInvocation"][0]["command"], "/usr/bin/mushaf hook agy started");
        assert_eq!(after["mushaf"]["Stop"][0]["command"], "/usr/bin/mushaf hook agy finished");
        assert_eq!(ANTIGRAVITY.status(home.path(), cli, &MUSHAF).unwrap(), Status::On);
        assert_eq!(ANTIGRAVITY.status(home.path(), Path::new("/opt/mushaf"), &MUSHAF).unwrap(), Status::Stale);
        assert!(!ANTIGRAVITY.install(home.path(), cli, &MUSHAF).unwrap());
        assert!(ANTIGRAVITY.uninstall(home.path(), &MUSHAF).unwrap());
        assert_eq!(load(&ANTIGRAVITY, home.path()), serde_json::from_str::<Value>(users).unwrap());
    }

    #[test]
    fn deepseek_gets_toml_tables_and_keeps_the_rest_of_the_file() {
        let users = "# my settings\nmodel = \"deepseek-v4-pro\"  # the big one\n\n[hooks]\nenabled = true\n\n[[hooks.hooks]]\nevent = \"session_start\"\ncommand = \"echo hi\"\n";
        let home = home_with(&DEEPSEEK, Some(users));
        let cli = Path::new("/usr/bin/mushaf");
        assert!(DEEPSEEK.install(home.path(), cli, &MUSHAF).unwrap());
        let after = text(&DEEPSEEK, home.path());
        assert!(after.starts_with(users), "the user's lines stay as they were:\n{after}");
        let doc: toml_edit::DocumentMut = after.parse().unwrap();
        let hooks = doc["hooks"]["hooks"].as_array_of_tables().unwrap();
        assert_eq!(hooks.len(), 4);
        assert_eq!(hooks.get(1).unwrap()["event"].as_str(), Some("session_busy"));
        assert_eq!(hooks.get(1).unwrap()["command"].as_str(), Some("/usr/bin/mushaf hook deepseek started"));
        assert_eq!(hooks.get(1).unwrap()["background"].as_bool(), Some(true));
        assert_eq!(DEEPSEEK.status(home.path(), cli, &MUSHAF).unwrap(), Status::On);
        assert!(!DEEPSEEK.install(home.path(), cli, &MUSHAF).unwrap());
        assert!(DEEPSEEK.uninstall(home.path(), &MUSHAF).unwrap());
        assert_eq!(text(&DEEPSEEK, home.path()), users);
        assert_eq!(std::fs::read_to_string(home.path().join(".codewhale/config.toml.mushaf.bak")).unwrap(), users);

        // No file yet, and the old ~/.deepseek name.
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir(home.path().join(".deepseek")).unwrap();
        assert_eq!(DEEPSEEK.config_path(home.path(), &MUSHAF), home.path().join(".deepseek/config.toml"));
        DEEPSEEK.install(home.path(), cli, &MUSHAF).unwrap();
        assert!(text(&DEEPSEEK, home.path()).starts_with("[[hooks.hooks]]\nname = \"mushaf\""));
        DEEPSEEK.uninstall(home.path(), &MUSHAF).unwrap();
        assert_eq!(text(&DEEPSEEK, home.path()).trim(), "");
    }

    #[test]
    fn opencode_gets_a_plugin_of_ours() {
        let home = home_with(&OPENCODE, None);
        let cli = Path::new("C:\\Program Files\\Mushaf\\mushaf.exe");
        assert_eq!(OPENCODE.status(home.path(), cli, &MUSHAF).unwrap(), Status::Off);
        assert!(OPENCODE.install(home.path(), cli, &MUSHAF).unwrap());
        let plugin = text(&OPENCODE, home.path());
        assert!(plugin.contains(r#"const CLI = "C:\\Program Files\\Mushaf\\mushaf.exe""#));
        assert_eq!(OPENCODE.status(home.path(), cli, &MUSHAF).unwrap(), Status::On);
        assert_eq!(OPENCODE.status(home.path(), Path::new("/usr/bin/mushaf"), &MUSHAF).unwrap(), Status::Stale);
        assert!(!OPENCODE.install(home.path(), cli, &MUSHAF).unwrap());
        assert!(OPENCODE.uninstall(home.path(), &MUSHAF).unwrap());
        assert!(!OPENCODE.config_path(home.path(), &MUSHAF).exists());

        // A file of the user's by that name is left alone.
        std::fs::write(OPENCODE.config_path(home.path(), &MUSHAF), "export const Mine = async () => ({})\n").unwrap();
        assert!(OPENCODE.install(home.path(), cli, &MUSHAF).is_err());
        assert!(!OPENCODE.uninstall(home.path(), &MUSHAF).unwrap());
    }

    #[test]
    fn missing_agents_and_broken_files() {
        let home = tempfile::tempdir().unwrap();
        for agent in AGENTS {
            assert_eq!(agent.status(home.path(), Path::new("mushaf"), &MUSHAF).unwrap(), Status::Missing, "{}", agent.id);
        }
        let home = home_with(&CLAUDE, Some("{ \"hooks\": [ // a comment\n"));
        assert!(CLAUDE.install(home.path(), Path::new("mushaf"), &MUSHAF).is_err());
        assert_eq!(text(&CLAUDE, home.path()), "{ \"hooks\": [ // a comment\n");
        let home = home_with(&DEEPSEEK, Some("model = \n"));
        assert!(DEEPSEEK.install(home.path(), Path::new("mushaf"), &MUSHAF).is_err());
    }

    const OTHER: AppId = AppId { slug: "goals", program: "goals-desktop", title: "Goals", env: "GOALS" };

    #[test]
    fn two_apps_hooks_live_side_by_side() {
        let users = [
            (CLAUDE, Some(USER_SETTINGS)),
            (CODEX, None),
            (CURSOR, Some(r#"{"version":1,"hooks":{"stop":[{"command":"./audit.sh"}]}}"#)),
            (OPENCODE, None),
            (ANTIGRAVITY, Some(r#"{"lint":{"Stop":[{"command":"./lint.sh"}]}}"#)),
            (DEEPSEEK, Some("model = \"x\"\n")),
        ];
        let mushaf = Path::new("/usr/bin/mushaf");
        let goals = Path::new("/usr/bin/goals");
        for (agent, body) in users {
            let home = home_with(&agent, body);
            let original = body.map(str::to_owned);
            let read = |app: &AppId| std::fs::read_to_string(agent.config_path(home.path(), app)).ok();
            assert!(agent.install(home.path(), mushaf, &MUSHAF).unwrap(), "{}", agent.id);
            let with_mushaf = read(&MUSHAF);
            assert!(agent.install(home.path(), goals, &OTHER).unwrap(), "{}", agent.id);
            assert_eq!(agent.status(home.path(), mushaf, &MUSHAF).unwrap(), Status::On, "{}", agent.id);
            assert_eq!(agent.status(home.path(), goals, &OTHER).unwrap(), Status::On, "{}", agent.id);

            // Installing one again doesn't touch the other's.
            assert!(!agent.install(home.path(), mushaf, &MUSHAF).unwrap(), "{}", agent.id);
            assert_eq!(agent.status(home.path(), goals, &OTHER).unwrap(), Status::On, "{}", agent.id);

            // Taking one out leaves the other's exactly as they were.
            assert!(agent.uninstall(home.path(), &OTHER).unwrap(), "{}", agent.id);
            assert_eq!(read(&MUSHAF), with_mushaf, "{}", agent.id);
            assert_eq!(agent.status(home.path(), goals, &OTHER).unwrap(), Status::Off, "{}", agent.id);
            assert!(agent.uninstall(home.path(), &MUSHAF).unwrap(), "{}", agent.id);
            if agent.format != Format::Plugin {
                let after = read(&MUSHAF);
                match (agent.format, &original) {
                    (Format::Toml { .. }, _) | (_, None) => {}
                    (_, Some(original)) => assert_eq!(
                        serde_json::from_str::<Value>(&after.unwrap()).unwrap(),
                        serde_json::from_str::<Value>(original).unwrap(),
                        "{}",
                        agent.id
                    ),
                }
            }
        }
    }

    #[test]
    fn each_app_has_its_own_opencode_plugin() {
        let home = home_with(&OPENCODE, None);
        let cli = Path::new("/usr/bin/goals");
        assert_eq!(OPENCODE.config_path(home.path(), &MUSHAF), home.path().join(".config/opencode/plugin/mushaf.js"));
        assert_eq!(OPENCODE.config_path(home.path(), &OTHER), home.path().join(".config/opencode/plugin/goals.js"));
        OPENCODE.install(home.path(), cli, &OTHER).unwrap();
        let plugin = std::fs::read_to_string(OPENCODE.config_path(home.path(), &OTHER)).unwrap();
        assert!(plugin.starts_with("// Goals: tells Goals app when"));
        assert!(plugin.contains("export const GoalsPlugin = "));
        assert!(!plugin.contains("__"), "every placeholder is filled");
        let mushaf = plugin_text(Path::new("/usr/bin/mushaf"));
        assert!(mushaf.starts_with("// The Mushaf: tells the Mushaf app when"));
        assert!(mushaf.contains("export const MushafPlugin = "));
    }

    fn plugin_text(cli: &Path) -> String {
        plugin(cli, &MUSHAF)
    }

    #[test]
    fn recognises_only_our_commands() {
        assert!(is_ours("/usr/bin/mushaf hook claude", &MUSHAF));
        assert!(is_ours("\"C:\\Program Files\\Mushaf\\mushaf.exe\" hook codex", &MUSHAF));
        assert!(is_ours("mushaf hook aider started", &MUSHAF));
        assert!(!is_ours("python3 /home/u/mushaf/hook.py", &MUSHAF));
        assert!(!is_ours("/usr/bin/mushaf open 2:255", &MUSHAF));
        assert!(!is_ours("/usr/bin/mushaf-desktop hook claude", &MUSHAF));
        assert!(!is_ours("/usr/bin/goals hook claude", &MUSHAF));
        assert!(is_ours("/usr/bin/goals hook claude", &OTHER));
    }
}
