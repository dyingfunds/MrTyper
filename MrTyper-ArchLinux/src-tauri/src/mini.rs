//! The floating mini window: a small always-on-top bar with progress, pause
//! and stop, shown while a session runs.
//!
//! It never takes keyboard focus, so clicking Pause or Resume in it leaves the
//! target window focused and "Stop when focus leaves" keeps working. It is
//! created the first time it's needed and then only shown and hidden.

use std::path::PathBuf;

use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl};

pub const LABEL: &str = "mini";

const WIDTH: f64 = 340.0;
const HEIGHT: f64 = 58.0;
/// Gap between the top of the screen and the bar, in logical pixels.
const TOP_MARGIN: f64 = 14.0;

/// The webview profile folder, shared by every window of the app. WebView2
/// refuses a second window with a different one.
pub struct WebviewDataDir(pub PathBuf);

/// Show the bar for a new session. Safe to call from any thread.
pub fn show(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let window = match handle.get_webview_window(LABEL) {
            Some(window) => window,
            None => match create(&handle) {
                Ok(window) => window,
                Err(error) => {
                    eprintln!("MrTyper: could not create the mini window: {error}");
                    return;
                }
            },
        };
        let _ = window.show();
        let _ = window.set_always_on_top(true);
        // Window managers on Linux place a window themselves when it is first
        // shown, ignoring a position set while it was hidden. Place it again
        // now it's visible, and once more after the window manager is done.
        #[cfg(target_os = "linux")]
        {
            place_top_center(&handle, &window);
            let later = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(150));
                let inner = later.clone();
                let _ = later.run_on_main_thread(move || {
                    if let Some(window) = inner.get_webview_window(LABEL) {
                        place_top_center(&inner, &window);
                        let _ = window.set_always_on_top(true);
                    }
                });
            });
        }
    });
}

/// Hide the bar when a session ends. Safe to call from any thread.
pub fn hide(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window(LABEL) {
            let _ = window.hide();
        }
    });
}

fn create(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    let mut builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::default())
        .title("MrTyper")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .visible(false);

    // A rounded bar on Windows; macOS and Linux draw it as a plain rectangle,
    // since their transparent windows need extra platform features.
    #[cfg(target_os = "windows")]
    {
        builder = builder.transparent(true);
    }

    // GTK grows a non-resizable window to its webview's natural size, about
    // 200 px tall, so the bar's height was ignored. A resizable window keeps
    // the size it's given, and equal min and max sizes still pin it.
    #[cfg(target_os = "linux")]
    {
        builder = builder
            .resizable(true)
            .min_inner_size(WIDTH, HEIGHT)
            .max_inner_size(WIDTH, HEIGHT);
    }

    if let Some(directory) = app.try_state::<WebviewDataDir>() {
        builder = builder.data_directory(directory.0.clone());
    }

    let window = builder.build()?;
    place_top_center(app, &window);
    Ok(window)
}

/// Top centre of the screen the main window is on.
fn place_top_center(app: &AppHandle, window: &tauri::WebviewWindow) {
    let monitor = app
        .get_webview_window("main")
        .and_then(|main| main.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let width = (WIDTH * scale).round() as i32;
    let x = area.position.x + (area.size.width as i32 - width) / 2;
    let y = area.position.y + (TOP_MARGIN * scale).round() as i32;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}
