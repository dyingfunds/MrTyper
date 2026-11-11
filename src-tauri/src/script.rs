//! Script parsing: plain characters plus `{{…}}` commands.
//!
//! A script is typed character by character, except for commands written in
//! double braces. They send keyboard shortcuts, mostly the Google Docs
//! formatting shortcuts, or hold a pause:
//!
//! * named commands such as `{{bold}}`, `{{h1}}` or `{{bigger}}`;
//! * raw shortcuts such as `{{ctrl+shift+k}}` or `{{mod+b}}`, where `mod` is
//!   Command on macOS and Ctrl elsewhere, and lone keys such as `{{enter}}`;
//! * pauses such as `{{pause 2}}`, `{{pause 1.5s}}` or `{{wait 400ms}}`.
//!
//! Anything in braces that isn't a known command is typed literally, so normal
//! text never needs escaping.
//!
//! The rules are mirrored by `src/lib/scriptCommands.ts` for the UI's counts
//! and command menu. Keep the two in step.

/// The longest text between the braces that can still be a command.
const MAX_COMMAND_LEN: usize = 48;

/// Longest pause a single command may ask for.
pub const MAX_PAUSE_MS: u64 = 60_000;

/// Command (⌘) is the primary shortcut modifier on macOS; Ctrl elsewhere.
const PRIMARY_IS_META: bool = cfg!(target_os = "macos");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NamedKey {
    Enter,
    Tab,
    Backspace,
    Delete,
    Home,
    End,
    PageUp,
    PageDown,
    Up,
    Down,
    Left,
    Right,
    Space,
    /// F1–F12.
    F(u8),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComboKey {
    /// A key identified by the character it types on a US layout, lowercase.
    Char(char),
    Named(NamedKey),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Modifiers {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    /// Command on macOS, the Windows key on Windows, Super on Linux.
    pub meta: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeyCombo {
    pub modifiers: Modifiers,
    pub key: ComboKey,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Action {
    Char(char),
    Combo(KeyCombo),
    /// Hold still for this many milliseconds.
    Pause(u64),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Step {
    pub action: Action,
    /// How many characters (Unicode code points) of the script this step
    /// covers. A typed character covers one; a command covers its full text.
    pub source_len: usize,
}

/// Split a script into steps. With `commands` off, every character is typed
/// literally, braces included.
pub fn parse(text: &str, commands: bool) -> Vec<Step> {
    let characters: Vec<char> = text.chars().collect();
    let mut steps = Vec::with_capacity(characters.len());
    let mut index = 0;

    while index < characters.len() {
        if commands {
            if let Some((action, length)) = command_at(&characters, index) {
                steps.push(Step {
                    action,
                    source_len: length,
                });
                index += length;
                continue;
            }
        }
        steps.push(Step {
            action: Action::Char(characters[index]),
            source_len: 1,
        });
        index += 1;
    }

    steps
}

/// A command starting at `start`, and how many characters it spans.
fn command_at(characters: &[char], start: usize) -> Option<(Action, usize)> {
    if characters.get(start) != Some(&'{') || characters.get(start + 1) != Some(&'{') {
        return None;
    }
    let body_start = start + 2;
    let mut end = body_start;
    while end + 1 < characters.len() && end - body_start <= MAX_COMMAND_LEN {
        match characters[end] {
            '\n' | '{' => return None,
            '}' if characters[end + 1] == '}' => {
                let body: String = characters[body_start..end].iter().collect();
                return resolve(&body).map(|action| (action, end + 2 - start));
            }
            _ => end += 1,
        }
    }
    None
}

/// Turn the text between the braces into an action, if it is a command.
pub fn resolve(body: &str) -> Option<Action> {
    let body = body.trim().to_lowercase();
    if body.is_empty() {
        return None;
    }
    if let Some(pause) = parse_pause(&body) {
        return Some(Action::Pause(pause));
    }
    let compact: String = body
        .chars()
        .filter(|character| !matches!(character, ' ' | '-' | '_'))
        .collect();
    if let Some(combo) = named_command(&compact) {
        return Some(Action::Combo(combo));
    }
    parse_combo(&body).map(Action::Combo)
}

fn parse_pause(body: &str) -> Option<u64> {
    let rest = body
        .strip_prefix("pause")
        .or_else(|| body.strip_prefix("wait"))?
        .trim();
    let (number, scale) = if let Some(value) = rest.strip_suffix("ms") {
        (value, 1.0)
    } else if let Some(value) = ["seconds", "second", "secs", "sec", "s"]
        .iter()
        .find_map(|unit| rest.strip_suffix(unit))
    {
        (value, 1000.0)
    } else {
        (rest, 1000.0)
    };
    let number = number.trim();
    if !number.chars().all(|character| character.is_ascii_digit() || character == '.') {
        return None;
    }
    let value: f64 = number.parse().ok()?;
    if !value.is_finite() || value <= 0.0 {
        return None;
    }
    let milliseconds = (value * scale).round();
    (milliseconds >= 1.0 && milliseconds <= MAX_PAUSE_MS as f64).then_some(milliseconds as u64)
}

fn primary(shift: bool, alt: bool, key: ComboKey) -> KeyCombo {
    KeyCombo {
        modifiers: Modifiers {
            ctrl: !PRIMARY_IS_META,
            meta: PRIMARY_IS_META,
            shift,
            alt,
        },
        key,
    }
}

fn character(value: char) -> ComboKey {
    ComboKey::Char(value)
}

/// The Google Docs shortcuts, by name. Docs uses Command on macOS where it
/// uses Ctrl elsewhere, and Option where it uses Alt.
fn named_command(name: &str) -> Option<KeyCombo> {
    let combo = match name {
        "bold" | "b" => primary(false, false, character('b')),
        "italic" | "i" => primary(false, false, character('i')),
        "underline" | "u" => primary(false, false, character('u')),
        "strikethrough" | "strike" => {
            if PRIMARY_IS_META {
                primary(true, false, character('x'))
            } else {
                KeyCombo {
                    modifiers: Modifiers {
                        alt: true,
                        shift: true,
                        ..Modifiers::default()
                    },
                    key: character('5'),
                }
            }
        }
        "superscript" | "sup" => primary(false, false, character('.')),
        "subscript" | "sub" => primary(false, false, character(',')),
        "bigger" | "larger" | "sizeup" | "fontup" | "fontsizeup" | "increasefontsize" => {
            primary(true, false, character('.'))
        }
        "smaller" | "sizedown" | "fontdown" | "fontsizedown" | "decreasefontsize" => {
            primary(true, false, character(','))
        }
        "clear" | "clearformatting" | "plain" => primary(false, false, character('\\')),
        "normal" | "normaltext" | "body" => primary(false, true, character('0')),
        "h1" | "heading1" => primary(false, true, character('1')),
        "h2" | "heading2" => primary(false, true, character('2')),
        "h3" | "heading3" => primary(false, true, character('3')),
        "h4" | "heading4" => primary(false, true, character('4')),
        "h5" | "heading5" => primary(false, true, character('5')),
        "h6" | "heading6" => primary(false, true, character('6')),
        "numbers" | "numbered" | "numberedlist" | "numberlist" => {
            primary(true, false, character('7'))
        }
        "bullets" | "bulleted" | "bulletlist" | "bulletedlist" => {
            primary(true, false, character('8'))
        }
        "checklist" | "checkbox" => primary(true, false, character('9')),
        "alignleft" => primary(true, false, character('l')),
        "center" | "aligncenter" => primary(true, false, character('e')),
        "alignright" => primary(true, false, character('r')),
        "justify" | "alignjustify" => primary(true, false, character('j')),
        "indent" => primary(false, false, character(']')),
        "outdent" | "dedent" | "unindent" => primary(false, false, character('[')),
        "pagebreak" => primary(false, false, ComboKey::Named(NamedKey::Enter)),
        "undo" => primary(false, false, character('z')),
        "redo" => {
            if PRIMARY_IS_META {
                primary(true, false, character('z'))
            } else {
                primary(false, false, character('y'))
            }
        }
        _ => return None,
    };
    Some(combo)
}

fn named_key(name: &str) -> Option<NamedKey> {
    let key = match name {
        "enter" | "return" => NamedKey::Enter,
        "tab" => NamedKey::Tab,
        "backspace" => NamedKey::Backspace,
        "delete" | "del" => NamedKey::Delete,
        "home" => NamedKey::Home,
        "end" => NamedKey::End,
        "pageup" | "pgup" => NamedKey::PageUp,
        "pagedown" | "pgdn" => NamedKey::PageDown,
        "up" => NamedKey::Up,
        "down" => NamedKey::Down,
        "left" => NamedKey::Left,
        "right" => NamedKey::Right,
        "space" => NamedKey::Space,
        _ => {
            let number: u8 = name.strip_prefix('f')?.parse().ok()?;
            if (1..=12).contains(&number) {
                NamedKey::F(number)
            } else {
                return None;
            }
        }
    };
    Some(key)
}

/// `ctrl+shift+k`, `mod+b`, `alt+5` or a lone named key such as `enter`.
/// Escape is never accepted: it is MrTyper's emergency stop.
fn parse_combo(body: &str) -> Option<KeyCombo> {
    let parts: Vec<&str> = body.split('+').map(str::trim).collect();
    let (key_part, modifier_parts) = parts.split_last()?;
    let mut modifiers = Modifiers::default();

    for part in modifier_parts {
        match *part {
            "ctrl" | "control" => modifiers.ctrl = true,
            "alt" | "option" | "opt" => modifiers.alt = true,
            "shift" => modifiers.shift = true,
            "cmd" | "command" | "meta" | "super" | "win" => modifiers.meta = true,
            "mod" | "primary" | "cmdorctrl" => {
                if PRIMARY_IS_META {
                    modifiers.meta = true;
                } else {
                    modifiers.ctrl = true;
                }
            }
            _ => return None,
        }
    }

    let has_modifier = modifiers != Modifiers::default();
    let key = if let Some(named) = named_key(key_part) {
        ComboKey::Named(named)
    } else {
        let mut characters = key_part.chars();
        let value = characters.next()?;
        if characters.next().is_some() || value.is_whitespace() || !has_modifier {
            return None;
        }
        ComboKey::Char(value)
    };

    Some(KeyCombo { modifiers, key })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn actions(text: &str) -> Vec<Action> {
        parse(text, true).into_iter().map(|step| step.action).collect()
    }

    #[test]
    fn plain_text_is_one_step_per_character() {
        let steps = parse("héllo 👋", true);
        assert_eq!(steps.len(), 7);
        assert!(steps.iter().all(|step| step.source_len == 1));
    }

    #[test]
    fn named_commands_become_shortcuts_and_cover_their_text() {
        let steps = parse("a{{bold}}b", true);
        assert_eq!(steps.len(), 3);
        assert_eq!(steps[1].source_len, "{{bold}}".chars().count());
        let Action::Combo(combo) = steps[1].action else {
            panic!("expected a shortcut");
        };
        assert_eq!(combo.key, ComboKey::Char('b'));
        assert_eq!(combo.modifiers.ctrl, !PRIMARY_IS_META);
        assert_eq!(combo.modifiers.meta, PRIMARY_IS_META);
        let covered: usize = steps.iter().map(|step| step.source_len).sum();
        assert_eq!(covered, "a{{bold}}b".chars().count());
    }

    #[test]
    fn names_ignore_case_spaces_and_dashes() {
        assert_eq!(resolve(" Font Size Up "), resolve("bigger"));
        assert_eq!(resolve("heading-2"), resolve("h2"));
        assert_eq!(resolve("BOLD"), resolve("bold"));
    }

    #[test]
    fn raw_shortcuts_and_lone_keys_parse() {
        let Some(Action::Combo(combo)) = resolve("ctrl+shift+k") else {
            panic!("expected a shortcut");
        };
        assert!(combo.modifiers.ctrl && combo.modifiers.shift);
        assert_eq!(combo.key, ComboKey::Char('k'));
        assert_eq!(
            resolve("enter"),
            Some(Action::Combo(KeyCombo {
                modifiers: Modifiers::default(),
                key: ComboKey::Named(NamedKey::Enter),
            }))
        );
        assert!(matches!(resolve("alt+f4"), Some(Action::Combo(_))));
    }

    #[test]
    fn pauses_accept_seconds_and_milliseconds() {
        assert_eq!(resolve("pause 2"), Some(Action::Pause(2000)));
        assert_eq!(resolve("pause 1.5s"), Some(Action::Pause(1500)));
        assert_eq!(resolve("wait 400ms"), Some(Action::Pause(400)));
        assert_eq!(resolve("pause 0"), None);
        assert_eq!(resolve("pause 61"), None);
        assert_eq!(resolve("pause soon"), None);
    }

    #[test]
    fn unknown_or_unsafe_braces_are_typed_literally() {
        for text in [
            "{{hello}}",
            "{{escape}}",
            "{{ctrl+escape}}",
            "{{k}}",
            "{{}}",
            "{{bold",
            "{{bo\nld}}",
            "{single}",
        ] {
            assert!(
                actions(text).iter().all(|action| matches!(action, Action::Char(_))),
                "{text:?} should be typed as text"
            );
        }
    }

    #[test]
    fn a_stray_brace_before_a_command_is_typed() {
        let steps = parse("{{{bold}}", true);
        assert_eq!(steps[0].action, Action::Char('{'));
        assert!(matches!(steps[1].action, Action::Combo(_)));
        assert_eq!(steps.len(), 2);
    }

    #[test]
    fn commands_off_types_everything() {
        let steps = parse("{{bold}}", false);
        assert_eq!(steps.len(), 8);
        assert!(steps.iter().all(|step| matches!(step.action, Action::Char(_))));
    }
}
