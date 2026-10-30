use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::settings::{
    default_presets, now_millis, AppSettings, Preset, TypingSettings,
};

static PRESET_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl WindowBounds {
    pub fn is_reasonable(&self) -> bool {
        self.width >= 800 && self.height >= 600 && self.width <= 12_000 && self.height <= 12_000
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PersistedState {
    pub settings: AppSettings,
    pub presets: Vec<Preset>,
    pub last_text: String,
    pub window_bounds: Option<WindowBounds>,
}

impl Default for PersistedState {
    fn default() -> Self {
        Self {
            settings: AppSettings::default(),
            presets: default_presets(),
            last_text: String::new(),
            window_bounds: None,
        }
    }
}

pub struct Store {
    path: PathBuf,
    state: Mutex<PersistedState>,
}

impl Store {
    pub fn load(path: PathBuf) -> Self {
        let state = match fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice::<PersistedState>(&bytes) {
                Ok(mut state) => {
                    state.settings = state.settings.normalized();
                    state.presets = state
                        .presets
                        .into_iter()
                        .map(|mut preset| {
                            preset.typing = preset.typing.normalized();
                            preset
                        })
                        .collect();
                    state
                }
                Err(error) => {
                    eprintln!("MrTyper: config at {} is invalid: {error}", path.display());
                    let backup = path.with_extension("corrupt.json");
                    let _ = fs::copy(&path, &backup);
                    PersistedState::default()
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                PersistedState::default()
            }
            Err(error) => {
                eprintln!("MrTyper: could not read config: {error}");
                PersistedState::default()
            }
        };

        Self {
            path,
            state: Mutex::new(state),
        }
    }

    pub fn snapshot(&self) -> PersistedState {
        self.lock().clone()
    }

    pub fn settings(&self) -> AppSettings {
        self.lock().settings.clone()
    }

    pub fn last_text(&self) -> String {
        self.lock().last_text.clone()
    }

    pub fn window_bounds(&self) -> Option<WindowBounds> {
        self.lock().window_bounds.clone()
    }

    pub fn save_settings(&self, settings: AppSettings) -> Result<AppSettings, String> {
        let normalized = settings.normalized();
        self.mutate(|state| {
            state.settings = normalized.clone();
            Ok(())
        })?;
        Ok(normalized)
    }

    pub fn save_last_text(&self, text: String) -> Result<(), String> {
        self.mutate(|state| {
            state.last_text = text;
            Ok(())
        })
    }

    pub fn save_session(&self, settings: AppSettings, text: String) -> Result<(), String> {
        let normalized = settings.normalized();
        self.mutate(|state| {
            state.settings = normalized;
            state.last_text = text;
            Ok(())
        })
    }

    pub fn save_window_bounds(&self, bounds: WindowBounds) -> Result<(), String> {
        if !bounds.is_reasonable() {
            return Err("The reported window bounds are out of range.".into());
        }
        self.mutate(|state| {
            state.window_bounds = Some(bounds);
            Ok(())
        })
    }

    pub fn add_preset(&self, name: &str, typing: TypingSettings) -> Result<Preset, String> {
        let clean_name = validate_name(name)?;
        let typing = typing.normalized();
        let now = now_millis();
        let id = format!(
            "preset-{now}-{}-{}",
            std::process::id(),
            PRESET_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let preset = Preset {
            id,
            name: clean_name,
            typing,
            updated_at: now,
        };

        let result = preset.clone();
        self.mutate(|state| {
            ensure_unique_name(&state.presets, &preset.name, None)?;
            state.presets.insert(0, preset.clone());
            Ok(())
        })?;
        Ok(result)
    }

    pub fn rename_preset(&self, id: &str, name: &str) -> Result<Preset, String> {
        let clean_name = validate_name(name)?;
        self.mutate(|state| {
            ensure_unique_name(&state.presets, &clean_name, Some(id))?;
            let index = state
                .presets
                .iter()
                .position(|preset| preset.id == id)
                .ok_or_else(|| "That preset no longer exists.".to_string())?;
            let preset = state
                .presets
                .get_mut(index)
                .ok_or_else(|| "That preset no longer exists.".to_string())?;
            preset.name = clean_name;
            preset.updated_at = now_millis();
            Ok(preset.clone())
        })
    }

    pub fn delete_preset(&self, id: &str) -> Result<(), String> {
        self.mutate(|state| {
            let original_len = state.presets.len();
            state.presets.retain(|preset| preset.id != id);
            if state.presets.len() == original_len {
                return Err("That preset no longer exists.".into());
            }
            Ok(())
        })
    }

    fn mutate<T>(
        &self,
        change: impl FnOnce(&mut PersistedState) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self.lock();
        let previous = guard.clone();
        let result = change(&mut guard)?;
        if let Err(error) = self.persist(&guard) {
            *guard = previous;
            return Err(error);
        }
        Ok(result)
    }

    fn persist(&self, state: &PersistedState) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                return Err(format!(
                    "Could not create the settings folder at {}: {error}",
                    parent.display()
                ));
            }
        }

        let bytes = serde_json::to_vec_pretty(state)
            .map_err(|error| format!("Could not serialize settings: {error}"))?;

        let temp_path = self.path.with_extension("json.tmp");
        fs::write(&temp_path, bytes)
            .map_err(|error| format!("Could not write settings: {error}"))?;

        if fs::rename(&temp_path, &self.path).is_err() {
            // Windows can refuse an atomic replacement when the destination is
            // locked by a virus scanner. Keep the write usable with a fallback.
            if self.path.exists() {
                fs::remove_file(&self.path)
                    .map_err(|error| format!("Could not replace settings: {error}"))?;
            }
            fs::rename(&temp_path, &self.path)
                .map_err(|error| format!("Could not save settings: {error}"))?;
        }

        Ok(())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, PersistedState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn validate_name(name: &str) -> Result<String, String> {
    let clean = name.trim();
    if clean.is_empty() {
        return Err("Give this preset a name.".into());
    }
    if clean.chars().count() > 48 {
        return Err("Preset names can be up to 48 characters.".into());
    }
    Ok(clean.to_string())
}

fn ensure_unique_name(
    presets: &[Preset],
    name: &str,
    except_id: Option<&str>,
) -> Result<(), String> {
    let normalized = name.to_lowercase();
    if presets.iter().any(|preset| {
        preset.name.to_lowercase() == normalized
            && except_id.map(|id| preset.id != id).unwrap_or(true)
    }) {
        return Err("A preset with that name already exists.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "mrtyper-{label}-{}-{}.json",
            std::process::id(),
            now_millis()
        ))
    }

    #[test]
    fn store_round_trips_session_and_presets() {
        let path = temporary_path("round-trip");
        let store = Store::load(path.clone());
        let preset = store
            .add_preset("Test cadence", TypingSettings::default())
            .expect("preset should save");
        let mut settings = AppSettings::default();
        settings.theme = "dark".into();
        store
            .save_session(settings, "Hello, 世界 👋".into())
            .expect("session should save");
        drop(store);

        let restored = Store::load(path.clone());
        assert_eq!(restored.last_text(), "Hello, 世界 👋");
        assert_eq!(restored.settings().theme, "dark");
        assert!(restored
            .snapshot()
            .presets
            .iter()
            .any(|item| item.id == preset.id));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn preset_names_are_unique_case_insensitively() {
        let path = temporary_path("names");
        let store = Store::load(path.clone());
        store
            .add_preset("Measured", TypingSettings::default())
            .expect("first preset saves");
        let duplicate = store.add_preset("measured", TypingSettings::default());
        assert!(duplicate.is_err());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn unknown_preset_deletion_fails() {
        let store = Store::load(temporary_path("delete"));
        assert!(store.delete_preset("does-not-exist").is_err());
    }
}
