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
    typed: AtomicUsize,
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
                message: Some(
                    "Windows could not find a focused target window. Click into the app you want to type into and try again."
                        .into(),
                ),
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

    let plan = build_plan(text, &settings.typing, None);
    let guarded_target = if settings.stop_on_focus_loss {
        Some(target)
    } else {
        None
    };
    let typing_started = Instant::now();

    for (index, entry) in plan.entries.iter().enumerate() {
        if !run.wait(duration_ms(entry.pre_delay_ms)) {
            return cancelled_outcome(run, Some(typing_started));
        }

        // A pause can begin at any point in the delay. Re-check the foreground
        // window after the wait so a correction is never sent to a new target.
        if !run.wait(Duration::ZERO) {
            return cancelled_outcome(run, Some(typing_started));
        }
        if let Some(expected) = guarded_target {
            if input::foreground_target() != Some(expected) {
                return focus_lost_outcome(run, typing_started);
            }
        }

        if let Some(typo) = &entry.typo {
            if let Err(error) = input::send_char(typo.wrong) {
                return error_outcome(error, typing_started, run);
            }
            emit_keystroke(app, run, index + 1, "typo");

            if !run.wait(duration_ms(typo.beat_ms)) {
                return cancelled_outcome(run, Some(typing_started));
            }
            if !run.wait(Duration::ZERO) {
                return cancelled_outcome(run, Some(typing_started));
            }
            if let Some(expected) = guarded_target {
                if input::foreground_target() != Some(expected) {
                    return focus_lost_outcome(run, typing_started);
                }
            }
            if let Err(error) = input::send_backspace() {
                return error_outcome(error, typing_started, run);
            }
            emit_keystroke(app, run, index + 1, "correction");

            if !run.wait(duration_ms(typo.correction_ms)) {
                return cancelled_outcome(run, Some(typing_started));
            }
        }

        if !run.wait(Duration::ZERO) {
            return cancelled_outcome(run, Some(typing_started));
        }
        if let Some(expected) = guarded_target {
            if input::foreground_target() != Some(expected) {
                return focus_lost_outcome(run, typing_started);
            }
        }
        if let Err(error) = input::send_char(entry.ch) {
            return error_outcome(error, typing_started, run);
        }

        run.typed.store(index + 1, Ordering::SeqCst);
        emit_keystroke(app, run, index + 1, "key");

        let elapsed = typing_started.elapsed();
        let wpm = compute_wpm(index + 1, elapsed);
        let completed_ms = plan
            .completed_ms
            .get(index)
            .copied()
            .unwrap_or(plan.total_ms);
        let eta = ((plan.total_ms - completed_ms).max(0.0) / 1000.0).round();
        emit_progress(
            app,
            run,
            index + 1,
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
        wpm: compute_wpm(run.typed.load(Ordering::SeqCst), elapsed),
        message: None,
    }
}

fn cancelled_outcome(run: &RunControl, started: Option<Instant>) -> SessionOutcome {
    let elapsed = started.map(|time| time.elapsed()).unwrap_or_default();
    SessionOutcome {
        reason: run.cancelled_reason(),
        elapsed_ms: elapsed.as_millis() as u64,
        wpm: compute_wpm(run.typed.load(Ordering::SeqCst), elapsed),
        message: None,
    }
}

fn focus_lost_outcome(run: &RunControl, started: Instant) -> SessionOutcome {
    let elapsed = started.elapsed();
    SessionOutcome {
        reason: FinishReason::FocusLost,
        elapsed_ms: elapsed.as_millis() as u64,
        wpm: compute_wpm(run.typed.load(Ordering::SeqCst), elapsed),
        message: Some("MrTyper stopped because the target window lost focus.".into()),
    }
}

fn error_outcome(error: String, started: Instant, run: &RunControl) -> SessionOutcome {
    let elapsed = started.elapsed();
    SessionOutcome {
        reason: FinishReason::Error,
        elapsed_ms: elapsed.as_millis() as u64,
        wpm: compute_wpm(run.typed.load(Ordering::SeqCst), elapsed),
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
    wrong: char,
    beat_ms: f64,
    correction_ms: f64,
}

#[derive(Debug, Clone)]
struct PlannedChar {
    ch: char,
    pre_delay_ms: f64,
    post_delay_ms: f64,
    typo: Option<TypoPlan>,
}

#[derive(Debug, Clone)]
struct TypingPlan {
    entries: Vec<PlannedChar>,
    /// Planned time (ms) consumed by the entry at the same index, including
    /// the corrected character. Used for a stable ETA read-out.
    completed_ms: Vec<f64>,
    total_ms: f64,
}

fn build_plan(text: &str, settings: &TypingSettings, seed: Option<u64>) -> TypingPlan {
    let characters: Vec<char> = text.chars().collect();
    let total_chars = characters.len();
    let mut rng = match seed {
        Some(seed) => StdRng::seed_from_u64(seed),
        None => StdRng::from_entropy(),
    };

    let mut entries = Vec::with_capacity(total_chars);
    let mut completed_ms = Vec::with_capacity(total_chars);
    let mut cumulative_ms = 0.0f64;

    let mut burst_start: Option<usize> = None;
    let mut burst_length = 0usize;
    let mut next_burst_at = rng.gen_range(28..58usize);

    for (index, &ch) in characters.iter().enumerate() {
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

        let mut post_delay_ms = 0.0;
        if settings.punctuation_enabled {
            if let Some(weight) = punctuation_weight(ch) {
                post_delay_ms +=
                    base_char_delay(settings, &mut rng) * (settings.punctuation_factor - 1.0) * weight;
            }
        }

        if settings.line_break_enabled && ch == '\n' {
            post_delay_ms +=
                settings.line_break_extra_ms as f64 + rng.gen_range(0.0..=settings.line_break_extra_ms as f64 * 0.32);
        }

        if settings.thinking_enabled
            && index > 0
            && index % settings.thinking_every_chars.max(1) as usize == 0
            && rng.gen_bool(0.7)
        {
            let maximum = settings.thinking_pause_max_ms as f64;
            let minimum = (maximum * 0.35).max(300.0);
            post_delay_ms += rng.gen_range(minimum..=maximum);
        }

        let typo = if settings.typos_enabled {
            typo_for(ch, settings.typo_chance, &mut rng)
        } else {
            None
        };

        pre_delay_ms = pre_delay_ms.max(6.0);
        post_delay_ms = post_delay_ms.max(0.0);

        let typo_ms = typo
            .as_ref()
            .map(|typo| typo.beat_ms + typo.correction_ms)
            .unwrap_or(0.0);
        cumulative_ms += pre_delay_ms + post_delay_ms + typo_ms;

        entries.push(PlannedChar {
            ch,
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

fn typo_for(character: char, chance_percent: f64, rng: &mut impl Rng) -> Option<TypoPlan> {
    if !character.is_ascii_alphabetic()
        || !(0.0..=100.0).contains(&chance_percent)
        || !rng.gen_bool(chance_percent / 100.0)
    {
        return None;
    }

    let lower = character.to_ascii_lowercase();
    let neighbors = qwerty_neighbors(lower)?;
    let neighbor = neighbors[rng.gen_range(0..neighbors.len())];
    let wrong = if character.is_ascii_uppercase() {
        neighbor.to_ascii_uppercase()
    } else {
        neighbor
    };

    Some(TypoPlan {
        wrong,
        beat_ms: rng.gen_range(70.0..=180.0),
        correction_ms: rng.gen_range(45.0..=115.0),
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
            ..TypingSettings::default()
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
        let plan = build_plan(&"a".repeat(600), &settings, Some(7));
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
        let plan = build_plan(&"a".repeat(80), &settings, Some(42));
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
        let steady_plan = build_plan(&"a".repeat(500), &steady, Some(99));
        let lively_plan = build_plan(&"a".repeat(500), &lively, Some(99));

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
        let plan = build_plan("Wait.\nReally?", &settings, Some(5));
        let punctuation_pause = plan.entries[4].post_delay_ms;
        let line_break_pause = plan.entries[5].post_delay_ms;
        let plain_pause = plan.entries[1].post_delay_ms;

        assert!(punctuation_pause > 0.0);
        assert!(line_break_pause >= 500.0);
        assert!(plain_pause == 0.0);
    }

    #[test]
    fn typo_probability_and_qwerty_neighbors_are_sound() {
        let settings = TypingSettings {
            typos_enabled: true,
            typo_chance: 100.0,
            burst_enabled: false,
            ..quiet_profile()
        };
        let plan = build_plan(&"a".repeat(400), &settings, Some(1234));
        for entry in &plan.entries {
            let typo = entry.typo.as_ref().expect("every letter should typo");
            assert_ne!(typo.wrong, 'a');
            assert!(qwerty_neighbors('a').unwrap().contains(&typo.wrong));
            assert!((70.0..=180.0).contains(&typo.beat_ms));
            assert!((45.0..=115.0).contains(&typo.correction_ms));
        }

        let uppercase = build_plan("AAA", &settings, Some(9));
        assert!(uppercase
            .entries
            .iter()
            .all(|entry| entry.typo.as_ref().unwrap().wrong.is_ascii_uppercase()));

        let punctuation = build_plan("...!?", &settings, Some(9));
        assert!(punctuation.entries.iter().all(|entry| entry.typo.is_none()));
    }

    #[test]
    fn disabling_typos_produces_none() {
        let settings = TypingSettings {
            typos_enabled: false,
            typo_chance: 100.0,
            ..quiet_profile()
        };
        let plan = build_plan("Hello, world!", &settings, Some(8));
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
        let plan = build_plan("hi. there.", &settings, Some(3));
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
