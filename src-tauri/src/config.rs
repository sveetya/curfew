//! Settings that survive a restart.
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use curfew_core::schedule::parse_time;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// "HH:mm" — moment Windows goes down.
    pub deadline: String,
    /// "HH:mm" — moment the card appears.
    pub start: String,
    /// Carved out of the deadline, not added to it.
    pub grace_minutes: i64,
    /// A laptop that unplugs escapes a curfew that needs mains.
    pub battery_allowed: bool,
    /// Bring the machine out of sleep to draw the card.
    pub wake_to_run: bool,
    pub autostart_console: bool,
    /// Where the audit log lands. Empty means the app's own log folder; setting
    /// it to a synced folder is what lets the coach read nights from elsewhere.
    #[serde(default)]
    pub log_dir: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            deadline: "22:00".into(),
            start: "21:30".into(),
            grace_minutes: 5,
            battery_allowed: true,
            wake_to_run: true,
            autostart_console: false,
            log_dir: String::new(),
        }
    }
}

impl Config {
    pub fn validate(&self) -> Result<(), String> {
        let deadline = parse_time(&self.deadline)
            .ok_or_else(|| format!("deadline '{}' is not HH:mm", self.deadline))?;
        let start = parse_time(&self.start)
            .ok_or_else(|| format!("start '{}' is not HH:mm", self.start))?;
        if !(0..=120).contains(&self.grace_minutes) {
            return Err("grace must be between 0 and 120 minutes".into());
        }
        if start >= deadline {
            return Err("the card must open before the shutdown".into());
        }
        let log_dir = self.log_dir.trim();
        if !log_dir.is_empty() && !Path::new(log_dir).is_absolute() {
            return Err("the log folder must be an absolute path".into());
        }
        Ok(())
    }
}

fn config_path(app: &AppHandle) -> PathBuf {
    app.path()
        .resolve("config.json", BaseDirectory::AppConfig)
        .unwrap_or_else(|_| PathBuf::from("config.json"))
}

pub fn load(app: &AppHandle) -> Config {
    match fs::read_to_string(config_path(app)) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Config::default(),
    }
}

pub fn save(app: &AppHandle, config: &Config) -> Result<(), String> {
    config.validate()?;
    let path = config_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let text = serde_json::to_string_pretty(config).map_err(|err| err.to_string())?;
    fs::write(&path, text).map_err(|err| err.to_string())
}
