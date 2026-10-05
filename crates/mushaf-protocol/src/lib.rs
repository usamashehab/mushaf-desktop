//! What an agent's hook tells the Mushaf, and how each agent's own hook payload
//! becomes it. Only the agent, the session, what happened, the project's folder
//! name and where the transcript is are kept: prompts, messages and the
//! transcript's content never leave the hook.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const VERSION: u8 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// The agent started on a task (the user sent a prompt).
    Started,
    /// The agent finished its task and waits for the user.
    Finished,
    /// The agent is blocked on the user (a permission or a question) mid-task.
    Attention,
    /// The session ended or the task was interrupted: forget it, say nothing.
    Ended,
}

impl Kind {
    pub fn parse(text: &str) -> Option<Kind> {
        match text.to_ascii_lowercase().as_str() {
            "started" | "start" => Some(Kind::Started),
            "finished" | "finish" | "stop" | "done" => Some(Kind::Finished),
            "attention" | "waiting" => Some(Kind::Attention),
            "ended" | "end" => Some(Kind::Ended),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentEvent {
    pub v: u8,
    /// "claude", "codex", or any id a generic hook passes.
    pub agent: String,
    /// The agent's session id; "default" when it gives none.
    pub session: String,
    pub kind: Kind,
    /// The folder name of the project the agent works in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    /// The path of the session's transcript (or, for Antigravity, its log), to
    /// see a task interrupted by the user, which no hook reports. Only its last
    /// lines are ever read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transcript: Option<String>,
    /// ms since the epoch, when the hook ran.
    pub at: u64,
}

/// Agents that have their own normalizer. Any other id is treated as generic.
pub const KNOWN_AGENTS: &[&str] = &["claude", "codex", "cursor", "opencode", "agy", "deepseek"];

/// The display name of an agent id.
pub fn agent_name(agent: &str) -> String {
    match agent {
        "claude" => "Claude".into(),
        "codex" => "Codex".into(),
        "cursor" => "Cursor".into(),
        "opencode" => "OpenCode".into(),
        "agy" => "Antigravity".into(),
        "deepseek" => "DeepSeek".into(),
        other => {
            let mut chars = other.chars();
            chars.next().map(|c| c.to_uppercase().chain(chars).collect()).unwrap_or_default()
        }
    }
}

fn text<'a>(payload: &'a Value, key: &str) -> Option<&'a str> {
    payload.get(key).and_then(Value::as_str).filter(|s| !s.is_empty())
}

/// The last part of a path, on either separator.
pub fn folder_name(path: &str) -> Option<String> {
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
}

/// The first string in a list, such as the first of a window's folders.
fn first<'a>(payload: &'a Value, key: &str) -> Option<&'a str> {
    payload.get(key)?.as_array()?.first()?.as_str().filter(|s| !s.is_empty())
}

fn kind_of(agent: &str, payload: &Value) -> Option<Kind> {
    let event = text(payload, "hook_event_name")?;
    match (agent, event) {
        // Cursor names its events its own way. (It runs Claude Code's hooks too,
        // with these names, so they are never taken for Claude's.)
        ("cursor", "beforeSubmitPrompt") => Some(Kind::Started),
        ("cursor", "stop") => match text(payload, "status") {
            Some("aborted") => Some(Kind::Ended),
            _ => Some(Kind::Finished),
        },
        ("cursor", "sessionEnd") => Some(Kind::Ended),
        ("cursor", _) => None,
        (_, "UserPromptSubmit") => Some(Kind::Started),
        (_, "Stop") => Some(Kind::Finished),
        // Claude Code's turn ended on an error: it waits for the user all the same.
        ("claude", "StopFailure") => Some(Kind::Finished),
        (_, "SessionEnd" | "Interrupt") => Some(Kind::Ended),
        ("codex", "PermissionRequest") => Some(Kind::Attention),
        // Claude notifies for many things; only these mean "the agent waits for you".
        ("claude", "Notification") => match text(payload, "notification_type") {
            None | Some("permission_prompt" | "elicitation_dialog") => Some(Kind::Attention),
            Some(_) => None,
        },
        _ => None,
    }
}

/// The event an agent's hook payload means, or None for events the Mushaf ignores.
/// `forced` is the kind given on the command line (`mushaf hook <agent> <kind>`),
/// for agents whose payload doesn't name its event.
pub fn normalize(agent: &str, payload: &Value, forced: Option<Kind>, now_ms: u64) -> Option<AgentEvent> {
    let mut kind = forced.or_else(|| kind_of(agent, payload))?;
    // A turn the user stopped ends without an alert.
    if kind == Kind::Finished && was_stopped(agent, payload) {
        kind = Kind::Ended;
    }
    let session = text(payload, "session_id")
        .or_else(|| text(payload, "thread_id"))
        .or_else(|| text(payload, "conversation_id"))
        .or_else(|| text(payload, "conversationId"))
        .or_else(|| text(payload, "session"))
        .unwrap_or("default");
    let folder = text(payload, "cwd")
        .or_else(|| first(payload, "workspace_roots"))
        .or_else(|| first(payload, "workspacePaths"))
        .or_else(|| text(payload, "workspace"));
    // Only these are read, to see an interrupted task. Antigravity's is its
    // log, which the CLI finds and passes as `transcript_path`.
    let transcript = matches!(agent, "claude" | "codex" | "agy").then(|| text(payload, "transcript_path")).flatten();

    Some(AgentEvent {
        v: VERSION,
        agent: agent.to_owned(),
        session: session.chars().take(128).collect(),
        kind,
        project: folder.and_then(folder_name),
        transcript: transcript.map(str::to_owned),
        at: now_ms,
    })
}

/// Whether the agent says "started" again during one task: Antigravity before
/// each model call, DeepSeek TUI each time it gets back to work after waiting
/// on the user. Other agents' "started" is a new prompt, a new task.
pub fn says_started_mid_task(agent: &str) -> bool {
    matches!(agent, "agy" | "deepseek")
}

/// Antigravity's log, one per CLI run: the last word on the conversation
/// decides, a cancel or the CLI quitting against a new message.
fn agy_log_interrupted(session: &str, tail: &str) -> bool {
    let cancelled = format!("Cancelling conversation {session}");
    let sent = format!("cascade_id:{session}");
    for line in tail.lines().rev() {
        if line.contains(&cancelled) || line.contains("Got signal interrupt, shutting down") {
            return true;
        }
        if line.contains("SEND_USER_CASCADE_MESSAGE") && line.contains(&sent) {
            return false;
        }
    }
    false
}

/// Whether a payload that ends a turn says the user stopped it.
fn was_stopped(agent: &str, payload: &Value) -> bool {
    match agent {
        // Stopping a turn clears its status before the session goes idle.
        "deepseek" => !matches!(text(payload, "last_turn_status"), Some("completed" | "failed")),
        "agy" => text(payload, "terminationReason").is_some_and(|reason| reason.ends_with("USER_CANCELED")),
        _ => false,
    }
}

/// Whether the transcript's last lines show the user stopped the task (Esc or
/// Ctrl+C), which ends it without a Stop hook. `tail` is the end of the file.
pub fn was_interrupted(agent: &str, session: &str, tail: &str) -> bool {
    if agent == "agy" {
        return agy_log_interrupted(session, tail);
    }
    for line in tail.lines().rev() {
        let Ok(record) = serde_json::from_str::<Value>(line) else { continue };
        match agent {
            // The last message decides: Claude Code records the interruption as one.
            "claude" => {
                if matches!(record.get("type").and_then(Value::as_str), Some("user" | "assistant")) {
                    return line.contains("[Request interrupted by user");
                }
            }
            // The last turn event decides.
            "codex" => match record.pointer("/payload/type").and_then(Value::as_str) {
                Some("turn_aborted") => return true,
                Some("task_started" | "task_complete") => return false,
                _ => {}
            },
            _ => return false,
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Recorded from Claude Code 2.1 and Codex 0.156, prompts shortened.
    fn claude(event: &str) -> Value {
        json!({
            "session_id": "8f1c2a", "transcript_path": "/home/u/.claude/projects/x.jsonl",
            "cwd": "/home/u/code/shop-api", "permission_mode": "default",
            "hook_event_name": event, "prompt": "a secret prompt"
        })
    }

    #[test]
    fn claude_events() {
        let started = normalize("claude", &claude("UserPromptSubmit"), None, 5).unwrap();
        assert_eq!(started.kind, Kind::Started);
        assert_eq!(started.session, "8f1c2a");
        assert_eq!(started.project.as_deref(), Some("shop-api"));
        assert_eq!(started.at, 5);
        assert_eq!(normalize("claude", &claude("Stop"), None, 0).unwrap().kind, Kind::Finished);
        assert_eq!(normalize("claude", &claude("StopFailure"), None, 0).unwrap().kind, Kind::Finished);
        assert_eq!(normalize("claude", &claude("SessionEnd"), None, 0).unwrap().kind, Kind::Ended);
        assert!(normalize("claude", &claude("PreToolUse"), None, 0).is_none());
        assert!(normalize("claude", &claude("SubagentStop"), None, 0).is_none());
    }

    #[test]
    fn claude_notifications_only_when_waiting() {
        let mut payload = claude("Notification");
        payload["notification_type"] = json!("permission_prompt");
        assert_eq!(normalize("claude", &payload, None, 0).unwrap().kind, Kind::Attention);
        payload["notification_type"] = json!("idle_prompt");
        assert!(normalize("claude", &payload, None, 0).is_none());
    }

    #[test]
    fn codex_events() {
        let payload = json!({
            "session_id": "019a-77", "turn_id": "t1", "cwd": "C:\\work\\mushaf\\",
            "hook_event_name": "PermissionRequest", "model": "gpt-5", "tool_input": {"command": "rm"}
        });
        let event = normalize("codex", &payload, None, 0).unwrap();
        assert_eq!(event.kind, Kind::Attention);
        assert_eq!(event.project.as_deref(), Some("mushaf"));
        let stop = json!({"session_id": "019a-77", "hook_event_name": "Stop", "last_assistant_message": "done"});
        assert_eq!(normalize("codex", &stop, None, 0).unwrap().kind, Kind::Finished);
        let end = json!({"session_id": "019a-77", "hook_event_name": "SessionEnd"});
        assert_eq!(normalize("codex", &end, None, 0).unwrap().kind, Kind::Ended);
    }

    #[test]
    fn cursor_events() {
        // As Cursor 3.12 builds it: its own input, then the ids and the window's folders.
        let cursor = |event: &str| {
            json!({
                "conversation_id": "c-1", "generation_id": "g", "prompt": "a secret prompt",
                "session_id": "c-1", "hook_event_name": event, "cursor_version": "3.12.17",
                "workspace_roots": ["/home/u/code/shop-api"], "user_email": "u@example.com",
                "transcript_path": "/home/u/.cursor/projects/x/agent-transcripts/c-1.jsonl"
            })
        };
        let started = normalize("cursor", &cursor("beforeSubmitPrompt"), None, 0).unwrap();
        assert_eq!((started.kind, started.session.as_str()), (Kind::Started, "c-1"));
        assert_eq!(started.project.as_deref(), Some("shop-api"));
        assert_eq!(started.transcript, None, "only Claude's and Codex's transcripts are read");
        let mut stop = cursor("stop");
        stop["status"] = json!("completed");
        assert_eq!(normalize("cursor", &stop, None, 0).unwrap().kind, Kind::Finished);
        stop["status"] = json!("error");
        assert_eq!(normalize("cursor", &stop, None, 0).unwrap().kind, Kind::Finished);
        stop["status"] = json!("aborted");
        assert_eq!(normalize("cursor", &stop, None, 0).unwrap().kind, Kind::Ended);
        assert_eq!(normalize("cursor", &cursor("sessionEnd"), None, 0).unwrap().kind, Kind::Ended);
        assert!(normalize("cursor", &cursor("afterFileEdit"), None, 0).is_none());
        // Cursor runs Claude Code's hooks with its own event names: not Claude's turn.
        assert!(normalize("claude", &cursor("beforeSubmitPrompt"), None, 0).is_none());
        assert!(normalize("claude", &stop, None, 0).is_none());
    }

    #[test]
    fn events_named_on_the_command_line() {
        // Antigravity: camelCase, no event name.
        let agy = json!({"conversationId": "ec33", "workspacePaths": ["/w/mushaf"], "invocationNum": 1});
        let event = normalize("agy", &agy, Some(Kind::Started), 0).unwrap();
        assert_eq!((event.session.as_str(), event.project.as_deref()), ("ec33", Some("mushaf")));
        let stop = json!({"conversationId": "ec33", "terminationReason": "EXECUTOR_TERMINATION_REASON_NO_TOOL_CALL", "fullyIdle": true});
        assert_eq!(normalize("agy", &stop, Some(Kind::Finished), 0).unwrap().kind, Kind::Finished);

        // DeepSeek TUI: the ids come from its environment (the CLI adds them), the state on stdin.
        let idle = json!({"from": "in_progress", "to": "idle", "last_turn_status": "completed", "session_id": "sess_1", "workspace": "/w/api"});
        let event = normalize("deepseek", &idle, Some(Kind::Finished), 0).unwrap();
        assert_eq!((event.kind, event.session.as_str(), event.project.as_deref()), (Kind::Finished, "sess_1", Some("api")));
        let stopped = json!({"to": "idle", "last_turn_status": "interrupted", "session_id": "sess_1"});
        assert_eq!(normalize("deepseek", &stopped, Some(Kind::Finished), 0).unwrap().kind, Kind::Ended);
        // Esc, as DeepSeek TUI 0.10 reports it.
        let escaped = json!({"from": "in_progress", "to": "idle", "session_id": "sess_1"});
        assert_eq!(normalize("deepseek", &escaped, Some(Kind::Finished), 0).unwrap().kind, Kind::Ended);
        let failed = json!({"to": "idle", "last_turn_status": "failed", "session_id": "sess_1"});
        assert_eq!(normalize("deepseek", &failed, Some(Kind::Finished), 0).unwrap().kind, Kind::Finished);

        // OpenCode's plugin sends just these.
        let event = normalize("opencode", &json!({"session_id": "ses_9", "cwd": "/w/web"}), Some(Kind::Attention), 0).unwrap();
        assert_eq!((event.kind, event.session.as_str(), event.project.as_deref()), (Kind::Attention, "ses_9", Some("web")));
        assert_eq!(agent_name("agy"), "Antigravity");
    }

    #[test]
    fn the_event_carries_nothing_else() {
        let event = normalize("claude", &claude("UserPromptSubmit"), None, 1).unwrap();
        let wire = serde_json::to_string(&event).unwrap();
        assert!(!wire.contains("secret"));
        assert_eq!(event.transcript.as_deref(), Some("/home/u/.claude/projects/x.jsonl"));
        assert_eq!(serde_json::from_str::<AgentEvent>(&wire).unwrap(), event);
    }

    #[test]
    fn sees_a_task_the_user_interrupted() {
        let claude = [
            r#"{"type":"user","message":{"role":"user","content":"read the file"}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash"}]}}"#,
        ];
        let interrupted = r#"{"type":"user","message":{"content":[{"type":"text","text":"[Request interrupted by user for tool use]"}]}}"#;
        let attachment = r#"{"type":"attachment","attachment":{"type":"deferred_tools_record"}}"#;
        assert!(!was_interrupted("claude", "s", &claude.join("\n")));
        assert!(was_interrupted("claude", "s", &[claude[0], claude[1], interrupted, attachment].join("\n")));
        // A half-written last line, cut by the tail, is skipped.
        assert!(was_interrupted("claude", "s", &[interrupted, "{\"type\":\"assist"].join("\n")));

        let started = r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"t"}}"#;
        let aborted = r#"{"type":"event_msg","payload":{"type":"turn_aborted","reason":"interrupted"}}"#;
        let item = r#"{"type":"response_item","payload":{"type":"message"}}"#;
        assert!(!was_interrupted("codex", "s", &[started, item].join("\n")));
        assert!(was_interrupted("codex", "s", &[started, item, aborted, item].join("\n")));
        assert!(!was_interrupted("codex", "s", &[aborted, started].join("\n")));
        assert!(!was_interrupted("aider", "s", aborted));

        // Antigravity's log, as agy 1.2 writes it.
        let sent = "I1005 10:41:55.09 1268 latency_breakdown.go:170] SEND_USER_CASCADE_MESSAGE_LATENCY latency breakdown: map[blocking:false cascade_id:c1 cascade_send_latency_ms:1]";
        let confirmed = "I1005 10:42:17.14 2178 server.go:2521] Tool confirmation for conversation c1 step 2 (approved=true)";
        let cancelled = "I1005 10:42:23.26 2299 server.go:2336] Cancelling conversation c1 (killBackgroundTasks=false)";
        let quit = "I1005 10:42:31.52 237 server.go:2956] Got signal interrupt, shutting down";
        assert!(!was_interrupted("agy", "c1", &[sent, confirmed].join("\n")));
        assert!(was_interrupted("agy", "c1", &[sent, confirmed, cancelled].join("\n")));
        assert!(!was_interrupted("agy", "c1", &[cancelled, sent].join("\n")), "a new message after the cancel");
        assert!(was_interrupted("agy", "c1", &[sent, quit].join("\n")));
        assert!(!was_interrupted("agy", "c2", &[sent, cancelled].join("\n")), "another conversation");
        let stop = json!({"conversationId": "c1", "terminationReason": "EXECUTOR_TERMINATION_REASON_USER_CANCELED"});
        assert_eq!(normalize("agy", &stop, Some(Kind::Finished), 0).unwrap().kind, Kind::Ended);
    }

    #[test]
    fn generic_agents_name_their_event() {
        let event = normalize("aider", &Value::Null, Kind::parse("start"), 0).unwrap();
        assert_eq!((event.kind, event.session.as_str(), event.project), (Kind::Started, "default", None));
        assert!(normalize("aider", &Value::Null, None, 0).is_none());
        assert_eq!(agent_name("aider"), "Aider");
        assert_eq!(agent_name("claude"), "Claude");
    }
}
