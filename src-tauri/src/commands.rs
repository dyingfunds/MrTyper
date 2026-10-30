use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::engine::{Engine, StopIntent};
use crate::hotkeys;
use crate::settings::{AppSettings, Preset, TypingSettings};
use crate::store::{Store, WindowBounds};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapPayload {
    settings: AppSettings,
    presets: Vec<Preset>,
    last_text: String,
    window_bounds: Option<WindowBounds>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    pub text: String,
    pub settings: AppSettings,
}

#[tauri::command]
pub fn bootstrap(store: State<'_, Arc<Store>>) -> BootstrapPayload {
    let snapshot = store.snapshot();
    BootstrapPayload {
        settings: snapshot.settings,
        presets: snapshot.presets,
        last_text: snapshot.last_text,
        window_bounds: snapshot.window_bounds,
    }
}

#[tauri::command]
pub async fn save_settings(
    app: AppHandle,
    store: State<'_, Arc<Store>>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let normalized = settings.normalized();
    normalized.validate_hotkeys()?;

    let previous = store.settings();
    let hotkeys_changed = previous.hotkey_start != normalized.hotkey_start
        || previous.hotkey_pause != normalized.hotkey_pause;

    if hotkeys_changed {
        hotkeys::replace(&app, &previous, &normalized)?;
    }

    if let Err(error) = store.save_settings(normalized.clone()) {
        if hotkeys_changed {
            let _ = hotkeys::replace(&app, &normalized, &previous);
        }
        return Err(error);
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(normalized.always_on_top);
    }

    Ok(normalized)
}

#[tauri::command]
pub async fn save_last_text(
    store: State<'_, Arc<Store>>,
    text: String,
) -> Result<(), String> {
    store.save_last_text(text)
}

#[tauri::command]
pub async fn save_window_bounds(
    store: State<'_, Arc<Store>>,
    bounds: WindowBounds,
) -> Result<(), String> {
    store.save_window_bounds(bounds)
}

#[tauri::command]
pub async fn start_typing(
    app: AppHandle,
    engine: State<'_, Arc<Engine>>,
    store: State<'_, Arc<Store>>,
    request: StartRequest,
) -> Result<(), String> {
    let settings = request.settings.normalized();

    if let Err(error) = store.save_session(settings.clone(), request.text.clone()) {
        // A full disk or locked config should not stop the typing session, but
        // the user should still know the last script may not be remembered.
        crate::actions::toast(
            &app,
            "warning",
            "Session couldn't be saved",
            error,
        );
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(settings.always_on_top);
    }

    engine
        .inner()
        .clone()
        .start(app, request.text, settings)
}

#[tauri::command]
pub fn pause_typing(app: AppHandle, engine: State<'_, Arc<Engine>>) -> Result<(), String> {
    engine.pause(&app)
}

#[tauri::command]
pub fn resume_typing(app: AppHandle, engine: State<'_, Arc<Engine>>) -> Result<(), String> {
    engine.resume(&app)
}

#[tauri::command]
pub fn stop_typing(engine: State<'_, Arc<Engine>>) -> Result<(), String> {
    engine.stop(StopIntent::User);
    Ok(())
}

#[tauri::command]
pub fn emergency_stop(engine: State<'_, Arc<Engine>>) -> Result<(), String> {
    engine.stop(StopIntent::Escape);
    Ok(())
}

#[tauri::command]
pub fn get_engine_status(engine: State<'_, Arc<Engine>>) -> crate::engine::EngineStatus {
    engine.status()
}

#[tauri::command]
pub async fn save_preset(
    store: State<'_, Arc<Store>>,
    name: String,
    typing: TypingSettings,
) -> Result<Preset, String> {
    store.add_preset(&name, typing)
}

#[tauri::command]
pub async fn rename_preset(
    store: State<'_, Arc<Store>>,
    id: String,
    name: String,
) -> Result<Preset, String> {
    store.rename_preset(&id, &name)
}

#[tauri::command]
pub async fn delete_preset(
    store: State<'_, Arc<Store>>,
    id: String,
) -> Result<(), String> {
    store.delete_preset(&id)
}

#[tauri::command]
pub fn apply_backdrop_theme(window: WebviewWindow, dark: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_acrylic, apply_mica};
        if apply_mica(&window, Some(dark)).is_ok() {
            return Ok(());
        }
        apply_acrylic(&window, Some((10, 13, 27, 190)))
            .map_err(|error| format!("Could not apply the Windows backdrop: {error}"))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (&window, dark);
    }

    Ok(())
}
