//! What to do about the agents at work: the rules, apart from windows and clocks.
//!
//! An agent that has worked on one task for its minutes gets the Mushaf opened
//! (once per task). When it finishes, or stops to wait for the user, the Mushaf
//! shows a banner if it is open, and a notification or a sound if asked for.

use std::collections::BTreeMap;

use mushaf_ipc::{Heard, Session};
use mushaf_protocol::{says_started_mid_task, AgentEvent, Kind};
use serde::Serialize;
use serde_json::Value;

/// A task this long without a word from its agent is forgotten.
const FORGET_AFTER_MS: u64 = 6 * 60 * 60 * 1000;
/// How often the transcripts are looked at for a task the user interrupted.
const CHECK_EVERY_MS: u64 = 5_000;

/// Whether an agent's transcript or log (by path) shows the session's task
/// interrupted: (agent, session, path).
pub type Interrupted<'a> = &'a dyn Fn(&str, &str, &str) -> bool;

#[derive(Debug, Clone, PartialEq)]
pub struct AgentPrefs {
    pub enabled: bool,
    pub open_after_minutes: f64,
}

/// The parts of the reader's settings this side acts on.
#[derive(Debug, Clone, PartialEq)]
pub struct Prefs {
    pub agents: BTreeMap<String, AgentPrefs>,
    pub defaults: AgentPrefs,
    pub focus_on_open: bool,
    pub notify: bool,
    pub notify_when_closed: bool,
    pub sound: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            agents: BTreeMap::new(),
            defaults: AgentPrefs { enabled: true, open_after_minutes: 2.0 },
            focus_on_open: true,
            notify: false,
            notify_when_closed: false,
            sound: false,
        }
    }
}

impl Prefs {
    /// From the reader's settings.json; anything missing or odd keeps its default.
    pub fn from_settings(settings: &Value) -> Prefs {
        let mut prefs = Prefs::default();
        let agent = |value: Option<&Value>, fallback: &AgentPrefs| AgentPrefs {
            enabled: value.and_then(|v| v.get("enabled")).and_then(Value::as_bool).unwrap_or(fallback.enabled),
            open_after_minutes: value
                .and_then(|v| v.get("openAfterMinutes"))
                .and_then(Value::as_f64)
                .filter(|m| m.is_finite() && *m >= 0.0)
                .unwrap_or(fallback.open_after_minutes),
        };
        prefs.defaults = agent(settings.get("agentDefaults"), &prefs.defaults);
        if let Some(agents) = settings.get("agents").and_then(Value::as_object) {
            for (id, value) in agents {
                prefs.agents.insert(id.clone(), agent(Some(value), &prefs.defaults));
            }
        }
        let alerts = settings.get("alerts");
        let flag = |key: &str, fallback: bool| alerts.and_then(|a| a.get(key)).and_then(Value::as_bool).unwrap_or(fallback);
        prefs.focus_on_open = flag("focusOnOpen", prefs.focus_on_open);
        prefs.notify = flag("notify", prefs.notify);
        prefs.notify_when_closed = flag("notifyWhenClosed", prefs.notify_when_closed);
        prefs.sound = flag("sound", prefs.sound);
        prefs
    }

    pub fn agent(&self, id: &str) -> &AgentPrefs {
        self.agents.get(id).unwrap_or(&self.defaults)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct WindowState {
    /// Shown and not minimized.
    pub visible: bool,
    pub focused: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AlertKind {
    Finished,
    Attention,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Alert {
    pub agent: String,
    pub project: Option<String>,
    pub kind: AlertKind,
    pub at: u64,
    /// How long the agent worked on it, when known.
    pub worked_ms: Option<u64>,
    #[serde(skip)]
    pub banner: bool,
    #[serde(skip)]
    pub notify: bool,
    pub sound: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    /// Show the window for an agent at work; bring it to the front when `focus`.
    Open { focus: bool },
    Alert(Alert),
    /// The sessions list changed.
    Sessions,
}

#[derive(Debug, Clone, PartialEq)]
struct Tracked {
    project: Option<String>,
    transcript: Option<String>,
    started_at: u64,
    due: Option<u64>,
    opened: bool,
}

#[derive(Debug, Default)]
pub struct Engine {
    sessions: BTreeMap<(String, String), Tracked>,
    /// The last event from each agent.
    heard: BTreeMap<String, Heard>,
    next_check: u64,
    /// No opening and no alerts before this (ms since the epoch).
    pub paused_until: Option<u64>,
}

impl Engine {
    pub fn paused(until: Option<u64>) -> Self {
        Engine { paused_until: until, ..Engine::default() }
    }

    pub fn is_paused(&self, now: u64) -> bool {
        self.paused_until.is_some_and(|until| now < until)
    }

    pub fn on_event(&mut self, event: &AgentEvent, now: u64, prefs: &Prefs, window: WindowState) -> Vec<Action> {
        let key = (event.agent.clone(), event.session.clone());
        let agent = prefs.agent(&event.agent);
        let heard = Heard { agent: event.agent.clone(), kind: event.kind, project: event.project.clone(), at: now };
        self.heard.insert(event.agent.clone(), heard);
        let mut actions = vec![];
        match event.kind {
            // Some agents say "started" again mid-task: the task goes on.
            Kind::Started if says_started_mid_task(&event.agent) && self.sessions.contains_key(&key) => {}
            Kind::Started => {
                let minutes = agent.open_after_minutes;
                let due = (agent.enabled && minutes > 0.0).then(|| now + (minutes * 60_000.0) as u64);
                self.sessions.insert(
                    key,
                    Tracked { project: event.project.clone(), transcript: event.transcript.clone(), started_at: now, due, opened: false },
                );
                actions.push(Action::Sessions);
            }
            Kind::Finished | Kind::Attention => {
                let tracked = if event.kind == Kind::Finished {
                    self.sessions.remove(&key)
                } else {
                    self.sessions.get(&key).cloned()
                };
                if event.kind == Kind::Finished && tracked.is_some() {
                    actions.push(Action::Sessions);
                }
                if agent.enabled && !self.is_paused(now) {
                    let kind = if event.kind == Kind::Finished { AlertKind::Finished } else { AlertKind::Attention };
                    let banner = window.visible;
                    let notify = if banner { prefs.notify && !window.focused } else { prefs.notify_when_closed };
                    if banner || notify {
                        actions.push(Action::Alert(Alert {
                            agent: event.agent.clone(),
                            project: event.project.clone().or_else(|| tracked.as_ref().and_then(|t| t.project.clone())),
                            kind,
                            at: now,
                            worked_ms: tracked.map(|t| now.saturating_sub(t.started_at)),
                            banner,
                            notify,
                            sound: prefs.sound,
                        }));
                    }
                }
            }
            Kind::Ended => {
                if self.sessions.remove(&key).is_some() {
                    actions.push(Action::Sessions);
                }
            }
        }
        actions
    }

    /// Run about once a second. A task the user interrupted ends without a hook,
    /// so its transcript is looked at every few seconds: then it is forgotten
    /// before the Mushaf opens for it.
    pub fn on_tick(&mut self, now: u64, prefs: &Prefs, window: WindowState, interrupted: Interrupted) -> Vec<Action> {
        let mut actions = vec![];
        let before = self.sessions.len();
        let check = now >= self.next_check;
        if check {
            self.next_check = now + CHECK_EVERY_MS;
        }
        self.sessions.retain(|(agent, session), tracked| {
            let stopped = check && !tracked.opened && tracked.transcript.as_deref().is_some_and(|path| interrupted(agent, session, path));
            !stopped && now.saturating_sub(tracked.started_at) < FORGET_AFTER_MS
        });
        if self.sessions.len() != before {
            actions.push(Action::Sessions);
        }
        if self.is_paused(now) {
            return actions;
        }
        let mut open = false;
        for tracked in self.sessions.values_mut() {
            if !tracked.opened && tracked.due.is_some_and(|due| due <= now) {
                tracked.opened = true;
                open = true;
            }
        }
        if open {
            actions.push(Action::Sessions);
            // Already in front of the user: nothing to do.
            if !(window.visible && window.focused) {
                actions.insert(0, Action::Open { focus: prefs.focus_on_open });
            }
        }
        actions
    }

    pub fn heard(&self) -> Vec<Heard> {
        self.heard.values().cloned().collect()
    }

    pub fn sessions(&self) -> Vec<Session> {
        self.sessions
            .iter()
            .map(|((agent, session), tracked)| Session {
                agent: agent.clone(),
                session: session.clone(),
                project: tracked.project.clone(),
                started_at: tracked.started_at,
                opens_at: if tracked.opened { None } else { tracked.due },
                opened: tracked.opened,
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const MIN: u64 = 60_000;
    const HIDDEN: WindowState = WindowState { visible: false, focused: false };
    const BEHIND: WindowState = WindowState { visible: true, focused: false };
    const FRONT: WindowState = WindowState { visible: true, focused: true };

    fn event(kind: Kind, session: &str) -> AgentEvent {
        AgentEvent { v: 1, agent: "claude".into(), session: session.into(), kind, project: Some("shop".into()), transcript: None, at: 0 }
    }

    const NO: Interrupted = &|_, _, _| false;

    fn alert(actions: &[Action]) -> Option<&Alert> {
        actions.iter().find_map(|action| match action {
            Action::Alert(alert) => Some(alert),
            _ => None,
        })
    }

    #[test]
    fn opens_at_two_minutes_and_not_before() {
        let prefs = Prefs::default();
        let mut engine = Engine::default();
        engine.on_event(&event(Kind::Started, "a"), 0, &prefs, HIDDEN);
        assert_eq!(engine.sessions()[0].opens_at, Some(2 * MIN));
        assert!(!engine.on_tick(2 * MIN - 1, &prefs, HIDDEN, NO).contains(&Action::Open { focus: true }));
        assert_eq!(engine.on_tick(2 * MIN, &prefs, HIDDEN, NO)[0], Action::Open { focus: true });
        // Once per task, even if the user hides it again.
        assert!(!engine.on_tick(3 * MIN, &prefs, HIDDEN, NO).iter().any(|a| matches!(a, Action::Open { .. })));
        assert!(engine.sessions()[0].opened);
    }

    #[test]
    fn a_short_task_never_opens_and_says_nothing_while_hidden() {
        let prefs = Prefs::default();
        let mut engine = Engine::default();
        engine.on_event(&event(Kind::Started, "a"), 0, &prefs, HIDDEN);
        let done = engine.on_event(&event(Kind::Finished, "a"), MIN, &prefs, HIDDEN);
        assert_eq!(done, vec![Action::Sessions]);
        assert_eq!((engine.heard()[0].kind, engine.heard()[0].at), (Kind::Finished, MIN));
        assert!(engine.on_tick(5 * MIN, &prefs, HIDDEN, NO).is_empty());
    }

    #[test]
    fn finishing_while_open_shows_a_banner() {
        let prefs = Prefs::default();
        let mut engine = Engine::default();
        engine.on_event(&event(Kind::Started, "a"), 0, &prefs, HIDDEN);
        engine.on_tick(2 * MIN, &prefs, HIDDEN, NO);
        let done = engine.on_event(&event(Kind::Finished, "a"), 5 * MIN, &prefs, FRONT);
        let alert = alert(&done).unwrap();
        assert_eq!((alert.kind, alert.banner, alert.notify, alert.sound), (AlertKind::Finished, true, false, false));
        assert_eq!(alert.project.as_deref(), Some("shop"));
        assert_eq!(alert.worked_ms, Some(5 * MIN));
        assert!(engine.sessions().is_empty());
    }

    #[test]
    fn notifications_and_sound_only_when_asked_for() {
        let mut prefs = Prefs { notify: true, sound: true, ..Prefs::default() };
        let mut engine = Engine::default();
        let behind = engine.on_event(&event(Kind::Finished, "a"), 0, &prefs, BEHIND);
        let behind = alert(&behind).unwrap();
        assert!(behind.banner && behind.notify && behind.sound);
        let front = engine.on_event(&event(Kind::Finished, "a"), 0, &prefs, FRONT);
        assert!(!alert(&front).unwrap().notify, "no notification over the window it is about");
        assert!(engine.on_event(&event(Kind::Finished, "a"), 0, &prefs, HIDDEN).is_empty());
        prefs.notify_when_closed = true;
        let closed = engine.on_event(&event(Kind::Finished, "a"), 0, &prefs, HIDDEN);
        let closed = alert(&closed).unwrap();
        assert!(!closed.banner && closed.notify);
    }

    #[test]
    fn waiting_for_the_user_alerts_and_keeps_the_task() {
        let prefs = Prefs::default();
        let mut engine = Engine::default();
        engine.on_event(&event(Kind::Started, "a"), 0, &prefs, HIDDEN);
        let waiting = engine.on_event(&event(Kind::Attention, "a"), MIN, &prefs, BEHIND);
        assert_eq!(alert(&waiting).unwrap().kind, AlertKind::Attention);
        assert_eq!(engine.sessions().len(), 1);
        assert_eq!(engine.on_tick(2 * MIN, &prefs, HIDDEN, NO)[0], Action::Open { focus: true });
    }

    #[test]
    fn ending_or_interrupting_forgets_quietly() {
        let prefs = Prefs::default();
        let mut engine = Engine::default();
        engine.on_event(&event(Kind::Started, "a"), 0, &prefs, HIDDEN);
        assert_eq!(engine.on_event(&event(Kind::Ended, "a"), MIN, &prefs, FRONT), vec![Action::Sessions]);
        assert!(engine.on_tick(3 * MIN, &prefs, HIDDEN, NO).is_empty());
    }

    #[test]
    fn pausing_holds_everything() {
        let prefs = Prefs::default();
        let mut engine = Engine { paused_until: Some(10 * MIN), ..Engine::default() };
        engine.on_event(&event(Kind::Started, "a"), 0, &prefs, HIDDEN);
        assert!(!engine.on_tick(3 * MIN, &prefs, HIDDEN, NO).iter().any(|a| matches!(a, Action::Open { .. })));
        assert!(alert(&engine.on_event(&event(Kind::Attention, "a"), 4 * MIN, &prefs, FRONT)).is_none());
        // After the pause, a task still running gets its Mushaf.
        assert_eq!(engine.on_tick(10 * MIN, &prefs, HIDDEN, NO)[0], Action::Open { focus: true });
    }

    #[test]
    fn several_agents_at_once() {
        let prefs = Prefs::from_settings(&json!({
            "agents": { "codex": { "enabled": true, "openAfterMinutes": 5 } },
            "alerts": { "focusOnOpen": false }
        }));
        let mut engine = Engine::default();
        engine.on_event(&event(Kind::Started, "a"), 0, &prefs, HIDDEN);
        let codex = AgentEvent { agent: "codex".into(), ..event(Kind::Started, "a") };
        engine.on_event(&codex, MIN, &prefs, HIDDEN);
        assert_eq!(engine.sessions().len(), 2);
        assert_eq!(engine.on_tick(2 * MIN, &prefs, HIDDEN, NO)[0], Action::Open { focus: false });
        // Already in front: no second open, but codex's task is marked as opened.
        assert!(!engine.on_tick(6 * MIN, &prefs, FRONT, NO).iter().any(|a| matches!(a, Action::Open { .. })));
        assert!(engine.sessions().iter().all(|s| s.opened));
    }

    #[test]
    fn disabled_agents_and_zero_minutes() {
        let prefs = Prefs::from_settings(&json!({
            "agentDefaults": { "enabled": true, "openAfterMinutes": 0 },
            "agents": { "codex": { "enabled": false } }
        }));
        let mut engine = Engine::default();
        engine.on_event(&event(Kind::Started, "a"), 0, &prefs, HIDDEN);
        assert_eq!(engine.sessions()[0].opens_at, None);
        assert!(engine.on_tick(60 * MIN, &prefs, HIDDEN, NO).is_empty());
        let codex = AgentEvent { agent: "codex".into(), ..event(Kind::Finished, "b") };
        assert!(alert(&engine.on_event(&codex, 0, &prefs, FRONT)).is_none());
    }

    #[test]
    fn a_start_mid_task_keeps_the_task() {
        let prefs = Prefs::default();
        let mut engine = Engine::default();
        let agy = |kind| AgentEvent { agent: "agy".into(), ..event(kind, "a") };
        engine.on_event(&agy(Kind::Started), 0, &prefs, HIDDEN);
        // Before each model call.
        assert!(engine.on_event(&agy(Kind::Started), MIN, &prefs, HIDDEN).is_empty());
        assert_eq!(engine.sessions()[0].opens_at, Some(2 * MIN));
        engine.on_event(&agy(Kind::Finished), 3 * MIN, &prefs, HIDDEN);
        engine.on_event(&agy(Kind::Started), 4 * MIN, &prefs, HIDDEN);
        assert_eq!(engine.sessions()[0].opens_at, Some(6 * MIN), "a new task after the last one finished");

        // Claude Code's start is always a new prompt.
        engine.on_event(&event(Kind::Started, "b"), 0, &prefs, HIDDEN);
        engine.on_event(&event(Kind::Started, "b"), MIN, &prefs, HIDDEN);
        let claude = engine.sessions().into_iter().find(|s| s.agent == "claude").unwrap();
        assert_eq!(claude.opens_at, Some(3 * MIN));
    }

    #[test]
    fn a_task_the_user_interrupted_never_opens_the_mushaf() {
        let prefs = Prefs::default();
        let mut engine = Engine::default();
        let started = AgentEvent { transcript: Some("/t/a.jsonl".into()), ..event(Kind::Started, "a") };
        engine.on_event(&started, 0, &prefs, HIDDEN);
        let other = AgentEvent { session: "b".into(), transcript: Some("/t/b.jsonl".into()), ..started.clone() };
        engine.on_event(&other, 0, &prefs, HIDDEN);
        let only_a: Interrupted = &|agent, session, path| agent == "claude" && session == "a" && path == "/t/a.jsonl";
        assert_eq!(engine.on_tick(MIN, &prefs, HIDDEN, NO), vec![]);
        assert_eq!(engine.on_tick(MIN + 1_000, &prefs, HIDDEN, only_a), vec![], "not checked again so soon");
        assert_eq!(engine.on_tick(MIN + 5_000, &prefs, HIDDEN, only_a), vec![Action::Sessions]);
        assert_eq!(engine.sessions().iter().map(|s| s.session.as_str()).collect::<Vec<_>>(), ["b"]);
        assert_eq!(engine.on_tick(2 * MIN, &prefs, HIDDEN, only_a)[0], Action::Open { focus: true }, "b still opens");
    }

    #[test]
    fn forgets_tasks_that_never_finish() {
        let prefs = Prefs::default();
        let mut engine = Engine::default();
        engine.on_event(&event(Kind::Started, "a"), 0, &prefs, HIDDEN);
        engine.on_tick(7 * 60 * MIN, &prefs, FRONT, NO);
        assert!(engine.sessions().is_empty());
    }

    #[test]
    fn reads_the_readers_settings() {
        assert_eq!(Prefs::from_settings(&Value::Null), Prefs::default());
        let prefs = Prefs::from_settings(&json!({
            "agentDefaults": { "enabled": true, "openAfterMinutes": 3.5 },
            "agents": { "claude": { "openAfterMinutes": -1 } },
            "alerts": { "notify": true, "sound": "yes" }
        }));
        assert_eq!(prefs.agent("codex").open_after_minutes, 3.5);
        assert_eq!(prefs.agent("claude").open_after_minutes, 3.5, "a bad value falls back");
        assert!(prefs.notify && !prefs.sound);
    }
}
