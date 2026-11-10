use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::engine::{Engine, StopIntent};
use crate::store::{Store, WindowBounds};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToastEvent {
    kind: &'static str,
    title: &'static str,
    message: String,
}

pub fn start_or_stop(app: &AppHandle) {
    let engine = app.state::<Arc<Engine>>();
    if engine.is_active() {
        engine.stop(StopIntent::User);
        return;
    }

    let store = app.state::<Arc<Store>>();
    let settings = store.settings();
    let text = store.last_text();

    if text.trim().is_empty() {
        reveal_window(app);
        toast(
            app,
            "warning",
            "Nothing to type yet",
            "Add a script in MrTyper, then press your start shortcut again.".to_string(),
        );
        return;
    }

    if let Err(error) = engine.start(app.clone(), text, settings) {
        reveal_window(app);
        toast(app, "error", "Couldn't start typing", error);
    }
}

pub fn toggle_pause(app: &AppHandle) {
    let engine = app.state::<Arc<Engine>>();
    let result = match engine.phase() {
        Some("typing") => engine.pause(app),
        Some("paused") => engine.resume(app),
        _ => return,
    };

    if let Err(error) = result {
        toast(app, "error", "Pause toggle failed", error);
    }
}

pub fn emergency_stop(app: &AppHandle) {
    app.state::<Arc<Engine>>().stop(StopIntent::Escape);
}

pub fn reveal_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn toast(app: &AppHandle, kind: &'static str, title: &'static str, message: String) {
    let _ = app.emit(
        "mrtyper-toast",
        ToastEvent {
            kind,
            title,
            message,
        },
    );
}

pub fn save_window_bounds(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_maximized().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        return;
    }

    let Ok(position) = window.outer_position() else {
        return;
    };
    let Ok(size) = window.inner_size() else {
        return;
    };
    let bounds = WindowBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    if let Some(store) = app.try_state::<Arc<Store>>() {
        let _ = store.save_window_bounds(bounds);
    }
}
