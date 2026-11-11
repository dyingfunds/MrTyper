mod actions;
mod commands;
mod engine;
mod hotkeys;
mod input;
mod script;
mod settings;
mod store;
mod tray;

use std::sync::Arc;

use tauri::webview::WebviewWindowBuilder;
use tauri::{Manager, WindowEvent};
use tauri_plugin_global_shortcut::ShortcutState;

use crate::engine::Engine;
use crate::store::Store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin. Launching MrTyper again brings back the
        // running window, even when it is hidden in the tray or menu bar.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            actions::reveal_window(app);
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        hotkeys::dispatch(app, shortcut);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::save_settings,
            commands::save_last_text,
            commands::save_window_bounds,
            commands::start_typing,
            commands::pause_typing,
            commands::resume_typing,
            commands::stop_typing,
            commands::emergency_stop,
            commands::get_engine_status,
            commands::save_preset,
            commands::rename_preset,
            commands::delete_preset,
            commands::apply_backdrop_theme,
            commands::can_self_update,
        ])
        .setup(|app| {
            let config_dir = std::env::var_os("MRTYPER_CONFIG_DIR")
                .map(std::path::PathBuf::from)
                .map(Ok)
                .unwrap_or_else(|| app.path().app_config_dir())?;
            let store = Arc::new(Store::load(config_dir.join("mrtyper.json")));
            let engine = Arc::new(Engine::new());

            app.manage(Arc::clone(&store));
            app.manage(Arc::clone(&engine));

            // Create the window explicitly so the webview (WebView2 on Windows,
            // WebKitGTK on Linux) always has a writable data directory, even in
            // tightly managed environments.
            let window_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|config| config.label == "main")
                .cloned()
                .ok_or_else(|| {
                    std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "The main window configuration is missing.",
                    )
                })?;
            let webview_data = webview_data_directory(app)?;
            let window = WebviewWindowBuilder::from_config(app.handle(), &window_config)?
                .data_directory(webview_data)
                .build()
                .map_err(|error| {
                    eprintln!("MrTyper: could not create the main window: {error}");
                    error
                })?;

            restore_window_bounds(&window, &store);
            apply_backdrop(&window);

            if let Err(error) = tray::create(app) {
                // Some locked-down Windows sessions do not expose a
                // notification area. The writing room still works without it.
                eprintln!("MrTyper: could not create the tray icon: {error}");
            }

            hotkeys::initialize(app.handle().clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Focused(focused) = event {
                input::set_own_window_focused(*focused);
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Closing the writing room hides MrTyper to the tray (menu bar on
                // macOS); the tray menu's Quit item performs a real shutdown.
                api.prevent_close();
                actions::save_window_bounds(window.app_handle());
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building MrTyper")
        .run(|_app, _event| {
            // macOS: clicking the Dock icon brings back the hidden window.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                actions::reveal_window(_app);
            }
        });
}

fn restore_window_bounds(window: &tauri::WebviewWindow, store: &Store) {
    let Some(bounds) = store.window_bounds() else {
        return;
    };
    if !bounds.is_reasonable() {
        return;
    }

    let _ = window.set_size(tauri::PhysicalSize::new(bounds.width, bounds.height));
    let _ = window.set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y));
}

/// Windows 11 Mica (Acrylic on Windows 10) behind the window. Other platforms
/// paint an opaque background in CSS.
#[allow(unused_variables)]
fn apply_backdrop(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_acrylic, apply_mica};

        if apply_mica(window, None).is_err() {
            let _ = apply_acrylic(window, Some((10, 13, 27, 190)));
        }
    }
}

/// The webview needs a real writable profile directory. Prefer the app's local
/// data folder, but keep a temp-directory fallback for locked-down machines.
/// The folder keeps its original `webview2` name on every platform so existing
/// Windows installs keep their stored UI preferences.
fn webview_data_directory(app: &tauri::App) -> std::io::Result<std::path::PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("MRTYPER_WEBVIEW_DIR") {
        candidates.push(std::path::PathBuf::from(path));
    }
    if let Ok(local_data) = app.path().app_local_data_dir() {
        candidates.push(local_data.join("webview2"));
    }
    candidates.push(std::env::temp_dir().join("mrtyper-webview2"));

    let mut last_error = None;
    for candidate in candidates {
        match std::fs::create_dir_all(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) => last_error = Some(error),
        }
    }

    Err(last_error.unwrap_or_else(|| {
        std::io::Error::other("No suitable webview data directory was available.")
    }))
}
