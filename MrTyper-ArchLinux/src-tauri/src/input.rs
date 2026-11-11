//! Linux keyboard injection and focus detection.
//!
//! Keystrokes go through exactly one backend, picked from the session type:
//!
//! * **X11** — XTest via `enigo`. Characters that are not on the current
//!   keyboard layout are typed by briefly remapping a spare keycode, so
//!   accents, CJK, and emoji all work. The focused window is read from the
//!   window manager's `_NET_ACTIVE_WINDOW`.
//! * **Wayland** — the `zwp_virtual_keyboard_v1` protocol (Hyprland, Sway,
//!   river, and other wlroots compositors). Wayland does not let apps see
//!   which window is focused, so the focus guard can only tell whether
//!   MrTyper itself has focus.
//! * **Wayland without virtual keyboards** (GNOME, KDE) — falls back to
//!   XWayland and warns that only X11 apps can receive the text.
//!
//! Using a single backend matters: enigo sends through every connection it
//! holds, so connecting to both X11 and Wayland would type every key twice.

use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};

use enigo::{Direction, Enigo, Key, Keyboard, NewConError, Settings};

use crate::script::{ComboKey, KeyCombo, NamedKey};

/// Opaque identity of the focused target. On X11 it is the window id; on
/// Wayland it only records whether MrTyper itself is focused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FocusTarget {
    raw: u64,
}

const WAYLAND_ELSEWHERE: u64 = u64::MAX - 1;
const WAYLAND_OWN_WINDOW: u64 = u64::MAX;

/// A display name that can never connect, used to switch a backend off.
const DISABLED_DISPLAY: &str = "mrtyper-backend-disabled";

/// Shown when the countdown ends and no target can be identified.
pub const NO_TARGET_MESSAGE: &str = "MrTyper could not find a focused target window. Click into the app you want to type into and try again. (Some minimal window managers don't report focus; enable an EWMH-compliant one.)";

static OWN_WINDOW_FOCUSED: AtomicBool = AtomicBool::new(false);

/// Called from the window event loop whenever MrTyper gains or loses focus.
pub fn set_own_window_focused(focused: bool) {
    OWN_WINDOW_FOCUSED.store(focused, Ordering::SeqCst);
}

fn is_wayland_session() -> bool {
    let wayland_display = std::env::var_os("WAYLAND_DISPLAY").is_some_and(|value| !value.is_empty());
    let session_type = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
    wayland_display || session_type.eq_ignore_ascii_case("wayland")
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

thread_local! {
    // One connection per typing session: the engine runs each session on its
    // own worker thread, and all keystrokes are sent from that thread.
    static KEYBOARD: RefCell<Option<Enigo>> = const { RefCell::new(None) };
}

fn connect(x11: bool, wayland: bool) -> Result<Enigo, NewConError> {
    let settings = Settings {
        x11_display: if x11 { None } else { Some(DISABLED_DISPLAY.into()) },
        wayland_display: if wayland { None } else { Some(DISABLED_DISPLAY.into()) },
        ..Settings::default()
    };
    Enigo::new(&settings)
}

/// Open the keyboard connection for this session before the countdown starts,
/// so a missing backend is reported up front instead of after the head start.
///
/// Returns a warning to show the user when MrTyper had to fall back to a
/// limited mode.
pub fn prepare() -> Result<Option<String>, String> {
    let (enigo, notice) = if is_wayland_session() {
        match connect(false, true) {
            Ok(enigo) => (enigo, None),
            Err(_) => match connect(true, false) {
                Ok(enigo) => (
                    enigo,
                    Some(
                        "This Wayland desktop doesn't allow virtual keyboards, so MrTyper can only type into X11 (XWayland) apps. Log into an X11 session for full support."
                            .to_string(),
                    ),
                ),
                Err(error) => return Err(no_backend_message(&error)),
            },
        }
    } else {
        match connect(true, false) {
            Ok(enigo) => (enigo, None),
            Err(error) => return Err(no_backend_message(&error)),
        }
    };

    KEYBOARD.with(|cell| *cell.borrow_mut() = Some(enigo));
    Ok(notice)
}

fn no_backend_message(error: &NewConError) -> String {
    format!(
        "MrTyper couldn't connect to your display server to send keystrokes ({error}). It needs an X11 session, or a Wayland compositor with virtual-keyboard support."
    )
}

fn with_keyboard(action: impl FnOnce(&mut Enigo) -> enigo::InputResult<()>) -> Result<(), String> {
    KEYBOARD.with(|cell| {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            drop(slot);
            prepare()?;
            slot = cell.borrow_mut();
        }
        let enigo = slot
            .as_mut()
            .ok_or_else(|| "The keyboard connection is not available.".to_string())?;
        action(enigo).map_err(|error| format!("The keystroke could not be sent ({error})."))
    })
}

pub fn send_char(character: char) -> Result<(), String> {
    match character {
        '\n' | '\r' => with_keyboard(|enigo| enigo.key(Key::Return, Direction::Click)),
        '\t' => with_keyboard(|enigo| enigo.key(Key::Tab, Direction::Click)),
        _ => {
            let mut buffer = [0u8; 4];
            let text: &str = character.encode_utf8(&mut buffer);
            with_keyboard(|enigo| enigo.text(text))
        }
    }
}

pub fn send_backspace() -> Result<(), String> {
    with_keyboard(|enigo| enigo.key(Key::Backspace, Direction::Click))
}

/// Apps read shortcuts from the key state, so modifiers go down one at a time
/// with a short gap, the way a hand presses them.
const COMBO_GAP: std::time::Duration = std::time::Duration::from_millis(8);

pub fn send_combo(combo: &KeyCombo) -> Result<(), String> {
    let key = match combo.key {
        ComboKey::Char(character) => Key::Unicode(character),
        ComboKey::Named(named) => named_key(named),
    };
    let mut modifiers = Vec::with_capacity(4);
    if combo.modifiers.ctrl {
        modifiers.push(Key::Control);
    }
    if combo.modifiers.alt {
        modifiers.push(Key::Alt);
    }
    if combo.modifiers.shift {
        modifiers.push(Key::Shift);
    }
    if combo.modifiers.meta {
        modifiers.push(Key::Meta);
    }

    with_keyboard(|enigo| {
        let mut pressed = Vec::with_capacity(modifiers.len());
        let mut result = Ok(());
        for &modifier in &modifiers {
            result = enigo.key(modifier, Direction::Press);
            if result.is_err() {
                break;
            }
            pressed.push(modifier);
            std::thread::sleep(COMBO_GAP);
        }
        if result.is_ok() {
            result = enigo.key(key, Direction::Click);
            std::thread::sleep(COMBO_GAP);
        }
        // Always let go of the modifiers, even after a failure, so a modifier
        // is never left held down in the user's session.
        for &modifier in pressed.iter().rev() {
            let _ = enigo.key(modifier, Direction::Release);
        }
        result
    })
}

fn named_key(key: NamedKey) -> Key {
    match key {
        NamedKey::Enter => Key::Return,
        NamedKey::Tab => Key::Tab,
        NamedKey::Backspace => Key::Backspace,
        NamedKey::Delete => Key::Delete,
        NamedKey::Home => Key::Home,
        NamedKey::End => Key::End,
        NamedKey::PageUp => Key::PageUp,
        NamedKey::PageDown => Key::PageDown,
        NamedKey::Up => Key::UpArrow,
        NamedKey::Down => Key::DownArrow,
        NamedKey::Left => Key::LeftArrow,
        NamedKey::Right => Key::RightArrow,
        NamedKey::Space => Key::Space,
        NamedKey::F(number) => match number {
            1 => Key::F1,
            2 => Key::F2,
            3 => Key::F3,
            4 => Key::F4,
            5 => Key::F5,
            6 => Key::F6,
            7 => Key::F7,
            8 => Key::F8,
            9 => Key::F9,
            10 => Key::F10,
            11 => Key::F11,
            _ => Key::F12,
        },
    }
}

// ---------------------------------------------------------------------------
// Focus
// ---------------------------------------------------------------------------

pub fn foreground_target() -> Option<FocusTarget> {
    if is_wayland_session() {
        let raw = if OWN_WINDOW_FOCUSED.load(Ordering::SeqCst) {
            WAYLAND_OWN_WINDOW
        } else {
            WAYLAND_ELSEWHERE
        };
        return Some(FocusTarget { raw });
    }
    x11_focus::active_window().map(|raw| FocusTarget { raw })
}

pub fn is_own_process(target: FocusTarget) -> bool {
    if target.raw == WAYLAND_OWN_WINDOW {
        return true;
    }
    if target.raw == WAYLAND_ELSEWHERE {
        return false;
    }
    OWN_WINDOW_FOCUSED.load(Ordering::SeqCst)
        || x11_focus::window_pid(target.raw) == Some(std::process::id())
}

mod x11_focus {
    use std::cell::RefCell;

    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{Atom, AtomEnum, ConnectionExt, Window};
    use x11rb::rust_connection::RustConnection;

    struct FocusConnection {
        connection: RustConnection,
        root: Window,
        net_active_window: Atom,
        net_wm_pid: Atom,
    }

    thread_local! {
        static CONNECTION: RefCell<Option<FocusConnection>> = const { RefCell::new(None) };
    }

    fn open() -> Option<FocusConnection> {
        let (connection, screen) = x11rb::connect(None).ok()?;
        let root = connection.setup().roots.get(screen)?.root;
        let intern = |name: &[u8]| -> Option<Atom> {
            Some(connection.intern_atom(false, name).ok()?.reply().ok()?.atom)
        };
        let net_active_window = intern(b"_NET_ACTIVE_WINDOW")?;
        let net_wm_pid = intern(b"_NET_WM_PID")?;
        Some(FocusConnection {
            connection,
            root,
            net_active_window,
            net_wm_pid,
        })
    }

    fn with_connection<T>(query: impl FnOnce(&FocusConnection) -> Option<T>) -> Option<T> {
        CONNECTION.with(|cell| {
            let mut slot = cell.borrow_mut();
            if slot.is_none() {
                *slot = open();
            }
            let result = query(slot.as_ref()?);
            if result.is_none() {
                // Drop a connection that stopped answering; reopen next time.
                *slot = None;
            }
            result
        })
    }

    fn first_u32(connection: &FocusConnection, window: Window, property: Atom, kind: AtomEnum) -> Option<u32> {
        let reply = connection
            .connection
            .get_property(false, window, property, kind, 0, 1)
            .ok()?
            .reply()
            .ok()?;
        let value = reply.value32()?.next();
        value
    }

    /// The window the window manager reports as focused, or `None` when the
    /// desktop itself has focus or no EWMH window manager is running.
    pub fn active_window() -> Option<u64> {
        with_connection(|connection| {
            let window = first_u32(connection, connection.root, connection.net_active_window, AtomEnum::WINDOW)?;
            (window != 0).then_some(u64::from(window))
        })
    }

    pub fn window_pid(window: u64) -> Option<u32> {
        let window = u32::try_from(window).ok()?;
        with_connection(|connection| first_u32(connection, window, connection.net_wm_pid, AtomEnum::CARDINAL))
    }
}
