//! Adds the Mushaf's hooks to a coding agent's settings, and takes them out again.
//!
//! The agent's file is edited, never replaced: every hook the user already has
//! stays as it was, a copy of the file is kept before the first change, and the
//! file is written only when something changed. Our hooks are the commands that
//! run a `mushaf` program with `hook` as their first argument.

use std::io;
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Agent {
    pub id: &'static str,
    pub name: &'static str,
    /// The agent's own folder in the home folder; it is installed when this exists.
    home_dir: &'static str,
    /// The file holding its hooks, inside `home_dir`.
    file: &'static str,
    /// The hook events we listen to, with the matcher each needs.
    events: &'static [(&'static str, Option<&'static str>)],
    /// Whether the agent may run our hook in the background (Claude Code may).
    background: bool,
    /// What the user has to do once before the hooks run, if anything.
    pub note: Option<&'static str>,
}

pub const CLAUDE: Agent = Agent {
    id: "claude",
    name: "Claude Code",
    home_dir: ".claude",
    file: "settings.json",
    events: &[
        ("UserPromptSubmit", None),
        ("Stop", None),
        ("Notification", Some("permission_prompt|elicitation_dialog")),
        ("SessionEnd", None),
    ],
    background: true,
    note: None,
};

pub const CODEX: Agent = Agent {
    id: "codex",
    name: "Codex",
    home_dir: ".codex",
    file: "hooks.json",
    events: &[("UserPromptSubmit", None), ("Stop", None), ("PermissionRequest", None)],
    background: false,
    note: Some("Codex asks once to trust new hooks: start codex and choose \"Trust all and continue\"."),
};

pub const AGENTS: &[Agent] = &[CLAUDE, CODEX];

pub fn find(id: &str) -> Option<Agent> {
    AGENTS.iter().copied().find(|agent| agent.id == id)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// The agent isn't on this machine.
    Missing,
    /// No Mushaf hooks.
    Off,
    /// All our hooks, pointing at this `mushaf`.
    On,
    /// Some of our hooks, or ones pointing at another `mushaf`: install again to fix.
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

/// Whether a command line is one of ours.
pub fn is_ours(command: &str) -> bool {
    let (program, rest) = split_command(command);
    // Either separator, so a Windows path reads right everywhere.
    let file = program.rsplit(['/', '\\']).next().unwrap_or("");
    let stem = file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(file);
    stem.eq_ignore_ascii_case("mushaf") && rest.trim_start().starts_with("hook ")
}

impl Agent {
    pub fn config_path(&self, home: &Path) -> PathBuf {
        home.join(self.home_dir).join(self.file)
    }

    pub fn detect(&self, home: &Path) -> bool {
        home.join(self.home_dir).is_dir()
    }

    fn handler(&self, cli: &Path) -> Value {
        let mut handler = json!({ "type": "command", "command": hook_command(cli, self.id), "timeout": 10 });
        if self.background {
            handler["async"] = Value::Bool(true);
        }
        handler
    }

    pub fn status(&self, home: &Path, cli: &Path) -> io::Result<Status> {
        if !self.detect(home) {
            return Ok(Status::Missing);
        }
        let Some(root) = read(&self.config_path(home))? else {
            return Ok(Status::Off);
        };
        let wanted = hook_command(cli, self.id);
        let mut found = 0;
        let mut current = 0;
        for (event, _) in self.events {
            let commands = ours_in(&root, event);
            found += commands.len();
            current += usize::from(commands.iter().any(|command| *command == wanted));
        }
        Ok(if found == 0 {
            Status::Off
        } else if current == self.events.len() && found == current {
            Status::On
        } else {
            Status::Stale
        })
    }

    /// Adds our hooks (replacing any earlier ones of ours). True when the file changed.
    pub fn install(&self, home: &Path, cli: &Path) -> io::Result<bool> {
        let path = self.config_path(home);
        let before = read(&path)?;
        let mut root = before.clone().unwrap_or_else(|| Value::Object(Map::new()));
        remove_ours(&mut root);
        let hooks = hooks_of(&mut root)?;
        for (event, matcher) in self.events {
            let groups = hooks.entry(event.to_string()).or_insert_with(|| Value::Array(vec![]));
            let Some(groups) = groups.as_array_mut() else {
                return Err(invalid(format!("hooks.{event} in {} is not a list", path.display())));
            };
            let mut group = Map::new();
            if let Some(matcher) = matcher {
                group.insert("matcher".into(), Value::String(matcher.to_string()));
            }
            group.insert("hooks".into(), Value::Array(vec![self.handler(cli)]));
            groups.push(Value::Object(group));
        }
        write_if_changed(&path, before.as_ref(), &root, true)
    }

    /// Takes out our hooks only. True when the file changed.
    pub fn uninstall(&self, home: &Path) -> io::Result<bool> {
        let path = self.config_path(home);
        let Some(before) = read(&path)? else { return Ok(false) };
        let mut root = before.clone();
        remove_ours(&mut root);
        write_if_changed(&path, Some(&before), &root, false)
    }
}

fn invalid(message: String) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

/// The file's JSON, None when there is no file. A file that isn't a JSON object
/// is an error: it is the user's, and we won't guess at it.
fn read(path: &Path) -> io::Result<Option<Value>> {
    let body = match std::fs::read(path) {
        Ok(body) => body,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    if body.iter().all(u8::is_ascii_whitespace) {
        return Ok(None);
    }
    match serde_json::from_slice::<Value>(&body) {
        Ok(value @ Value::Object(_)) => Ok(Some(value)),
        Ok(_) => Err(invalid(format!("{} is not a JSON object", path.display()))),
        Err(error) => Err(invalid(format!("{} is not valid JSON ({error}); fix it first", path.display()))),
    }
}

fn hooks_of(root: &mut Value) -> io::Result<&mut Map<String, Value>> {
    let object = root.as_object_mut().ok_or_else(|| invalid("not a JSON object".into()))?;
    object
        .entry("hooks")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| invalid("\"hooks\" is not an object".into()))
}

fn ours_in<'a>(root: &'a Value, event: &str) -> Vec<&'a str> {
    root.pointer(&format!("/hooks/{event}"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|group| group.get("hooks").and_then(Value::as_array))
        .flatten()
        .filter_map(|handler| handler.get("command").and_then(Value::as_str))
        .filter(|command| is_ours(command))
        .collect()
}

/// Drops our handlers, then any group or event they leave empty. Groups and
/// events that were empty before are the user's and stay.
fn remove_ours(root: &mut Value) {
    let Some(hooks) = root.get_mut("hooks").and_then(Value::as_object_mut) else { return };
    let mut emptied = vec![];
    for (event, groups) in hooks.iter_mut() {
        let Some(list) = groups.as_array_mut() else { continue };
        let had = list.len();
        list.retain_mut(|group| {
            let Some(handlers) = group.get_mut("hooks").and_then(Value::as_array_mut) else { return true };
            let before = handlers.len();
            handlers.retain(|handler| !handler.get("command").and_then(Value::as_str).is_some_and(is_ours));
            before == handlers.len() || !handlers.is_empty()
        });
        if had > 0 && list.is_empty() {
            emptied.push(event.clone());
        }
    }
    for event in emptied {
        hooks.shift_remove(&event);
    }
    if hooks.is_empty() {
        if let Some(object) = root.as_object_mut() {
            object.shift_remove("hooks");
        }
    }
}

/// Writes through a temporary file. Installing keeps a copy of the user's original first, once.
fn write_if_changed(path: &Path, before: Option<&Value>, after: &Value, keep_original: bool) -> io::Result<bool> {
    let empty = Value::Object(Map::new());
    if before.unwrap_or(&empty) == after {
        return Ok(false);
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let backup = path.with_file_name(format!("{}.mushaf.bak", path.file_name().and_then(|n| n.to_str()).unwrap_or("hooks")));
    if keep_original && before.is_some() && !backup.exists() {
        std::fs::copy(path, &backup)?;
    }
    let mut body = serde_json::to_vec_pretty(after).map_err(|error| invalid(error.to_string()))?;
    body.push(b'\n');
    let partial = path.with_extension("mushaf.part");
    std::fs::write(&partial, body)?;
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
        std::fs::create_dir_all(home.path().join(agent.home_dir)).unwrap();
        if let Some(body) = body {
            std::fs::write(agent.config_path(home.path()), body).unwrap();
        }
        home
    }

    fn load(agent: &Agent, home: &Path) -> Value {
        serde_json::from_slice(&std::fs::read(agent.config_path(home)).unwrap()).unwrap()
    }

    #[test]
    fn install_keeps_every_hook_the_user_had() {
        let home = home_with(&CLAUDE, Some(USER_SETTINGS));
        let cli = Path::new("/usr/bin/mushaf");
        assert_eq!(CLAUDE.status(home.path(), cli).unwrap(), Status::Off);
        assert!(CLAUDE.install(home.path(), cli).unwrap());

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
        assert_eq!(CLAUDE.status(home.path(), cli).unwrap(), Status::On);

        // The original is kept once.
        let backup = home.path().join(".claude/settings.json.mushaf.bak");
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), USER_SETTINGS);

        // Twice is a no-op.
        assert!(!CLAUDE.install(home.path(), cli).unwrap());
        assert_eq!(load(&CLAUDE, home.path()), after);

        // Uninstall gives back exactly what the user had.
        assert!(CLAUDE.uninstall(home.path()).unwrap());
        assert_eq!(load(&CLAUDE, home.path()), original);
        assert_eq!(CLAUDE.status(home.path(), cli).unwrap(), Status::Off);
        assert!(!CLAUDE.uninstall(home.path()).unwrap());
    }

    #[test]
    fn keeps_the_users_key_order() {
        let home = home_with(&CLAUDE, Some(USER_SETTINGS));
        CLAUDE.install(home.path(), Path::new("/usr/bin/mushaf")).unwrap();
        let text = std::fs::read_to_string(CLAUDE.config_path(home.path())).unwrap();
        let at = |key: &str| text.find(key).unwrap();
        assert!(at("\"model\"") < at("\"hooks\"") && at("\"hooks\"") < at("\"statusLine\""));
        assert!(at("\"Stop\"") < at("\"UserPromptSubmit\"") && at("\"UserPromptSubmit\"") < at("\"PreToolUse\""));
    }

    #[test]
    fn a_moved_mushaf_is_stale_until_installed_again() {
        let home = home_with(&CLAUDE, None);
        CLAUDE.install(home.path(), Path::new("/opt/old/mushaf")).unwrap();
        let cli = Path::new("/usr/bin/mushaf");
        assert_eq!(CLAUDE.status(home.path(), cli).unwrap(), Status::Stale);
        assert!(CLAUDE.install(home.path(), cli).unwrap());
        assert_eq!(CLAUDE.status(home.path(), cli).unwrap(), Status::On);
        let after = load(&CLAUDE, home.path());
        assert_eq!(after["hooks"]["Stop"].as_array().unwrap().len(), 1, "the old hook is replaced, not doubled");
    }

    #[test]
    fn codex_gets_its_own_file() {
        let home = home_with(&CODEX, None);
        let cli = Path::new("C:\\Program Files\\Mushaf\\mushaf.exe");
        assert!(CODEX.install(home.path(), cli).unwrap());
        let after = load(&CODEX, home.path());
        assert_eq!(
            after["hooks"]["PermissionRequest"][0]["hooks"][0]["command"],
            "\"C:\\Program Files\\Mushaf\\mushaf.exe\" hook codex"
        );
        assert!(after["hooks"]["Stop"][0]["hooks"][0].get("async").is_none());
        assert_eq!(CODEX.status(home.path(), cli).unwrap(), Status::On);
        assert!(CODEX.uninstall(home.path()).unwrap());
        assert_eq!(load(&CODEX, home.path()), json!({}));
        assert!(!home.path().join(".codex/hooks.json.mushaf.bak").exists(), "there was no file to keep");
    }

    #[test]
    fn missing_agents_and_broken_files() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(CODEX.status(home.path(), Path::new("mushaf")).unwrap(), Status::Missing);
        let home = home_with(&CLAUDE, Some("{ \"hooks\": [ // a comment\n"));
        assert!(CLAUDE.install(home.path(), Path::new("mushaf")).is_err());
        assert_eq!(std::fs::read_to_string(CLAUDE.config_path(home.path())).unwrap(), "{ \"hooks\": [ // a comment\n");
    }

    #[test]
    fn recognises_only_our_commands() {
        assert!(is_ours("/usr/bin/mushaf hook claude"));
        assert!(is_ours("\"C:\\Program Files\\Mushaf\\mushaf.exe\" hook codex"));
        assert!(is_ours("mushaf hook aider started"));
        assert!(!is_ours("python3 /home/u/mushaf/hook.py"));
        assert!(!is_ours("/usr/bin/mushaf open 2:255"));
        assert!(!is_ours("/usr/bin/mushaf-desktop hook claude"));
    }
}
