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
