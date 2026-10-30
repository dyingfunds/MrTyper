use std::sync::Arc;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::actions;
use crate::engine::{Engine, StopIntent};

const TRAY_ID: &str = "mrtyper-tray";

pub fn create(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open MrTyper", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Start / stop typing", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause / resume", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit MrTyper", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&open, &toggle, &pause, &separator, &quit_item],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("MrTyper — human-paced typing")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => actions::reveal_window(app),
            "toggle" => actions::start_or_stop(app),
            "pause" => actions::toggle_pause(app),
            "quit" => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

fn toggle_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);

    if visible && focused {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn quit_app(app: &AppHandle) {
    actions::save_window_bounds(app);
    app.state::<Arc<Engine>>().stop(StopIntent::User);
    app.exit(0);
}
