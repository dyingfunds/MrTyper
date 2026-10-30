//! Windows keyboard injection and focus detection.
//!
//! Text is injected as UTF-16 code units through `SendInput` with
//! `KEYEVENTF_UNICODE`, which bypasses the active keyboard layout and lets
//! MrTyper type accents, CJK, surrogate-pair emoji, and RTL scripts.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FocusTarget {
    raw: isize,
}

#[cfg(target_os = "windows")]
mod platform {
    use std::mem::size_of;

    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, VIRTUAL_KEY, VK_BACK, VK_RETURN, VK_TAB,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };

    use super::FocusTarget;

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
}

pub use platform::{foreground_target, is_own_process, send_backspace, send_char};
