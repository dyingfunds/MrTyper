//! The human-paced typing engine.
//!
//! The engine builds a complete timing plan before it starts, then walks it on a
//! dedicated background thread. The UI thread never sleeps: every phase and
//! keystroke is reported through Tauri events.

use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::hotkeys;
use crate::input;
use crate::script::{self, Action, Step};
use crate::settings::{AppSettings, TypingSettings};

const EVENT_PHASE: &str = "typing-phase";
const EVENT_PROGRESS: &str = "typing-progress";
const EVENT_KEYSTROKE: &str = "typing-keystroke";
const EVENT_FINISHED: &str = "typing-finished";

const PHASE_COUNTDOWN: u8 = 1;
const PHASE_TYPING: u8 = 2;
const PHASE_PAUSED: u8 = 3;

const STOP_NONE: u8 = 0;
const STOP_USER: u8 = 1;
const STOP_ESCAPE: u8 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopIntent {
    User,
    Escape,
}

impl StopIntent {
    fn code(self) -> u8 {
        match self {
            StopIntent::User => STOP_USER,
            StopIntent::Escape => STOP_ESCAPE,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FinishReason {
    Completed,
    Stopped,
    Escape,
    FocusLost,
    Error,
}

impl FinishReason {
    fn as_str(self) -> &'static str {
        match self {
            FinishReason::Completed => "completed",
            FinishReason::Stopped => "stopped",
            FinishReason::Escape => "escape",
            FinishReason::FocusLost => "focusLost",
            FinishReason::Error => "error",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub phase: String,
    pub run_id: Option<u64>,
    pub countdown: Option<u32>,
    pub typed: usize,
    pub total: usize,
    pub wpm: f64,
    pub eta_secs: Option<f64>,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhaseEvent {
    phase: &'static str,
    run_id: u64,
    countdown: Option<u32>,
    total: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    run_id: u64,
    typed: usize,
    total: usize,
    wpm: f64,
    eta_secs: Option<f64>,
    elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct KeystrokeEvent {
    run_id: u64,
    index: usize,
    kind: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FinishedEvent {
    run_id: u64,
    reason: &'static str,
    typed: usize,
    total: usize,
    elapsed_ms: u64,
    wpm: f64,
    message: Option<String>,
}

struct RunControl {
    id: u64,
    total: usize,
    /// Script characters covered so far, commands included. Drives progress.
    typed: AtomicUsize,
    /// Characters actually typed into the target. Drives the WPM read-out.
    delivered: AtomicUsize,
    phase: AtomicU8,
    countdown: AtomicU8,
    cancel: AtomicBool,
    paused: AtomicBool,
    stop_reason: AtomicU8,
}

impl RunControl {
    fn new(id: u64, total: usize) -> Self {
        Self {
            id,
            total,
            typed: AtomicUsize::new(0),
            delivered: AtomicUsize::new(0),
            phase: AtomicU8::new(PHASE_COUNTDOWN),
            countdown: AtomicU8::new(0),
            cancel: AtomicBool::new(false),
            paused: AtomicBool::new(false),
            stop_reason: AtomicU8::new(STOP_NONE),
        }
    }

    /// Wait with a response time fine enough for an emergency stop, while
    /// freezing the countdown when the session is paused.
    fn wait(&self, duration: Duration) -> bool {
        const TICK: Duration = Duration::from_millis(8);
        let mut remaining = duration;

        loop {
            if self.cancel.load(Ordering::SeqCst) {
                return false;
            }
            if self.paused.load(Ordering::SeqCst) {
                thread::sleep(TICK);
                continue;
            }
            if remaining.is_zero() {
                return true;
            }
            let step = TICK.min(remaining);
            thread::sleep(step);
            remaining = remaining.saturating_sub(step);
        }
    }

    fn pause(&self) -> bool {
        if self.phase.load(Ordering::SeqCst) != PHASE_TYPING {
            return false;
        }
        self.paused.store(true, Ordering::SeqCst);
        self.phase.store(PHASE_PAUSED, Ordering::SeqCst);
        true
    }

    fn resume(&self) -> bool {
        if self.phase.load(Ordering::SeqCst) != PHASE_PAUSED {
            return false;
        }
        self.paused.store(false, Ordering::SeqCst);
        self.phase.store(PHASE_TYPING, Ordering::SeqCst);
        true
    }

    fn request_stop(&self, intent: StopIntent) {
        let _ = self.stop_reason.compare_exchange(
            STOP_NONE,
            intent.code(),
            Ordering::SeqCst,
            Ordering::SeqCst,
        );
        self.cancel.store(true, Ordering::SeqCst);
    }

    fn phase_name(&self) -> &'static str {
        match self.phase.load(Ordering::SeqCst) {
            PHASE_TYPING => "typing",
            PHASE_PAUSED => "paused",
            _ => "countdown",
        }
    }

    fn cancelled_reason(&self) -> FinishReason {
        match self.stop_reason.load(Ordering::SeqCst) {
            STOP_ESCAPE => FinishReason::Escape,
            _ => FinishReason::Stopped,
        }
    }
}

pub struct Engine {
    active: Mutex<Option<Arc<RunControl>>>,
    next_id: AtomicU64,
}

impl Engine {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(None),
            next_id: AtomicU64::new(1),
        }
    }

    pub fn is_active(&self) -> bool {
        self.lock().is_some()
    }

    pub fn phase(&self) -> Option<&'static str> {
        self.lock().as_ref().map(|run| run.phase_name())
    }

    pub fn status(&self) -> EngineStatus {
        let guard = self.lock();
        let Some(run) = guard.as_ref() else {
            return EngineStatus {
                phase: "idle".into(),
                run_id: None,
                countdown: None,
                typed: 0,
                total: 0,
                wpm: 0.0,
                eta_secs: None,
                elapsed_ms: 0,
            };
        };

        let phase = run.phase_name();
        EngineStatus {
            phase: phase.into(),
            run_id: Some(run.id),
            countdown: if phase == "countdown" {
                Some(u32::from(run.countdown.load(Ordering::SeqCst)))
            } else {
                None
            },
            typed: run.typed.load(Ordering::SeqCst),
            total: run.total,
            wpm: 0.0,
            eta_secs: None,
            elapsed_ms: 0,
        }
    }

    pub fn start(
        self: &Arc<Self>,
        app: AppHandle,
        text: String,
        settings: AppSettings,
    ) -> Result<(), String> {
        let text = normalize_text(&text);
        if text.trim().is_empty() {
            return Err("There is nothing to type yet.".into());
        }

        let total = text.chars().count();
        let mut guard = self.lock();
        if let Some(run) = guard.as_ref() {
            return Err(match run.phase_name() {
                "countdown" => "A countdown is already in progress.".into(),
                "paused" => "A paused session is already open.".into(),
                _ => "A typing session is already running.".into(),
            });
        }

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let run = Arc::new(RunControl::new(id, total));
        *guard = Some(Arc::clone(&run));
        drop(guard);

        let engine = Arc::clone(self);
        let worker_run = Arc::clone(&run);
        let worker_app = app.clone();
        let worker_settings = settings.clone();

        let spawn = thread::Builder::new()
            .name("mrtyper-typing-engine".into())
            .spawn(move || {
                let outcome = run_session(&worker_app, &worker_run, &text, &worker_settings);
                engine.finish(worker_app, worker_run, outcome);
            });

        if let Err(error) = spawn {
            self.clear_active(run.id);
            return Err(format!("Could not start the typing thread: {error}"));
        }

        Ok(())
    }

    pub fn stop(&self, intent: StopIntent) {
        if let Some(run) = self.lock().as_ref() {
            run.request_stop(intent);
        }
    }

    pub fn pause(&self, app: &AppHandle) -> Result<(), String> {
        let run = self
            .lock()
            .clone()
            .ok_or_else(|| "There is no active session.".to_string())?;
        if !run.pause() {
            return Err("Typing is not currently in progress.".into());
        }
        emit_phase(app, &run, "paused", None);
        Ok(())
    }

    pub fn resume(&self, app: &AppHandle) -> Result<(), String> {
        let run = self
            .lock()
            .clone()
            .ok_or_else(|| "There is no active session.".to_string())?;
        if !run.resume() {
            return Err("The session is not paused.".into());
        }
        emit_phase(app, &run, "typing", None);
        Ok(())
    }

    fn finish(&self, app: AppHandle, run: Arc<RunControl>, outcome: SessionOutcome) {
        self.clear_active(run.id);
        hotkeys::unregister_escape(&app);

        let typed = run.typed.load(Ordering::SeqCst);
        if matches!(outcome.reason, FinishReason::Error) {
            eprintln!(
                "MrTyper: session {} stopped with an error: {}",
                run.id,
                outcome.message.as_deref().unwrap_or("unknown error")
            );
        }
        let event = FinishedEvent {
            run_id: run.id,
            reason: outcome.reason.as_str(),
            typed,
            total: run.total,
            elapsed_ms: outcome.elapsed_ms,
            wpm: outcome.wpm,
            message: outcome.message,
        };
        let _ = app.emit(EVENT_FINISHED, &event);
    }

    fn clear_active(&self, id: u64) {
        let mut guard = self.lock();
        if guard.as_ref().map(|run| run.id) == Some(id) {
            *guard = None;
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Arc<RunControl>>> {
        self.active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

struct SessionOutcome {
    reason: FinishReason,
    elapsed_ms: u64,
    wpm: f64,
    message: Option<String>,
}

fn run_session(
    app: &AppHandle,
    run: &Arc<RunControl>,
    text: &str,
    settings: &AppSettings,
) -> SessionOutcome {
    // Open the keyboard backend before the countdown, so a missing permission
    // or display backend is reported before the user clicks away.
    match input::prepare() {
        Ok(Some(notice)) => {
            let _ = app.emit(
                "mrtyper-toast",
                serde_json::json!({ "kind": "warning", "title": "Limited typing mode", "message": notice }),
            );
        }
        Ok(None) => {}
        Err(message) => {
            return SessionOutcome {
                reason: FinishReason::Error,
                elapsed_ms: 0,
                wpm: 0.0,
                message: Some(message),
            };
        }
    }

    if settings.stop_on_esc {
        if let Err(error) = hotkeys::register_escape(app) {
            return SessionOutcome {
                reason: FinishReason::Error,
                elapsed_ms: 0,
                wpm: 0.0,
                message: Some(format!(
                    "The Escape safety key could not be registered ({error}). Turn off “Escape stops instantly” or choose another app conflict and try again."
                )),
            };
        }
    }

    let start_delay = settings.typing.start_delay_secs.max(1);
    for remaining in (1..=start_delay).rev() {
        run.countdown.store(remaining as u8, Ordering::SeqCst);
        emit_phase(app, run, "countdown", Some(remaining));
        if !run.wait(Duration::from_secs(1)) {
            return cancelled_outcome(run, None);
        }
    }

    let target = match input::foreground_target() {
        Some(target) => target,
        None => {
            return SessionOutcome {
                reason: FinishReason::Error,
                elapsed_ms: 0,
                wpm: 0.0,
                message: Some(input::NO_TARGET_MESSAGE.into()),
            }
        }
    };

    if input::is_own_process(target) {
        return SessionOutcome {
            reason: FinishReason::Error,
            elapsed_ms: 0,
            wpm: 0.0,
            message: Some(
                "MrTyper still had focus when the countdown ended. Click into the target window during the head start."
                    .into(),
            ),
        };
    }

    run.countdown.store(0, Ordering::SeqCst);
    run.phase.store(PHASE_TYPING, Ordering::SeqCst);
    emit_phase(app, run, "typing", None);

    let steps = script::parse(text, settings.script_commands);
    let plan = build_plan(&steps, &settings.typing, None);
    let guarded_target = if settings.stop_on_focus_loss {
        Some(target)
    } else {
        None
    };
    let typing_started = Instant::now();

    // Wait, then make sure the session may go on: it wasn't cancelled, and the
    // target still has focus. A pause can begin at any point in the delay, so
    // focus is checked after the wait, right before the next key is sent.
    let checkpoint = |delay_ms: f64| -> Option<SessionOutcome> {
        if !run.wait(duration_ms(delay_ms)) || !run.wait(Duration::ZERO) {
            return Some(cancelled_outcome(run, Some(typing_started)));
        }
        if let Some(expected) = guarded_target {
            if input::foreground_target() != Some(expected) {
                return Some(focus_lost_outcome(run, typing_started));
            }
        }
        None
    };

    for (index, entry) in plan.entries.iter().enumerate() {
        if let Some(outcome) = checkpoint(entry.pre_delay_ms) {
            return outcome;
        }

        if let Some(typo) = &entry.typo {
            for (position, &key) in typo.keys.iter().enumerate() {
                if position > 0 {
                    if let Some(outcome) = checkpoint(typo.gaps_ms[position - 1]) {
                        return outcome;
                    }
                }
                if let Err(error) = input::send_char(key) {
                    return error_outcome(error, typing_started, run);
                }
                if position == 0 {
                    emit_keystroke(app, run, entry.source_end, "typo");
                }
            }
            if let Some(outcome) = checkpoint(typo.reaction_ms) {
                return outcome;
            }
            for remaining in (0..typo.keys.len()).rev() {
                if let Err(error) = input::send_backspace() {
                    return error_outcome(error, typing_started, run);
                }
                if remaining == 0 {
                    emit_keystroke(app, run, entry.source_end, "correction");
                }
                if let Some(outcome) = checkpoint(typo.backspace_ms) {
                    return outcome;
                }
            }
        }

        let sent = match entry.action {
            Action::Char(character) => input::send_char(character).map(|()| 1),
            Action::Combo(combo) => input::send_combo(&combo).map(|()| 0),
            Action::Pause(_) => Ok(0),
        };
        match sent {
            Ok(count) => {
                run.delivered.fetch_add(count, Ordering::SeqCst);
            }
            Err(error) => return error_outcome(error, typing_started, run),
        }

        run.typed.store(entry.source_end, Ordering::SeqCst);
        if !matches!(entry.action, Action::Pause(_)) {
            emit_keystroke(app, run, entry.source_end, "key");
        }

        let elapsed = typing_started.elapsed();
        let wpm = compute_wpm(run.delivered.load(Ordering::SeqCst), elapsed);
        let completed_ms = plan
            .completed_ms
            .get(index)
            .copied()
            .unwrap_or(plan.total_ms);
        let eta = ((plan.total_ms - completed_ms).max(0.0) / 1000.0).round();
        emit_progress(
            app,
            run,
            entry.source_end,
            wpm,
            Some(eta),
            elapsed.as_millis() as u64,
        );

        if !run.wait(duration_ms(entry.post_delay_ms)) {
            return cancelled_outcome(run, Some(typing_started));
        }
    }

    let elapsed = typing_started.elapsed();
    SessionOutcome {
        reason: FinishReason::Completed,
        elapsed_ms: elapsed.as_millis() as u64,
        wpm: compute_wpm(run.delivered.load(Ordering::SeqCst), elapsed),
        message: None,
    }
}

fn cancelled_outcome(run: &RunControl, started: Option<Instant>) -> SessionOutcome {
    let elapsed = started.map(|time| time.elapsed()).unwrap_or_default();
    SessionOutcome {
        reason: run.cancelled_reason(),
        elapsed_ms: elapsed.as_millis() as u64,
        wpm: compute_wpm(run.delivered.load(Ordering::SeqCst), elapsed),
        message: None,
    }
}

fn focus_lost_outcome(run: &RunControl, started: Instant) -> SessionOutcome {
    let elapsed = started.elapsed();
    SessionOutcome {
        reason: FinishReason::FocusLost,
        elapsed_ms: elapsed.as_millis() as u64,
        wpm: compute_wpm(run.delivered.load(Ordering::SeqCst), elapsed),
        message: Some("MrTyper stopped because the target window lost focus.".into()),
    }
}

fn error_outcome(error: String, started: Instant, run: &RunControl) -> SessionOutcome {
    let elapsed = started.elapsed();
    SessionOutcome {
        reason: FinishReason::Error,
        elapsed_ms: elapsed.as_millis() as u64,
        wpm: compute_wpm(run.delivered.load(Ordering::SeqCst), elapsed),
        message: Some(error),
    }
}

fn emit_phase(app: &AppHandle, run: &RunControl, phase: &'static str, countdown: Option<u32>) {
    let _ = app.emit(
        EVENT_PHASE,
        PhaseEvent {
            phase,
            run_id: run.id,
            countdown,
            total: run.total,
        },
    );
}

fn emit_progress(
    app: &AppHandle,
    run: &RunControl,
    typed: usize,
    wpm: f64,
    eta_secs: Option<f64>,
    elapsed_ms: u64,
) {
    let _ = app.emit(
        EVENT_PROGRESS,
        ProgressEvent {
            run_id: run.id,
            typed,
            total: run.total,
            wpm,
            eta_secs,
            elapsed_ms,
        },
    );
}

fn emit_keystroke(app: &AppHandle, run: &RunControl, index: usize, kind: &'static str) {
    let _ = app.emit(
        EVENT_KEYSTROKE,
        KeystrokeEvent {
            run_id: run.id,
            index,
            kind,
        },
    );
}

fn compute_wpm(typed: usize, elapsed: Duration) -> f64 {
    if typed == 0 || elapsed.as_secs_f64() <= 0.0 {
        return 0.0;
    }
    let minutes = elapsed.as_secs_f64() / 60.0;
    let wpm = (typed as f64 / 5.0) / minutes;
    (wpm.clamp(0.0, 999.0) * 10.0).round() / 10.0
}

pub fn normalize_text(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

// --------------------------------------------------------------------------
// Human timing plan
// --------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct TypoPlan {
    /// Keys typed by mistake: the slip itself, then any characters typed
    /// before it was noticed. All of them are erased again.
    keys: Vec<char>,
    /// Delay before each key in `keys` after the first.
    gaps_ms: Vec<f64>,
    /// The beat between the last mistaken key and the first backspace.
    reaction_ms: f64,
    /// Time after each backspace.
    backspace_ms: f64,
}

impl TypoPlan {
    fn duration_ms(&self) -> f64 {
        self.gaps_ms.iter().sum::<f64>()
            + self.reaction_ms
            + self.backspace_ms * self.keys.len() as f64
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TypoKind {
    /// A neighbouring QWERTY key instead of the right one.
    Neighbor,
    /// Two letters in the wrong order ("teh").
    Swap,
    /// The letter pressed twice.
    Double,
    /// The letter left out.
    Skip,
}

#[derive(Debug, Clone)]
struct PlannedStep {
    action: Action,
    /// Script characters covered once this step is done.
    source_end: usize,
    pre_delay_ms: f64,
    post_delay_ms: f64,
    typo: Option<TypoPlan>,
}

#[derive(Debug, Clone)]
struct TypingPlan {
    entries: Vec<PlannedStep>,
    /// Planned time (ms) consumed by the entry at the same index, including
    /// any typo and its correction. Used for a stable ETA read-out.
    completed_ms: Vec<f64>,
    total_ms: f64,
}

/// How much slower than normal the first key of a warm-up is.
const WARMUP_SLOWDOWN: f64 = 0.6;

fn build_plan(steps: &[Step], settings: &TypingSettings, seed: Option<u64>) -> TypingPlan {
    let total_chars = steps
        .iter()
        .filter(|step| matches!(step.action, Action::Char(_)))
        .count();
    let mut rng = match seed {
        Some(seed) => StdRng::seed_from_u64(seed),
        None => StdRng::from_entropy(),
    };

    let mut entries = Vec::with_capacity(steps.len());
    let mut completed_ms = Vec::with_capacity(steps.len());
    let mut cumulative_ms = 0.0f64;
    let mut source_end = 0usize;
    let mut char_index = 0usize;
    let mut previous_char: Option<char> = None;

    let mut burst_start: Option<usize> = None;
    let mut burst_length = 0usize;
    let mut next_burst_at = rng.gen_range(28..58usize);

    for (step_index, step) in steps.iter().enumerate() {
        source_end += step.source_len;

        let (pre_delay_ms, post_delay_ms, typo) = match step.action {
            Action::Pause(milliseconds) => (milliseconds as f64, 0.0, None),
            Action::Combo(_) => {
                // Reaching for a shortcut takes a moment longer than a key, and
                // the app needs a beat to apply it before typing resumes.
                let reach = base_char_delay(settings, &mut rng) + rng.gen_range(90.0..=220.0);
                (reach, rng.gen_range(140.0..=280.0), None)
            }
            Action::Char(ch) => {
                let index = char_index;
                char_index += 1;
                let mut pre_delay_ms = base_char_delay(settings, &mut rng);

                if settings.burst_enabled {
                    if burst_start.is_none() && index >= next_burst_at {
                        burst_start = Some(index);
                        burst_length = rng.gen_range(8..=24usize);
                    }

                    if let Some(start) = burst_start {
                        if index < start + burst_length {
                            let progress = if burst_length <= 1 {
                                0.5
                            } else {
                                (index - start) as f64 / (burst_length - 1) as f64
                            };
                            let surge = (std::f64::consts::PI * progress).sin()
                                * (settings.burst_intensity / 100.0)
                                * 0.62;
                            pre_delay_ms /= 1.0 + surge.max(0.0);
                        } else {
                            burst_start = None;
                            next_burst_at = index + rng.gen_range(24..=70usize);
                        }
                    }
                }

                if settings.fatigue_enabled && total_chars > 1 {
                    let progress = index as f64 / (total_chars - 1) as f64;
                    pre_delay_ms *= 1.0 + (settings.fatigue_drift / 100.0) * progress;
                }

                if settings.warmup_enabled {
                    let length = settings.warmup_chars.max(1) as usize;
                    if index < length {
                        let remaining = 1.0 - index as f64 / length as f64;
                        pre_delay_ms *= 1.0 + WARMUP_SLOWDOWN * remaining;
                    }
                }

                if settings.capital_enabled
                    && ch.is_uppercase()
                    && !previous_char.is_some_and(char::is_uppercase)
                {
                    pre_delay_ms += settings.capital_extra_ms as f64 * rng.gen_range(0.6..=1.4);
                }

                let mut post_delay_ms = 0.0;
                if settings.punctuation_enabled {
                    if let Some(weight) = punctuation_weight(ch) {
                        post_delay_ms += base_char_delay(settings, &mut rng)
                            * (settings.punctuation_factor - 1.0)
                            * weight;
                    }
                }

                if settings.word_pause_enabled && ch == ' ' && previous_char != Some(' ') {
                    post_delay_ms += settings.word_pause_ms as f64 * rng.gen_range(0.4..=1.6);
                }

                if ch == '\n' {
                    if settings.line_break_enabled {
                        post_delay_ms += settings.line_break_extra_ms as f64
                            + rng.gen_range(0.0..=settings.line_break_extra_ms as f64 * 0.32);
                    }
                    if settings.paragraph_enabled && previous_char == Some('\n') {
                        post_delay_ms +=
                            settings.paragraph_extra_ms as f64 * rng.gen_range(1.0..=1.35);
                    }
                }

                if settings.thinking_enabled
                    && index > 0
                    && index.is_multiple_of(settings.thinking_every_chars.max(1) as usize)
                    && rng.gen_bool(0.7)
                {
                    let maximum = settings.thinking_pause_max_ms as f64;
                    let minimum = (maximum * 0.35).max(300.0);
                    post_delay_ms += rng.gen_range(minimum..=maximum);
                }

                let typo = if settings.typos_enabled {
                    typo_for(steps, step_index, settings, &mut rng)
                } else {
                    None
                };

                previous_char = Some(ch);
                (pre_delay_ms.max(6.0), post_delay_ms.max(0.0), typo)
            }
        };

        let typo_ms = typo.as_ref().map(TypoPlan::duration_ms).unwrap_or(0.0);
        cumulative_ms += pre_delay_ms + post_delay_ms + typo_ms;

        entries.push(PlannedStep {
            action: step.action,
            source_end,
            pre_delay_ms,
            post_delay_ms,
            typo,
        });
        completed_ms.push(cumulative_ms);
    }

    TypingPlan {
        entries,
        completed_ms,
        total_ms: cumulative_ms,
    }
}

fn base_char_delay(settings: &TypingSettings, rng: &mut impl Rng) -> f64 {
    let min_wpm = settings.min_wpm.max(1.0);
    let max_wpm = settings.max_wpm.max(min_wpm);
    let fastest_delay = 12_000.0 / max_wpm;
    let slowest_delay = 12_000.0 / min_wpm;
    let center = (fastest_delay + slowest_delay) / 2.0;
    let spread = ((slowest_delay - fastest_delay) / 2.0) * (settings.randomness / 100.0);
    let jitter = rng.gen_range(-1.0f64..=1.0f64) * spread;
    (center + jitter).max(6.0)
}

fn punctuation_weight(character: char) -> Option<f64> {
    match character {
        '.' | '!' | '?' => Some(1.0),
        ';' | ':' => Some(0.62),
        ',' => Some(0.48),
        _ => None,
    }
}

/// The character typed at `index`, if that step types one.
fn char_at(steps: &[Step], index: usize) -> Option<char> {
    match steps.get(index)?.action {
        Action::Char(character) => Some(character),
        _ => None,
    }
}

fn typo_for(
    steps: &[Step],
    index: usize,
    settings: &TypingSettings,
    rng: &mut impl Rng,
) -> Option<TypoPlan> {
    let character = char_at(steps, index)?;
    let chance = settings.typo_chance;
    if !character.is_ascii_alphabetic()
        || !(0.0..=100.0).contains(&chance)
        || !rng.gen_bool(chance / 100.0)
    {
        return None;
    }

    let next = char_at(steps, index + 1).filter(char::is_ascii_alphabetic);
    let mut kinds = Vec::with_capacity(4);
    if settings.typo_neighbor {
        kinds.push(TypoKind::Neighbor);
    }
    if settings.typo_swap && next.is_some_and(|next| next != character) {
        kinds.push(TypoKind::Swap);
    }
    if settings.typo_double {
        kinds.push(TypoKind::Double);
    }
    if settings.typo_skip && next.is_some() {
        kinds.push(TypoKind::Skip);
    }
    if kinds.is_empty() {
        return None;
    }

    let (mut keys, resume_at) = match kinds[rng.gen_range(0..kinds.len())] {
        TypoKind::Neighbor => {
            let neighbors = qwerty_neighbors(character.to_ascii_lowercase())?;
            let neighbor = neighbors[rng.gen_range(0..neighbors.len())];
            let wrong = if character.is_ascii_uppercase() {
                neighbor.to_ascii_uppercase()
            } else {
                neighbor
            };
            (vec![wrong], index + 1)
        }
        TypoKind::Swap => (vec![next?, character], index + 2),
        TypoKind::Double => (vec![character, character], index + 1),
        TypoKind::Skip => (vec![next?], index + 2),
    };

    // Sometimes the slip is only noticed a few keys later.
    let late_chance = (settings.late_notice_chance / 100.0).clamp(0.0, 1.0);
    if rng.gen_bool(late_chance) {
        let extra = rng.gen_range(1..=3usize);
        for offset in 0..extra {
            match char_at(steps, resume_at + offset) {
                Some(follow) if follow != '\n' && follow != '\t' => keys.push(follow),
                _ => break,
            }
        }
    }

    let gaps_ms = (1..keys.len())
        .map(|_| base_char_delay(settings, rng))
        .collect();
    Some(TypoPlan {
        keys,
        gaps_ms,
        reaction_ms: settings.typo_reaction_ms as f64 * rng.gen_range(0.6..=1.4),
        backspace_ms: settings.backspace_ms as f64 * rng.gen_range(0.75..=1.25),
    })
}

fn qwerty_neighbors(character: char) -> Option<&'static [char]> {
    match character {
        'q' => Some(&['w', 'a']),
        'w' => Some(&['q', 'e', 's', 'a']),
        'e' => Some(&['w', 'r', 'd', 's']),
        'r' => Some(&['e', 't', 'f', 'd']),
        't' => Some(&['r', 'y', 'g', 'f']),
        'y' => Some(&['t', 'u', 'h', 'g']),
        'u' => Some(&['y', 'i', 'j', 'h']),
        'i' => Some(&['u', 'o', 'k', 'j']),
        'o' => Some(&['i', 'p', 'l', 'k']),
        'p' => Some(&['o', 'l']),
        'a' => Some(&['q', 'w', 's', 'z']),
        's' => Some(&['a', 'w', 'e', 'd', 'x', 'z']),
        'd' => Some(&['s', 'e', 'r', 'f', 'c', 'x']),
        'f' => Some(&['d', 'r', 't', 'g', 'v', 'c']),
        'g' => Some(&['f', 't', 'y', 'h', 'b', 'v']),
        'h' => Some(&['g', 'y', 'u', 'j', 'n', 'b']),
        'j' => Some(&['h', 'u', 'i', 'k', 'm', 'n']),
        'k' => Some(&['j', 'i', 'o', 'l', 'm']),
        'l' => Some(&['k', 'o', 'p']),
        'z' => Some(&['a', 's', 'x']),
        'x' => Some(&['z', 's', 'd', 'c']),
        'c' => Some(&['x', 'd', 'f', 'v']),
        'v' => Some(&['c', 'f', 'g', 'b']),
        'b' => Some(&['v', 'g', 'h', 'n']),
        'n' => Some(&['b', 'h', 'j', 'm']),
        'm' => Some(&['n', 'j', 'k']),
        _ => None,
    }
}

fn duration_ms(milliseconds: f64) -> Duration {
    Duration::from_secs_f64(milliseconds.max(0.0) / 1000.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quiet_profile() -> TypingSettings {
        TypingSettings {
            min_wpm: 60.0,
            max_wpm: 120.0,
            randomness: 100.0,
            punctuation_enabled: false,
            line_break_enabled: false,
            thinking_enabled: false,
            burst_enabled: false,
            typos_enabled: false,
            fatigue_enabled: false,
            paragraph_enabled: false,
            word_pause_enabled: false,
            capital_enabled: false,
            warmup_enabled: false,
            ..TypingSettings::default()
        }
    }

    fn build(text: &str, settings: &TypingSettings, seed: u64) -> TypingPlan {
        build_plan(&script::parse(text, true), settings, Some(seed))
    }

    fn only_typo(kind: TypoKind) -> TypingSettings {
        TypingSettings {
            typos_enabled: true,
            typo_chance: 100.0,
            typo_neighbor: kind == TypoKind::Neighbor,
            typo_swap: kind == TypoKind::Swap,
            typo_double: kind == TypoKind::Double,
            typo_skip: kind == TypoKind::Skip,
            late_notice_chance: 0.0,
            ..quiet_profile()
        }
    }

    fn pre_delays(plan: &TypingPlan) -> Vec<f64> {
        plan.entries.iter().map(|entry| entry.pre_delay_ms).collect()
    }

    fn mean(values: &[f64]) -> f64 {
        values.iter().sum::<f64>() / values.len() as f64
    }

    fn standard_deviation(values: &[f64]) -> f64 {
        let average = mean(values);
        let variance =
            values.iter().map(|value| (value - average).powi(2)).sum::<f64>() / values.len() as f64;
        variance.sqrt()
    }

    #[test]
    fn keystroke_delays_stay_inside_the_wpm_envelope() {
        let settings = quiet_profile();
        let plan = build(&"a".repeat(600), &settings, 7);
        let fastest = 12_000.0 / settings.max_wpm;
        let slowest = 12_000.0 / settings.min_wpm;
        let delays = pre_delays(&plan);

        for delay in &delays {
            assert!(
                *delay >= fastest - 0.001 && *delay <= slowest + 0.001,
                "delay {delay} escaped the {fastest}..={slowest}ms envelope"
            );
        }
        assert!(
            delays.iter().any(|delay| (delay - fastest).abs() < 5.0)
                && delays.iter().any(|delay| (delay - slowest).abs() < 5.0),
            "the distribution should use both edges of the envelope"
        );
    }

    #[test]
    fn zero_randomness_produces_a_steady_cadence() {
        let settings = TypingSettings {
            randomness: 0.0,
            ..quiet_profile()
        };
        let plan = build(&"a".repeat(80), &settings, 42);
        let delays = pre_delays(&plan);
        let expected = (12_000.0 / settings.min_wpm + 12_000.0 / settings.max_wpm) / 2.0;

        for delay in delays {
            assert!((delay - expected).abs() < 0.0001);
        }
    }

    #[test]
    fn more_randomness_creates_more_variance() {
        let steady = TypingSettings {
            randomness: 12.0,
            ..quiet_profile()
        };
        let lively = TypingSettings {
            randomness: 100.0,
            ..quiet_profile()
        };
        let steady_plan = build(&"a".repeat(500), &steady, 99);
        let lively_plan = build(&"a".repeat(500), &lively, 99);

        let steady_spread = standard_deviation(&pre_delays(&steady_plan));
        let lively_spread = standard_deviation(&pre_delays(&lively_plan));
        assert!(
            lively_spread > steady_spread * 2.5,
            "expected lively spread {lively_spread} to clearly exceed steady spread {steady_spread}"
        );
    }

    #[test]
    fn punctuation_and_line_breaks_add_human_pauses() {
        let settings = TypingSettings {
            randomness: 0.0,
            punctuation_enabled: true,
            punctuation_factor: 3.5,
            line_break_enabled: true,
            line_break_extra_ms: 500,
            ..quiet_profile()
        };
        let plan = build("Wait.\nReally?", &settings, 5);
        let punctuation_pause = plan.entries[4].post_delay_ms;
        let line_break_pause = plan.entries[5].post_delay_ms;
        let plain_pause = plan.entries[1].post_delay_ms;

        assert!(punctuation_pause > 0.0);
        assert!(line_break_pause >= 500.0);
        assert!(plain_pause == 0.0);
    }

    #[test]
    fn typo_probability_and_qwerty_neighbors_are_sound() {
        let settings = only_typo(TypoKind::Neighbor);
        let plan = build(&"a".repeat(400), &settings, 1234);
        let reaction = settings.typo_reaction_ms as f64;
        let backspace = settings.backspace_ms as f64;
        for entry in &plan.entries {
            let typo = entry.typo.as_ref().expect("every letter should typo");
            assert_eq!(typo.keys.len(), 1);
            assert_ne!(typo.keys[0], 'a');
            assert!(qwerty_neighbors('a').unwrap().contains(&typo.keys[0]));
            assert!((reaction * 0.6..=reaction * 1.4).contains(&typo.reaction_ms));
            assert!((backspace * 0.75..=backspace * 1.25).contains(&typo.backspace_ms));
        }

        let uppercase = build("AAA", &settings, 9);
        assert!(uppercase
            .entries
            .iter()
            .all(|entry| entry.typo.as_ref().unwrap().keys[0].is_ascii_uppercase()));

        let punctuation = build("...!?", &settings, 9);
        assert!(punctuation.entries.iter().all(|entry| entry.typo.is_none()));
    }

    #[test]
    fn each_typo_kind_types_the_expected_slip() {
        let first_typo = |kind: TypoKind| {
            let plan = build("ab", &only_typo(kind), 4);
            plan.entries[0].typo.clone().expect("the first letter should typo").keys
        };
        assert_eq!(first_typo(TypoKind::Swap), vec!['b', 'a']);
        assert_eq!(first_typo(TypoKind::Double), vec!['a', 'a']);
        assert_eq!(first_typo(TypoKind::Skip), vec!['b']);

        // Swaps and skips need a following letter; the last one can't do either.
        let swap_only = build("ab", &only_typo(TypoKind::Swap), 4);
        assert!(swap_only.entries[1].typo.is_none());
    }

    #[test]
    fn a_late_noticed_typo_also_erases_the_keys_typed_after_it() {
        let settings = TypingSettings {
            late_notice_chance: 100.0,
            ..only_typo(TypoKind::Neighbor)
        };
        let plan = build("abcdef", &settings, 21);
        let typo = plan.entries[0].typo.as_ref().unwrap();
        assert!((2..=4).contains(&typo.keys.len()));
        assert_eq!(&typo.keys[1..], &['b', 'c', 'd'][..typo.keys.len() - 1]);
        assert_eq!(typo.gaps_ms.len(), typo.keys.len() - 1);

        // Never past the end of a line.
        let short = build("a\nbcd", &settings, 21);
        assert_eq!(short.entries[0].typo.as_ref().unwrap().keys.len(), 1);
    }

    #[test]
    fn commands_become_shortcuts_and_pauses_without_typos() {
        let settings = TypingSettings {
            typos_enabled: true,
            typo_chance: 100.0,
            ..quiet_profile()
        };
        let plan = build("a{{bold}}b{{pause 2}}", &settings, 6);
        let ends: Vec<usize> = plan.entries.iter().map(|entry| entry.source_end).collect();
        assert_eq!(ends, vec![1, 9, 10, 21]);
        assert!(matches!(plan.entries[1].action, Action::Combo(_)));
        assert!(plan.entries[1].typo.is_none());
        assert_eq!(plan.entries[3].action, Action::Pause(2000));
        assert_eq!(plan.entries[3].pre_delay_ms, 2000.0);
    }

    #[test]
    fn paragraphs_capitals_and_words_add_their_own_pauses() {
        let settings = TypingSettings {
            randomness: 0.0,
            paragraph_enabled: true,
            paragraph_extra_ms: 1000,
            capital_enabled: true,
            capital_extra_ms: 100,
            word_pause_enabled: true,
            word_pause_ms: 100,
            ..quiet_profile()
        };
        let plan = build("a b\n\nCd", &settings, 2);
        let base = (12_000.0 / settings.min_wpm + 12_000.0 / settings.max_wpm) / 2.0;
        assert!(plan.entries[1].post_delay_ms >= 40.0, "space");
        assert_eq!(plan.entries[3].post_delay_ms, 0.0, "a single line break");
        assert!(plan.entries[4].post_delay_ms >= 1000.0, "the blank line");
        assert!(plan.entries[5].pre_delay_ms >= base + 60.0, "the capital");
        assert!((plan.entries[6].pre_delay_ms - base).abs() < 0.001, "lowercase");
    }

    #[test]
    fn warm_up_starts_slow_and_reaches_full_speed() {
        let settings = TypingSettings {
            randomness: 0.0,
            warmup_enabled: true,
            warmup_chars: 50,
            ..quiet_profile()
        };
        let plan = build(&"a".repeat(80), &settings, 3);
        let base = (12_000.0 / settings.min_wpm + 12_000.0 / settings.max_wpm) / 2.0;
        assert!((plan.entries[0].pre_delay_ms - base * (1.0 + WARMUP_SLOWDOWN)).abs() < 0.001);
        assert!(plan.entries[25].pre_delay_ms < plan.entries[0].pre_delay_ms);
        assert!((plan.entries[60].pre_delay_ms - base).abs() < 0.001);
    }

    #[test]
    fn disabling_typos_produces_none() {
        let settings = TypingSettings {
            typos_enabled: false,
            typo_chance: 100.0,
            ..quiet_profile()
        };
        let plan = build("Hello, world!", &settings, 8);
        assert!(plan.entries.iter().all(|entry| entry.typo.is_none()));
    }

    #[test]
    fn plan_accounts_for_extra_pauses_in_eta() {
        let settings = TypingSettings {
            randomness: 0.0,
            punctuation_enabled: true,
            punctuation_factor: 4.0,
            ..quiet_profile()
        };
        let plan = build("hi. there.", &settings, 3);
        assert!(plan.total_ms > 0.0);
        assert!(plan.completed_ms.windows(2).all(|window| window[0] <= window[1]));
        assert!((plan.completed_ms.last().unwrap() - plan.total_ms).abs() < 0.0001);
    }

    #[test]
    fn text_normalization_keeps_unicode_intact() {
        assert_eq!(normalize_text("café\r\n世界\r👋"), "café\n世界\n👋");
        assert_eq!(
            normalize_text("café\r\n世界\r👋").chars().count(),
            "café\n世界\n👋".chars().count()
        );
    }

    #[test]
    fn wpm_is_capped_and_reasonable() {
        assert_eq!(compute_wpm(0, Duration::from_secs(2)), 0.0);
        let measured = compute_wpm(10, Duration::from_secs(12));
        assert!((measured - 10.0).abs() < 0.1);
        assert!(compute_wpm(5000, Duration::from_millis(1)) <= 999.0);
    }
}
