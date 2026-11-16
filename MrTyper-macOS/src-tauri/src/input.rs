//! macOS keyboard injection and focus detection.
//!
//! Keystrokes are posted as Quartz (CGEvent) keyboard events through `enigo`.
//! Characters are attached with `CGEventKeyboardSetUnicodeString`, so text is
//! independent of the active keyboard layout and accents, CJK, and emoji all
//! arrive intact.
//!
//! macOS only lets apps post keyboard events after the user grants them
//! Accessibility access. `prepare` checks that before the countdown starts and
//! opens the system prompt if it is missing.
//!
//! The focus target is the frontmost *application* (by process id). macOS
//! does not reveal other apps' windows without Screen Recording permission,
//! so the focus guard stops a run when you switch apps, not when you switch
//! windows inside the same app.

use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};

use enigo::{Direction, Enigo, Key, Keyboard, NewConError, Settings};

use crate::script::{ComboKey, KeyCombo, NamedKey};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FocusTarget {
    pid: i32,
}

/// Shown when the countdown ends and no target can be identified.
pub const NO_TARGET_MESSAGE: &str = "macOS did not report a frontmost app. Click into the app you want to type into and try again.";

static OWN_WINDOW_FOCUSED: AtomicBool = AtomicBool::new(false);

/// Called from the window event loop whenever MrTyper gains or loses focus.
pub fn set_own_window_focused(focused: bool) {
    OWN_WINDOW_FOCUSED.store(focused, Ordering::SeqCst);
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

thread_local! {
    // CGEvent sources are not Send; each typing session runs on its own
    // worker thread and owns its connection.
    static KEYBOARD: RefCell<Option<Enigo>> = const { RefCell::new(None) };
}

const PERMISSION_MESSAGE: &str = "MrTyper needs Accessibility access to type into other apps. Open System Settings → Privacy & Security → Accessibility, turn MrTyper on, then start again.";

fn connect() -> Result<Enigo, String> {
    let settings = Settings {
        // Shows the system "MrTyper would like to control this computer" prompt.
        open_prompt_to_get_permissions: true,
        // A physically held Shift or Caps Lock must not change the typed text.
        independent_of_keyboard_state: true,
        ..Settings::default()
    };
    Enigo::new(&settings).map_err(|error| match error {
        NewConError::NoPermission => PERMISSION_MESSAGE.to_string(),
        other => format!("MrTyper couldn't create a keyboard event source ({other})."),
    })
}

/// Open the keyboard connection before the countdown starts, so a missing
/// Accessibility permission is reported before the user switches apps.
pub fn prepare() -> Result<Option<String>, String> {
    let enigo = connect()?;
    KEYBOARD.with(|cell| *cell.borrow_mut() = Some(enigo));
    Ok(None)
}

fn with_keyboard(action: impl FnOnce(&mut Enigo) -> enigo::InputResult<()>) -> Result<(), String> {
    KEYBOARD.with(|cell| {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            *slot = Some(connect()?);
        }
        let enigo = slot
            .as_mut()
            .ok_or_else(|| "The keyboard connection is not available.".to_string())?;
        action(enigo).map_err(|error| format!("macOS refused the keystroke ({error})."))
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

/// Shortcut keys must be sent from the main thread. For a character key
/// (`{{bold}}` is Cmd+B), enigo looks up its key code in the current keyboard
/// layout with the Text Input Source API, and macOS 14+ kills the process when
/// that API is called off the main queue. Plain text avoids the lookup
/// because it attaches the character as a Unicode string instead.
pub fn send_combo(combo: &KeyCombo) -> Result<(), String> {
    let combo = *combo;
    main_queue::run_sync(move || send_combo_here(&combo))
}

fn send_combo_here(combo: &KeyCombo) -> Result<(), String> {
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
    use objc2::rc::autoreleasepool;
    use objc2_app_kit::NSWorkspace;

    autoreleasepool(|_| {
        let workspace = NSWorkspace::sharedWorkspace();
        let application = workspace.frontmostApplication()?;
        let pid = application.processIdentifier();
        (pid > 0).then_some(FocusTarget { pid })
    })
}

pub fn is_own_process(target: FocusTarget) -> bool {
    OWN_WINDOW_FOCUSED.load(Ordering::SeqCst) || target.pid as u32 == std::process::id()
}

// ---------------------------------------------------------------------------
// Main-thread dispatch
// ---------------------------------------------------------------------------

/// Runs work synchronously on the main dispatch queue, which AppKit drives
/// while the event loop is running. The typing thread blocks until the work
/// is done, so keystrokes keep their order. Nothing on the main thread waits
/// on the typing thread (stop and pause only set flags), so this can't deadlock.
mod main_queue {
    use std::ffi::c_void;

    #[repr(C)]
    struct DispatchQueue {
        _private: [u8; 0],
    }

    // libdispatch and pthread are part of libSystem, which every macOS binary links.
    unsafe extern "C" {
        // `dispatch_get_main_queue()` is a C macro for `&_dispatch_main_q`.
        static _dispatch_main_q: DispatchQueue;
        fn dispatch_sync_f(
            queue: *const DispatchQueue,
            context: *mut c_void,
            work: unsafe extern "C" fn(*mut c_void),
        );
        fn pthread_main_np() -> i32;
    }

    struct Job<F, R> {
        work: Option<F>,
        result: Option<R>,
    }

    unsafe extern "C" fn trampoline<F: FnOnce() -> R, R>(context: *mut c_void) {
        // SAFETY: `context` is the `Job` that `run_sync` keeps alive on its
        // stack until `dispatch_sync_f` returns.
        let job = unsafe { &mut *context.cast::<Job<F, R>>() };
        if let Some(work) = job.work.take() {
            job.result = Some(work());
        }
    }

    pub fn run_sync<F, R>(work: F) -> R
    where
        F: FnOnce() -> R + Send,
        R: Send,
    {
        // dispatch_sync onto the main queue from the main thread deadlocks.
        if unsafe { pthread_main_np() } != 0 {
            return work();
        }
        let mut job = Job {
            work: Some(work),
            result: None,
        };
        // SAFETY: `dispatch_sync_f` runs the trampoline exactly once and
        // returns only after it finishes, so `job` outlives every access.
        unsafe {
            dispatch_sync_f(
                &raw const _dispatch_main_q,
                (&raw mut job).cast::<c_void>(),
                trampoline::<F, R>,
            );
        }
        job.result
            .expect("the main queue finished the job without running it")
    }
}
