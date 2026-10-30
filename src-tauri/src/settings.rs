use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri_plugin_global_shortcut::Shortcut;

pub const MIN_WPM: f64 = 10.0;
pub const MAX_WPM: f64 = 300.0;
pub const MIN_START_DELAY: u32 = 1;
pub const MAX_START_DELAY: u32 = 30;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TypingSettings {
    pub start_delay_secs: u32,
    pub min_wpm: f64,
    pub max_wpm: f64,
    pub randomness: f64,
    pub punctuation_enabled: bool,
    pub punctuation_factor: f64,
    pub line_break_enabled: bool,
    pub line_break_extra_ms: u64,
    pub thinking_enabled: bool,
    pub thinking_every_chars: u32,
    pub thinking_pause_max_ms: u64,
    pub burst_enabled: bool,
    pub burst_intensity: f64,
    pub typos_enabled: bool,
    pub typo_chance: f64,
    pub fatigue_enabled: bool,
    pub fatigue_drift: f64,
}

impl Default for TypingSettings {
    fn default() -> Self {
        Self {
            start_delay_secs: 5,
            min_wpm: 55.0,
            max_wpm: 105.0,
            randomness: 62.0,
            punctuation_enabled: true,
            punctuation_factor: 2.4,
            line_break_enabled: true,
            line_break_extra_ms: 380,
            thinking_enabled: true,
            thinking_every_chars: 95,
            thinking_pause_max_ms: 1_400,
            burst_enabled: true,
            burst_intensity: 38.0,
            typos_enabled: true,
            typo_chance: 2.5,
            fatigue_enabled: false,
            fatigue_drift: 18.0,
        }
    }
}

impl TypingSettings {
    pub fn normalized(mut self) -> Self {
        let defaults = TypingSettings::default();

        self.start_delay_secs = self
            .start_delay_secs
            .clamp(MIN_START_DELAY, MAX_START_DELAY);

        let min_wpm = finite(self.min_wpm, defaults.min_wpm)
            .round()
            .clamp(MIN_WPM, MAX_WPM);
        let max_wpm = finite(self.max_wpm, defaults.max_wpm)
            .round()
            .clamp(min_wpm, MAX_WPM);
        self.min_wpm = min_wpm;
        self.max_wpm = max_wpm;

        self.randomness = finite(self.randomness, defaults.randomness)
            .round()
            .clamp(0.0, 100.0);
        self.punctuation_factor = round1(finite(
            self.punctuation_factor,
            defaults.punctuation_factor,
        ))
        .clamp(1.0, 4.0);
        self.line_break_extra_ms = self.line_break_extra_ms.clamp(80, 1_500);
        self.thinking_every_chars = self.thinking_every_chars.clamp(20, 400);
        self.thinking_pause_max_ms = self.thinking_pause_max_ms.clamp(300, 5_000);
        self.burst_intensity = finite(self.burst_intensity, defaults.burst_intensity)
            .round()
            .clamp(10.0, 100.0);
        self.typo_chance = round1(finite(self.typo_chance, defaults.typo_chance))
            .clamp(0.5, 15.0);
        self.fatigue_drift = finite(self.fatigue_drift, defaults.fatigue_drift)
            .round()
            .clamp(0.0, 40.0);

        self
    }

}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            typing: TypingSettings::default(),
            theme: "system".into(),
            always_on_top: false,
            stop_on_esc: true,
            stop_on_focus_loss: true,
            hotkey_start: "F8".into(),
            hotkey_pause: "F9".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub typing: TypingSettings,
    pub theme: String,
    pub always_on_top: bool,
    pub stop_on_esc: bool,
    pub stop_on_focus_loss: bool,
    pub hotkey_start: String,
    pub hotkey_pause: String,
}

impl AppSettings {
    pub fn normalized(mut self) -> Self {
        let defaults = AppSettings::default();
        self.typing = self.typing.normalized();

        self.theme = match self.theme.as_str() {
            "light" => "light",
            "dark" => "dark",
            _ => "system",
        }
        .into();

        self.hotkey_start = clean_hotkey(&self.hotkey_start, &defaults.hotkey_start);
        self.hotkey_pause = clean_hotkey(&self.hotkey_pause, &defaults.hotkey_pause);

        self
    }

    pub fn validate_hotkeys(&self) -> Result<(), String> {
        let start = parse_hotkey(&self.hotkey_start)?;
        let pause = parse_hotkey(&self.hotkey_pause)?;
        let escape = Shortcut::from_str("Escape")
            .map_err(|error| format!("Could not initialize the Escape safety key: {error}"))?;

        if start.id() == pause.id() {
            return Err("Start and pause must use different shortcuts.".into());
        }
        if start.id() == escape.id() || pause.id() == escape.id() {
            return Err(
                "Escape is reserved for the emergency stop and cannot be a session shortcut."
                    .into(),
            );
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub typing: TypingSettings,
    pub updated_at: u64,
}

pub fn default_presets() -> Vec<Preset> {
    let now = now_millis();
    vec![
        Preset {
            id: "starter-1".into(),
            name: "Fast & clean".into(),
            typing: TypingSettings {
                start_delay_secs: 3,
                min_wpm: 150.0,
                max_wpm: 210.0,
                randomness: 42.0,
                punctuation_factor: 1.6,
                line_break_extra_ms: 180,
                thinking_enabled: false,
                thinking_every_chars: 140,
                thinking_pause_max_ms: 700,
                burst_enabled: true,
                burst_intensity: 28.0,
                typos_enabled: false,
                typo_chance: 0.5,
                fatigue_enabled: false,
                fatigue_drift: 8.0,
                ..TypingSettings::default()
            },
            updated_at: now.saturating_sub(3 * 86_400_000),
        },
        Preset {
            id: "starter-2".into(),
            name: "Careful".into(),
            typing: TypingSettings {
                start_delay_secs: 7,
                min_wpm: 45.0,
                max_wpm: 72.0,
                randomness: 54.0,
                punctuation_factor: 3.2,
                line_break_extra_ms: 680,
                thinking_enabled: true,
                thinking_every_chars: 62,
                thinking_pause_max_ms: 2_400,
                burst_enabled: false,
                burst_intensity: 22.0,
                typos_enabled: false,
                typo_chance: 0.5,
                fatigue_enabled: true,
                fatigue_drift: 12.0,
                ..TypingSettings::default()
            },
            updated_at: now.saturating_sub(2 * 86_400_000),
        },
        Preset {
            id: "starter-3".into(),
            name: "Sloppy".into(),
            typing: TypingSettings {
                start_delay_secs: 5,
                min_wpm: 62.0,
                max_wpm: 98.0,
                randomness: 92.0,
                punctuation_factor: 2.1,
                line_break_extra_ms: 320,
                thinking_enabled: true,
                thinking_every_chars: 54,
                thinking_pause_max_ms: 960,
                burst_enabled: true,
                burst_intensity: 58.0,
                typos_enabled: true,
                typo_chance: 8.5,
                fatigue_enabled: true,
                fatigue_drift: 24.0,
                ..TypingSettings::default()
            },
            updated_at: now.saturating_sub(86_400_000),
        },
    ]
}

pub fn parse_hotkey(value: &str) -> Result<Shortcut, String> {
    Shortcut::from_str(value.trim())
        .map_err(|error| format!("“{value}” is not a valid shortcut: {error}"))
}

pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn clean_hotkey(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn finite(value: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value
    } else {
        fallback
    }
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_inside_supported_ranges() {
        let settings = TypingSettings::default().normalized();
        assert!((MIN_START_DELAY..=MAX_START_DELAY).contains(&settings.start_delay_secs));
        assert!(settings.min_wpm >= MIN_WPM);
        assert!(settings.max_wpm <= MAX_WPM);
        assert!(settings.min_wpm <= settings.max_wpm);
        assert!((0.0..=100.0).contains(&settings.randomness));
    }

    #[test]
    fn normalization_repairs_crossed_and_out_of_range_values() {
        let normalized = TypingSettings {
            start_delay_secs: 90,
            min_wpm: 999.0,
            max_wpm: -14.0,
            randomness: f64::NAN,
            punctuation_factor: 20.0,
            thinking_every_chars: 0,
            thinking_pause_max_ms: 10,
            typo_chance: 99.0,
            fatigue_drift: -10.0,
            ..TypingSettings::default()
        }
        .normalized();

        assert_eq!(normalized.start_delay_secs, 30);
        assert_eq!(normalized.min_wpm, 300.0);
        assert_eq!(normalized.max_wpm, 300.0);
        assert_eq!(normalized.randomness, 62.0);
        assert_eq!(normalized.punctuation_factor, 4.0);
        assert_eq!(normalized.thinking_every_chars, 20);
        assert_eq!(normalized.thinking_pause_max_ms, 300);
        assert_eq!(normalized.typo_chance, 15.0);
        assert_eq!(normalized.fatigue_drift, 0.0);
    }

    #[test]
    fn hotkey_validation_rejects_duplicates_and_escape() {
        let mut settings = AppSettings::default();
        settings.hotkey_pause = "f8".into();
        assert!(settings.validate_hotkeys().is_err());

        let escape_settings = AppSettings {
            hotkey_start: "Escape".into(),
            ..AppSettings::default()
        };
        assert!(escape_settings.validate_hotkeys().is_err());
    }

    #[test]
    fn default_presets_have_unique_names_and_valid_typing() {
        let presets = default_presets();
        assert_eq!(presets.len(), 3);
        let mut names = std::collections::HashSet::new();
        for preset in presets {
            assert!(names.insert(preset.name.to_lowercase()));
            let typing = preset.typing.normalized();
            assert!(typing.min_wpm <= typing.max_wpm);
        }
    }
}
