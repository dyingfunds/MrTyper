//! Windows keyboard injection and focus detection.
//!
//! Text is injected as UTF-16 code units through `SendInput` with
//! `KEYEVENTF_UNICODE`, which bypasses the active keyboard layout and lets
//! MrTyper type accents, CJK, surrogate-pair emoji, and RTL scripts.
//!
//! Every platform's input module exposes the same API, so engine.rs is
//! identical across the Windows, macOS and Linux apps:
//! `prepare`, `send_char`, `send_backspace`, `send_combo`,
//! `foreground_target`, `is_own_process`, `set_own_window_focused` and
//! `NO_TARGET_MESSAGE`.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FocusTarget {
    raw: isize,
}

/// Shown when the countdown ends and no target can be identified.
pub const NO_TARGET_MESSAGE: &str =
    "Windows could not find a focused target window. Click into the app you want to type into and try again.";

/// `SendInput` needs no connection or permission, so there is nothing to
/// open before a session. Kept for API parity with the macOS and Linux apps.
pub fn prepare() -> Result<Option<String>, String> {
    Ok(None)
}

/// Windows reads the foreground window directly, so MrTyper's own focus does
/// not need tracking. Kept for API parity with the macOS and Linux apps.
pub fn set_own_window_focused(_focused: bool) {}

#[cfg(target_os = "windows")]
mod platform {
    use std::mem::size_of;
    use std::thread;
    use std::time::Duration;

    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        MapVirtualKeyW, SendInput, VkKeyScanW, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
        KEYBD_EVENT_FLAGS, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
        MAPVK_VK_TO_VSC, VIRTUAL_KEY, VK_BACK, VK_CONTROL, VK_DELETE, VK_DOWN, VK_END, VK_F1,
        VK_HOME, VK_LEFT, VK_LWIN, VK_MENU, VK_NEXT, VK_PRIOR, VK_RETURN, VK_RIGHT, VK_SHIFT,
        VK_SPACE, VK_TAB, VK_UP,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };

    use super::FocusTarget;
    use crate::script::{ComboKey, KeyCombo, NamedKey};

    const BLOCKED_MESSAGE: &str =
        "Windows blocked the keystroke. Try running MrTyper at the same privilege level as the target app.";

    /// Apps read shortcuts from the key state, so modifiers go down one at a
    /// time with a short gap, the way a hand presses them.
    const COMBO_GAP: Duration = Duration::from_millis(8);

    pub fn foreground_target() -> Option<FocusTarget> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.is_null() {
            None
        } else {
            Some(FocusTarget {
                raw: hwnd as isize,
            })
        }
    }

    pub fn is_own_process(target: FocusTarget) -> bool {
        let hwnd = target.raw as HWND;
        if hwnd.is_null() {
            return false;
        }
        let mut process_id = 0u32;
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut process_id);
        }
        process_id == std::process::id()
    }

    pub fn send_char(character: char) -> Result<(), String> {
        match character {
            '\n' | '\r' => send_virtual_key(VK_RETURN),
            '\t' => send_virtual_key(VK_TAB),
            _ => {
                let mut units = [0u16; 2];
                for unit in character.encode_utf16(&mut units) {
                    send_unicode_unit(*unit, false)?;
                    send_unicode_unit(*unit, true)?;
                }
                Ok(())
            }
        }
    }

    pub fn send_backspace() -> Result<(), String> {
        send_virtual_key(VK_BACK)
    }

    pub fn send_combo(combo: &KeyCombo) -> Result<(), String> {
        let key = match combo.key {
            ComboKey::Char(character) => virtual_key_for(character)?,
            ComboKey::Named(named) => named_virtual_key(named),
        };
        let mut modifiers = Vec::with_capacity(4);
        if combo.modifiers.ctrl {
            modifiers.push(VK_CONTROL);
        }
        if combo.modifiers.alt {
            modifiers.push(VK_MENU);
        }
        if combo.modifiers.shift {
            modifiers.push(VK_SHIFT);
        }
        if combo.modifiers.meta {
            modifiers.push(VK_LWIN);
        }

        let mut pressed = Vec::with_capacity(modifiers.len());
        let mut result = Ok(());
        for &modifier in &modifiers {
            result = send_inputs(&[scan_input(modifier, false)]);
            if result.is_err() {
                break;
            }
            pressed.push(modifier);
            thread::sleep(COMBO_GAP);
        }
        if result.is_ok() {
            result = send_inputs(&[scan_input(key, false), scan_input(key, true)]);
            thread::sleep(COMBO_GAP);
        }
        // Always let go of the modifiers, even after a failure, so a Ctrl
        // is never left held down in the user's session.
        for &modifier in pressed.iter().rev() {
            let _ = send_inputs(&[scan_input(modifier, true)]);
        }
        result
    }

    /// The key that types `character` on the active keyboard layout.
    fn virtual_key_for(character: char) -> Result<VIRTUAL_KEY, String> {
        if character.is_ascii_alphanumeric() {
            return Ok(character.to_ascii_uppercase() as VIRTUAL_KEY);
        }
        let mut units = [0u16; 2];
        let encoded = character.encode_utf16(&mut units);
        if encoded.len() == 1 {
            let result = unsafe { VkKeyScanW(encoded[0]) };
            if result != -1 {
                return Ok((result as u16) & 0xff);
            }
        }
        Err(format!(
            "The shortcut key “{character}” isn't on this keyboard layout."
        ))
    }

    fn named_virtual_key(key: NamedKey) -> VIRTUAL_KEY {
        match key {
            NamedKey::Enter => VK_RETURN,
            NamedKey::Tab => VK_TAB,
            NamedKey::Backspace => VK_BACK,
            NamedKey::Delete => VK_DELETE,
            NamedKey::Home => VK_HOME,
            NamedKey::End => VK_END,
            NamedKey::PageUp => VK_PRIOR,
            NamedKey::PageDown => VK_NEXT,
            NamedKey::Up => VK_UP,
            NamedKey::Down => VK_DOWN,
            NamedKey::Left => VK_LEFT,
            NamedKey::Right => VK_RIGHT,
            NamedKey::Space => VK_SPACE,
            NamedKey::F(number) => VK_F1 + VIRTUAL_KEY::from(number.clamp(1, 12)) - 1,
        }
    }

    fn is_extended(key: VIRTUAL_KEY) -> bool {
        matches!(
            key,
            VK_DELETE | VK_HOME | VK_END | VK_PRIOR | VK_NEXT | VK_UP | VK_DOWN | VK_LEFT
                | VK_RIGHT | VK_LWIN
        )
    }

    /// A key event carrying both the virtual key and its scan code, so apps
    /// that read either one (browsers read both) see a real key press.
    fn scan_input(key: VIRTUAL_KEY, key_up: bool) -> INPUT {
        let scan = unsafe { MapVirtualKeyW(u32::from(key), MAPVK_VK_TO_VSC) } as u16;
        let mut flags: KEYBD_EVENT_FLAGS = 0;
        if key_up {
            flags |= KEYEVENTF_KEYUP;
        }
        if is_extended(key) {
            flags |= KEYEVENTF_EXTENDEDKEY;
        }
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: key,
                    wScan: scan,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn send_inputs(inputs: &[INPUT]) -> Result<(), String> {
        let sent = unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                size_of::<INPUT>() as i32,
            )
        };
        if sent as usize != inputs.len() {
            return Err(BLOCKED_MESSAGE.into());
        }
        Ok(())
    }

    fn send_unicode_unit(unit: u16, key_up: bool) -> Result<(), String> {
        let mut flags: KEYBD_EVENT_FLAGS = KEYEVENTF_UNICODE;
        if key_up {
            flags |= KEYEVENTF_KEYUP;
        }

        let input = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: 0,
                    wScan: unit,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };

        let sent = unsafe { SendInput(1, &input, size_of::<INPUT>() as i32) };
        if sent != 1 {
            return Err(
                "Windows blocked the keystroke. Try running MrTyper at the same privilege level as the target app."
                    .into(),
            );
        }
        Ok(())
    }

    fn send_virtual_key(key: VIRTUAL_KEY) -> Result<(), String> {
        let down = key_input(key, false);
        let up = key_input(key, true);
        let sent = unsafe { SendInput(2, [down, up].as_ptr(), size_of::<INPUT>() as i32) };
        if sent != 2 {
            return Err(
                "Windows blocked the keystroke. Try running MrTyper at the same privilege level as the target app."
                    .into(),
            );
        }
        Ok(())
    }

    fn key_input(key: VIRTUAL_KEY, key_up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: key,
                    wScan: 0,
                    dwFlags: if key_up { KEYEVENTF_KEYUP } else { 0 },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::FocusTarget;

    pub fn foreground_target() -> Option<FocusTarget> {
        None
    }

    pub fn is_own_process(_target: FocusTarget) -> bool {
        false
    }

    pub fn send_char(_character: char) -> Result<(), String> {
        Err("MrTyper's keystroke engine currently supports Windows only.".into())
    }

    pub fn send_backspace() -> Result<(), String> {
        Err("MrTyper's keystroke engine currently supports Windows only.".into())
    }

    pub fn send_combo(_combo: &crate::script::KeyCombo) -> Result<(), String> {
        Err("MrTyper's keystroke engine currently supports Windows only.".into())
    }
}

pub use platform::{foreground_target, is_own_process, send_backspace, send_char, send_combo};
