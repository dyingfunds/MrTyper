use std::str::FromStr;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::actions;
use crate::settings::{parse_hotkey, AppSettings};
use crate::store::Store;

const ESCAPE_ACCELERATOR: &str = "Escape";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToastEvent {
    kind: &'static str,
    title: &'static str,
    message: String,
}

/// Register the saved start/pause accelerators once the event loop is alive.
/// This runs off the setup thread because the shortcut backend marshals native
/// calls to the main thread.
pub fn initialize(app: AppHandle) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(500));
        let settings = app.state::<Arc<Store>>().settings();
        if let Err(error) = register_initial(&app, &settings) {
            eprintln!("MrTyper: could not register global shortcuts: {error}");
            let _ = app.emit(
                "mrtyper-toast",
                ToastEvent {
                    kind: "warning",
                    title: "Shortcuts unavailable",
                    message: error,
                },
            );
        }
    });
}

pub fn dispatch(app: &AppHandle, shortcut: &Shortcut) {
    let settings = app.state::<Arc<Store>>().settings();

    if shortcut_matches(shortcut, &settings.hotkey_start) {
        actions::start_or_stop(app);
        return;
    }
    if shortcut_matches(shortcut, &settings.hotkey_pause) {
        actions::toggle_pause(app);
        return;
    }
    if is_escape(shortcut) {
        actions::emergency_stop(app);
    }
}

pub fn register_escape(app: &AppHandle) -> Result<(), String> {
    let manager = app.global_shortcut();
    if manager.is_registered(ESCAPE_ACCELERATOR) {
        return Ok(());
    }
    manager
        .register(ESCAPE_ACCELERATOR)
        .map_err(|error| error.to_string())
}

pub fn unregister_escape(app: &AppHandle) {
    let manager = app.global_shortcut();
    if manager.is_registered(ESCAPE_ACCELERATOR) {
        let _ = manager.unregister(ESCAPE_ACCELERATOR);
    }
}

fn register_initial(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let manager = app.global_shortcut();
    let start = parse_hotkey(&settings.hotkey_start)?;
    let pause = parse_hotkey(&settings.hotkey_pause)?;

    if start.id() == pause.id() {
        return Err("Start and pause shortcuts must be different.".into());
    }

    for (label, accelerator) in [
        ("start", &settings.hotkey_start),
        ("pause", &settings.hotkey_pause),
    ] {
        if !manager.is_registered(accelerator.as_str()) {
            if let Err(error) = manager.register(accelerator.as_str()) {
                // Roll back a partial registration so the next launch starts cleanly.
                let _ = manager.unregister(settings.hotkey_start.as_str());
                let _ = manager.unregister(settings.hotkey_pause.as_str());
                return Err(format!(
                    "The {label} shortcut “{accelerator}” is already used by another app ({error}). Choose another shortcut in Settings."
                ));
            }
        }
    }

    Ok(())
}

/// Replace the start/pause bindings transactionally. If the new chord cannot be
/// claimed, the previous pair is restored before returning the error.
pub fn replace(app: &AppHandle, old: &AppSettings, new: &AppSettings) -> Result<(), String> {
    if old.hotkey_start == new.hotkey_start && old.hotkey_pause == new.hotkey_pause {
        return Ok(());
    }

    parse_hotkey(&new.hotkey_start)?;
    parse_hotkey(&new.hotkey_pause)?;

    let manager = app.global_shortcut();
    let _ = manager.unregister(old.hotkey_start.as_str());
    let _ = manager.unregister(old.hotkey_pause.as_str());

    let register_start = manager.register(new.hotkey_start.as_str());
    if let Err(error) = register_start {
        restore(app, old);
        return Err(format!(
            "Could not register “{}”: {error}",
            new.hotkey_start
        ));
    }

    if let Err(error) = manager.register(new.hotkey_pause.as_str()) {
        let _ = manager.unregister(new.hotkey_start.as_str());
        restore(app, old);
        return Err(format!(
            "Could not register “{}”: {error}",
            new.hotkey_pause
        ));
    }

    Ok(())
}

fn restore(app: &AppHandle, settings: &AppSettings) {
    let manager = app.global_shortcut();
    if let Err(error) = manager.register(settings.hotkey_start.as_str()) {
        eprintln!("MrTyper: could not restore start shortcut: {error}");
    }
    if let Err(error) = manager.register(settings.hotkey_pause.as_str()) {
        eprintln!("MrTyper: could not restore pause shortcut: {error}");
    }
}

fn shortcut_matches(shortcut: &Shortcut, accelerator: &str) -> bool {
    Shortcut::from_str(accelerator.trim())
        .map(|bound| bound.id() == shortcut.id())
        .unwrap_or(false)
}

fn is_escape(shortcut: &Shortcut) -> bool {
    Shortcut::from_str(ESCAPE_ACCELERATOR)
        .map(|escape| escape.id() == shortcut.id())
        .unwrap_or(false)
}
