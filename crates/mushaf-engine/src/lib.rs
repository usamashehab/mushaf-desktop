//! What to do about the agents at work: the rules, apart from windows and clocks.
//!
//! An agent that has worked on one task for its minutes is ready for the app
//! (the Mushaf, or another app built on these crates), and the app opens when
//! the user is waiting: away from the keyboard, with no agent asking them
//! something, and not just after they put it away. With several agents that is
//! one opening, not one each. When an agent finishes, or stops to wait for the
//! user, the app shows a banner if it is open, and a notification or a sound if
//! asked for; ones that come together go as one.

pub mod idle;

use std::collections::BTreeMap;

use mushaf_ipc::{Heard, Session};
use mushaf_protocol::{says_started_mid_task, AgentEvent, Kind};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A task this long without a word from its agent is forgotten.
const FORGET_AFTER_MS: u64 = 6 * 60 * 60 * 1000;
/// How often the transcripts are looked at for a task the user interrupted.
const CHECK_EVERY_MS: u64 = 5_000;
/// The user counts as waiting after this long without a key or the mouse.
pub const IDLE_MS: u64 = 30_000;
/// An agent's question holds the app back until the user next touches the
/// keyboard or mouse (most likely to answer it: no hook says so), or this long
/// when the system can't tell.
const WAITING_HOLDS_MS: u64 = 10 * 60_000;
/// Put away after it opened by itself, the app stays away this long.
const PUT_AWAY_HOLDS_MS: u64 = 10 * 60_000;
/// Alerts this close together make one notification, and one chime.
const BATCH_MS: u64 = 4_000;

/// Whether an agent's transcript or log (by path) shows the session's task
/// interrupted: (agent, session, path).
pub type Interrupted<'a> = &'a dyn Fn(&str, &str, &str) -> bool;

#[derive(Debug, Clone, PartialEq)]
pub struct AgentPrefs {
    pub enabled: bool,
    pub open_after_minutes: f64,
}

/// How the app opens for an agent at work.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenStyle {
    /// Shown and brought to the front.
    Front,
    /// Shown behind the window in use.
    Behind,
    /// Not shown: a notification says it is ready.
    Notify,
}

/// The parts of the reader's settings this side acts on.
#[derive(Debug, Clone, PartialEq)]
pub struct Prefs {
    pub agents: BTreeMap<String, AgentPrefs>,
    pub defaults: AgentPrefs,
    pub open_style: OpenStyle,
    /// Open only once the user has left the keyboard and mouse a while.
    pub only_when_idle: bool,
    pub notify: bool,
    pub notify_when_closed: bool,
    pub sound: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            agents: BTreeMap::new(),
            defaults: AgentPrefs { enabled: true, open_after_minutes: 2.0 },
            open_style: OpenStyle::Front,
            only_when_idle: true,
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
        prefs.open_style = match alerts.and_then(|a| a.get("openStyle")).and_then(Value::as_str) {
            Some("front") => OpenStyle::Front,
            Some("behind") => OpenStyle::Behind,
            Some("notify") => OpenStyle::Notify,
            // Settings from before there was a choice.
            _ if !flag("focusOnOpen", true) => OpenStyle::Behind,
            _ => prefs.open_style,
        };
        prefs.only_when_idle = flag("onlyWhenIdle", prefs.only_when_idle);
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

/// A system notification.
#[derive(Debug, Clone, PartialEq)]
pub enum Notice {
    /// Agents that finished or wait for the user, close together.
    Alerts(Vec<Alert>),
    /// The app is ready for these agents at work (the `Notify` open style).
    Working(Vec<String>),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    /// Show the window for an agent at work; bring it to the front when `focus`.
    Open { focus: bool },
    /// A banner inside the app.
    Alert(Alert),
    Notify { notice: Notice, sound: bool },
    /// The sessions list changed.
    Sessions,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Tracked {
    project: Option<String>,
    transcript: Option<String>,
    started_at: u64,
    due: Option<u64>,
    opened: bool,
}

/// A task at work as the app keeps it across a restart.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Saved {
    agent: String,
    session: String,
    #[serde(flatten)]
    tracked: Tracked,
}

type Key = (String, String);

#[derive(Debug, Default)]
pub struct Engine {
    sessions: BTreeMap<Key, Tracked>,
    /// The last event from each agent.
    heard: BTreeMap<String, Heard>,
    /// Sessions waiting on the user (a permission, a question), since when.
    waiting: BTreeMap<Key, u64>,
    /// The window is up because the app opened itself.
    shown_by_itself: bool,
    /// When the user last put away the app that had opened itself.
    put_away_at: Option<u64>,
    /// When the app last opened itself.
    opened_at: Option<u64>,
    /// When an agent last finished or asked the user something.
    called_at: Option<u64>,
    /// Alerts for a notification, gathered for `BATCH_MS` from the first.
    batch: Vec<Alert>,
    last_chime: Option<u64>,
    next_check: u64,
    /// No opening and no alerts before this (ms since the epoch).
    pub paused_until: Option<u64>,
    /// The app has nothing to show for now (say, all of today's goals are
    /// done): tasks that are due wait, and open once it has.
    pub nothing_to_open: bool,
}

impl Engine {
    pub fn paused(until: Option<u64>) -> Self {
        Engine { paused_until: until, ..Engine::default() }
    }

    /// The tasks at work, to keep while the app is closed.
    pub fn saved(&self) -> Vec<Saved> {
        self.sessions
            .iter()
            .map(|((agent, session), tracked)| Saved { agent: agent.clone(), session: session.clone(), tracked: tracked.clone() })
            .collect()
    }

    /// Takes back the tasks kept at the last close, less the ones too old and
    /// the ones whose end came while the app was closed (`missed`). Missed
    /// events alert no one: they are over.
    pub fn restore(&mut self, saved: Vec<Saved>, missed: &[AgentEvent], now: u64) {
        for Saved { agent, session, tracked } in saved {
            if now.saturating_sub(tracked.started_at) < FORGET_AFTER_MS {
                self.sessions.insert((agent, session), tracked);
            }
        }
        for event in missed {
            let key = (event.agent.clone(), event.session.clone());
            let ends = matches!(event.kind, Kind::Finished | Kind::Ended);
            if ends && self.sessions.get(&key).is_some_and(|tracked| event.at >= tracked.started_at) {
                self.sessions.remove(&key);
            }
        }
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
        if event.kind == Kind::Attention {
            self.waiting.insert(key.clone(), now);
        } else {
            self.waiting.remove(&key);
        }
        if matches!(event.kind, Kind::Finished | Kind::Attention) && agent.enabled {
            self.called_at = Some(now);
        }
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
                    // One chime for alerts that come together.
                    let chime = prefs.sound && self.last_chime.is_none_or(|at| now.saturating_sub(at) >= BATCH_MS);
                    let alert = Alert {
                        agent: event.agent.clone(),
                        project: event.project.clone().or_else(|| tracked.as_ref().and_then(|t| t.project.clone())),
                        kind,
                        at: now,
                        worked_ms: tracked.map(|t| now.saturating_sub(t.started_at)),
                        banner,
                        notify,
                        sound: chime,
                    };
                    if chime && (banner || notify) {
                        self.last_chime = Some(now);
                    }
                    if notify {
                        self.batch.push(alert.clone());
                    }
                    if banner {
                        actions.push(Action::Alert(alert));
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
    /// before the app opens for it. `idle` is how long the user has left the
    /// keyboard and mouse, when the system says.
    pub fn on_tick(&mut self, now: u64, prefs: &Prefs, window: WindowState, idle: Option<u64>, interrupted: Interrupted) -> Vec<Action> {
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
        let last_input = idle.map(|idle| now.saturating_sub(idle));
        self.waiting.retain(|_, since| now.saturating_sub(*since) < WAITING_HOLDS_MS && last_input.is_none_or(|input| input < *since));
        if self.shown_by_itself && !window.visible {
            self.shown_by_itself = false;
            // Put away while the agents still work, it stays away a while. Put
            // away after one finished or asked something, the user went back to
            // it: the next task opens it as usual.
            let called = self.called_at.zip(self.opened_at).is_some_and(|(called, opened)| called >= opened);
            if !called {
                self.put_away_at = Some(now);
            }
        }
        if self.batch.first().is_some_and(|first| now.saturating_sub(first.at) >= BATCH_MS) {
            let batch = std::mem::take(&mut self.batch);
            let sound = batch.iter().any(|alert| alert.sound && !alert.banner);
            actions.push(Action::Notify { notice: Notice::Alerts(batch), sound });
        }
        if self.is_paused(now) || self.nothing_to_open {
            return actions;
        }
        let ready: Vec<String> = self
            .sessions
            .iter()
            .filter(|(_, tracked)| !tracked.opened && tracked.due.is_some_and(|due| due <= now))
            .map(|((agent, _), _)| agent.clone())
            .collect();
        // Already in front of the user: nothing to open, whatever they are doing.
        let in_front = window.visible && window.focused;
        if ready.is_empty() || !(in_front || self.user_is_waiting(now, prefs, idle)) {
            return actions;
        }
        for tracked in self.sessions.values_mut() {
            if tracked.due.is_some_and(|due| due <= now) {
                tracked.opened = true;
            }
        }
        actions.push(Action::Sessions);
        if in_front {
            return actions;
        }
        match prefs.open_style {
            OpenStyle::Notify => {
                let mut agents = ready;
                agents.dedup();
                actions.insert(0, Action::Notify { notice: Notice::Working(agents), sound: prefs.sound });
            }
            style => {
                self.shown_by_itself = true;
                self.opened_at = Some(now);
                actions.insert(0, Action::Open { focus: style == OpenStyle::Front });
            }
        }
        actions
    }

    /// Whether opening now interrupts nothing: the user has left the keyboard,
    /// no agent asks them something, and they didn't just put the app away.
    fn user_is_waiting(&self, now: u64, prefs: &Prefs, idle: Option<u64>) -> bool {
        let typing = prefs.only_when_idle && idle.is_some_and(|idle| idle < IDLE_MS);
        let asked = !self.waiting.is_empty();
        let put_away = self.put_away_at.is_some_and(|at| now.saturating_sub(at) < PUT_AWAY_HOLDS_MS);
        !typing && !asked && !put_away
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

    fn opens(actions: &[Action]) -> bool {
        actions.iter().any(|action| matches!(action, Action::Open { .. }))
    }

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
        assert!(!engine.on_tick(2 * MIN - 1, &prefs, HIDDEN, None, NO).contains(&Action::Open { focus: true }));
        assert_eq!(engine.on_tick(2 * MIN, &prefs, HIDDEN, None, NO)[0], Action::Open { focus: true });
        // Once per task, even if the user hides it again.
        assert!(!engine.on_tick(3 * MIN, &prefs, HIDDEN, None, NO).iter().any(|a| matches!(a, Action::Open { .. })));
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
        assert!(engine.on_tick(5 * MIN, &prefs, HIDDEN, None, NO).is_empty());
    }

    #[test]
    fn finishing_while_open_shows_a_banner() {
        let prefs = Prefs::default();
        let mut engine = Engine::default();
        engine.on_event(&event(Kind::Started, "a"), 0, &prefs, HIDDEN);
        engine.on_tick(2 * MIN, &prefs, HIDDEN, None, NO);
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
        // The notification for the window behind.
        assert!(matches!(&engine.on_tick(MIN, &prefs, HIDDEN, None, NO)[0], Action::Notify { notice: Notice::Alerts(batch), .. } if batch.len() == 1));
        prefs.notify_when_closed = true;
        assert!(engine.on_event(&event(Kind::Finished, "a"), MIN, &prefs, HIDDEN).is_empty(), "no banner");
        let closed = engine.on_tick(MIN + BATCH_MS, &prefs, HIDDEN, None, NO);
        assert!(matches!(&closed[0], Action::Notify { notice: Notice::Alerts(batch), .. } if !batch[0].banner));
    }

    #[test]
    fn waiting_for_the_user_alerts_and_keeps_the_task() {
        let prefs = Prefs::default();
        let mut engine = Engine::default();
        engine.on_event(&event(Kind::Started, "a"), 0, &prefs, HIDDEN);
        let waiting = engine.on_event(&event(Kind::Attention, "a"), MIN, &prefs, BEHIND);
        assert_eq!(alert(&waiting).unwrap().kind, AlertKind::Attention);
        assert_eq!(engine.sessions().len(), 1);
        // Not over the question: the user hasn't touched anything since it came.
        assert!(!opens(&engine.on_tick(2 * MIN, &prefs, HIDDEN, Some(MIN + 5_000), NO)));
        // They answered it, then sat back.
        assert_eq!(engine.on_tick(2 * MIN + 40_000, &prefs, HIDDEN, Some(40_000), NO)[0], Action::Open { focus: true });
    }

    #[test]
    fn opens_only_once_the_user_leaves_the_keyboard() {
        let prefs = Prefs::default();
        let mut engine = Engine::default();
        engine.on_event(&event(Kind::Started, "a"), 0, &prefs, HIDDEN);
        assert!(!opens(&engine.on_tick(2 * MIN, &prefs, HIDDEN, Some(5_000), NO)), "typing into another agent");
        assert!(!opens(&engine.on_tick(3 * MIN, &prefs, HIDDEN, Some(IDLE_MS - 1), NO)));
        assert_eq!(engine.on_tick(3 * MIN + 1, &prefs, HIDDEN, Some(IDLE_MS), NO)[0], Action::Open { focus: true });

        // Never, if the task ends first.
        engine.on_event(&event(Kind::Started, "b"), 10 * MIN, &prefs, HIDDEN);
        assert!(!opens(&engine.on_tick(12 * MIN, &prefs, HIDDEN, Some(1_000), NO)));
        engine.on_event(&event(Kind::Finished, "b"), 13 * MIN, &prefs, HIDDEN);
        assert!(!opens(&engine.on_tick(14 * MIN, &prefs, HIDDEN, Some(MIN), NO)));

        // The setting off: on time, typing or not.
        let anyway = Prefs { only_when_idle: false, ..Prefs::default() };
        engine.on_event(&event(Kind::Started, "c"), 20 * MIN, &anyway, HIDDEN);
        assert!(opens(&engine.on_tick(22 * MIN, &anyway, HIDDEN, Some(1_000), NO)));
    }

    #[test]
    fn another_agents_question_holds_the_mushaf() {
        let prefs = Prefs::default();
        let mut engine = Engine::default();
        engine.on_event(&event(Kind::Started, "a"), 0, &prefs, HIDDEN);
        let codex = AgentEvent { agent: "codex".into(), ..event(Kind::Attention, "x") };
        engine.on_event(&codex, MIN + 30_000, &prefs, HIDDEN);
        // The user went away before the question came: still not over it.
        assert!(!opens(&engine.on_tick(3 * MIN, &prefs, HIDDEN, Some(2 * MIN), NO)));
        // Without an idle time, the next word from that session lets it go.
        assert!(!opens(&engine.on_tick(4 * MIN, &prefs, HIDDEN, None, NO)));
        let answered = AgentEvent { agent: "codex".into(), ..event(Kind::Finished, "x") };
        engine.on_event(&answered, 5 * MIN, &prefs, HIDDEN);
        assert!(opens(&engine.on_tick(5 * MIN + 1, &prefs, HIDDEN, None, NO)));
    }

    #[test]
    fn put_away_it_stays_away_a_while() {
        let prefs = Prefs::default();
        let mut engine = Engine::default();
        engine.on_event(&event(Kind::Started, "a"), 0, &prefs, HIDDEN);
        assert!(opens(&engine.on_tick(2 * MIN, &prefs, HIDDEN, None, NO)));
        engine.on_tick(2 * MIN + 1_000, &prefs, BEHIND, None, NO);
        // The user closes it to the tray.
        engine.on_tick(3 * MIN, &prefs, HIDDEN, None, NO);
        engine.on_event(&event(Kind::Started, "b"), 3 * MIN, &prefs, HIDDEN);
        assert!(!opens(&engine.on_tick(5 * MIN, &prefs, HIDDEN, None, NO)));
        assert!(!opens(&engine.on_tick(13 * MIN - 1, &prefs, HIDDEN, None, NO)));
        assert!(opens(&engine.on_tick(13 * MIN, &prefs, HIDDEN, None, NO)), "b, still at work after the hold");
    }

    #[test]
    fn put_away_after_the_agent_finished_it_opens_for_the_next_task() {
        let prefs = Prefs::default();
        let mut engine = Engine::default();
        engine.on_event(&event(Kind::Started, "a"), 0, &prefs, HIDDEN);
        assert!(opens(&engine.on_tick(2 * MIN, &prefs, HIDDEN, None, NO)));
        engine.on_tick(2 * MIN + 1_000, &prefs, FRONT, None, NO);
        engine.on_event(&event(Kind::Finished, "a"), 3 * MIN, &prefs, FRONT);
        // Back to work: the user hides it to answer the agent.
        engine.on_tick(3 * MIN + 1_000, &prefs, HIDDEN, None, NO);
        engine.on_event(&event(Kind::Started, "b"), 4 * MIN, &prefs, HIDDEN);
        assert!(opens(&engine.on_tick(6 * MIN, &prefs, HIDDEN, None, NO)), "no hold");

        // The same after a question.
        engine.on_tick(6 * MIN + 1_000, &prefs, FRONT, None, NO);
        engine.on_event(&event(Kind::Attention, "b"), 7 * MIN, &prefs, FRONT);
        engine.on_tick(7 * MIN + 1_000, &prefs, HIDDEN, None, NO);
        engine.on_event(&event(Kind::Started, "b"), 8 * MIN, &prefs, HIDDEN);
        engine.on_event(&event(Kind::Started, "c"), 8 * MIN, &prefs, HIDDEN);
        assert!(opens(&engine.on_tick(10 * MIN, &prefs, HIDDEN, None, NO)), "no hold");
    }

    #[test]
    fn nothing_to_open_holds_due_tasks_until_there_is() {
        let prefs = Prefs::default();
        let mut engine = Engine { nothing_to_open: true, ..Engine::default() };
        engine.on_event(&event(Kind::Started, "a"), 0, &prefs, HIDDEN);
        assert!(!opens(&engine.on_tick(2 * MIN, &prefs, HIDDEN, None, NO)));
        assert!(!opens(&engine.on_tick(5 * MIN, &prefs, HIDDEN, None, NO)));
        assert!(!engine.sessions()[0].opened);
        engine.nothing_to_open = false;
        assert!(opens(&engine.on_tick(5 * MIN + 1_000, &prefs, HIDDEN, None, NO)));
    }

    #[test]
    fn opening_behind_or_as_a_notification() {
        let mut engine = Engine::default();
        let notify = Prefs { open_style: OpenStyle::Notify, ..Prefs::default() };
        engine.on_event(&event(Kind::Started, "a"), 0, &notify, HIDDEN);
        let codex = AgentEvent { agent: "codex".into(), ..event(Kind::Started, "b") };
        engine.on_event(&codex, 0, &notify, HIDDEN);
        let actions = engine.on_tick(2 * MIN, &notify, HIDDEN, None, NO);
        assert_eq!(actions[0], Action::Notify { notice: Notice::Working(vec!["claude".into(), "codex".into()]), sound: false });
        assert!(!opens(&actions), "one notice for both, and no window");
        assert!(engine.sessions().iter().all(|s| s.opened));
        assert_eq!(Prefs::from_settings(&json!({ "alerts": { "openStyle": "behind" } })).open_style, OpenStyle::Behind);
        assert_eq!(Prefs::from_settings(&json!({ "alerts": { "openStyle": "odd" } })).open_style, OpenStyle::Front);
    }

    #[test]
    fn alerts_close_together_make_one_notification_and_one_chime() {
        let prefs = Prefs { notify_when_closed: true, sound: true, ..Prefs::default() };
        let mut engine = Engine::default();
        let codex = AgentEvent { agent: "codex".into(), ..event(Kind::Finished, "b") };
        assert!(engine.on_event(&event(Kind::Finished, "a"), 0, &prefs, HIDDEN).is_empty());
        engine.on_event(&codex, 1_000, &prefs, HIDDEN);
        assert!(engine.on_tick(BATCH_MS - 1, &prefs, HIDDEN, None, NO).is_empty());
        let actions = engine.on_tick(BATCH_MS, &prefs, HIDDEN, None, NO);
        let Action::Notify { notice: Notice::Alerts(batch), sound: true } = &actions[0] else { panic!("{actions:?}") };
        assert_eq!(batch.iter().map(|a| a.agent.as_str()).collect::<Vec<_>>(), ["claude", "codex"]);
        // Later alerts make their own.
        engine.on_event(&event(Kind::Finished, "c"), MIN, &prefs, HIDDEN);
        assert!(matches!(&engine.on_tick(MIN + BATCH_MS, &prefs, HIDDEN, None, NO)[0], Action::Notify { notice: Notice::Alerts(b), .. } if b.len() == 1));

        // Banners show at once; only the first chimes.
        let first = engine.on_event(&event(Kind::Finished, "d"), 2 * MIN, &prefs, BEHIND);
        let second = engine.on_event(&codex, 2 * MIN + 1_000, &prefs, BEHIND);
        assert!(alert(&first).unwrap().sound && !alert(&second).unwrap().sound);
    }

    #[test]
    fn ending_or_interrupting_forgets_quietly() {
        let prefs = Prefs::default();
        let mut engine = Engine::default();
        engine.on_event(&event(Kind::Started, "a"), 0, &prefs, HIDDEN);
        assert_eq!(engine.on_event(&event(Kind::Ended, "a"), MIN, &prefs, FRONT), vec![Action::Sessions]);
        assert!(engine.on_tick(3 * MIN, &prefs, HIDDEN, None, NO).is_empty());
    }

    #[test]
    fn pausing_holds_everything() {
        let prefs = Prefs::default();
        let mut engine = Engine { paused_until: Some(10 * MIN), ..Engine::default() };
        engine.on_event(&event(Kind::Started, "a"), 0, &prefs, HIDDEN);
        assert!(!engine.on_tick(3 * MIN, &prefs, HIDDEN, None, NO).iter().any(|a| matches!(a, Action::Open { .. })));
        assert!(alert(&engine.on_event(&event(Kind::Attention, "a"), 4 * MIN, &prefs, FRONT)).is_none());
        // After the pause, a task still running gets its Mushaf (its question answered).
        assert_eq!(engine.on_tick(10 * MIN, &prefs, HIDDEN, Some(IDLE_MS), NO)[0], Action::Open { focus: true });
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
        assert_eq!(engine.on_tick(2 * MIN, &prefs, HIDDEN, None, NO)[0], Action::Open { focus: false });
        // Already in front: no second open, but codex's task is marked as opened.
        assert!(!engine.on_tick(6 * MIN, &prefs, FRONT, None, NO).iter().any(|a| matches!(a, Action::Open { .. })));
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
        assert!(engine.on_tick(60 * MIN, &prefs, HIDDEN, None, NO).is_empty());
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
    fn a_restart_keeps_the_tasks_at_work() {
        let prefs = Prefs::default();
        let mut engine = Engine::default();
        let codex = |kind, session: &str| AgentEvent { agent: "codex".into(), ..event(kind, session) };
        for session in ["a", "b", "c"] {
            engine.on_event(&event(Kind::Started, session), 0, &prefs, HIDDEN);
        }
        engine.on_event(&codex(Kind::Started, "x"), 0, &prefs, HIDDEN);
        let wire = serde_json::to_string(&engine.saved()).unwrap();

        // While the app was closed: a finished, x ended, c asked something.
        let missed = [
            AgentEvent { at: MIN, ..event(Kind::Finished, "a") },
            AgentEvent { at: MIN, ..codex(Kind::Ended, "x") },
            AgentEvent { at: 0, ..event(Kind::Attention, "c") },
        ];
        let mut again = Engine::default();
        again.restore(serde_json::from_str(&wire).unwrap(), &missed, 90_000);
        let left: Vec<_> = again.sessions().into_iter().map(|s| s.session).collect();
        assert_eq!(left, ["b", "c"]);
        // Still opens on time, from when the task began.
        assert_eq!(again.on_tick(2 * MIN, &prefs, HIDDEN, None, NO)[0], Action::Open { focus: true });

        // Too old to keep.
        let mut late = Engine::default();
        late.restore(serde_json::from_str(&wire).unwrap(), &[], FORGET_AFTER_MS + 1);
        assert!(late.sessions().is_empty());
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
        assert_eq!(engine.on_tick(MIN, &prefs, HIDDEN, None, NO), vec![]);
        assert_eq!(engine.on_tick(MIN + 1_000, &prefs, HIDDEN, None, only_a), vec![], "not checked again so soon");
        assert_eq!(engine.on_tick(MIN + 5_000, &prefs, HIDDEN, None, only_a), vec![Action::Sessions]);
        assert_eq!(engine.sessions().iter().map(|s| s.session.as_str()).collect::<Vec<_>>(), ["b"]);
        assert_eq!(engine.on_tick(2 * MIN, &prefs, HIDDEN, None, only_a)[0], Action::Open { focus: true }, "b still opens");
    }

    #[test]
    fn forgets_tasks_that_never_finish() {
        let prefs = Prefs::default();
        let mut engine = Engine::default();
        engine.on_event(&event(Kind::Started, "a"), 0, &prefs, HIDDEN);
        engine.on_tick(7 * 60 * MIN, &prefs, FRONT, None, NO);
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
