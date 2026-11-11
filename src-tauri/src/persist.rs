//! A crash-safe snapshot of the running plan.
//!
//! The countdown must survive a hibernate, a crash or a Task Manager kill. If
//! the app comes back and finds a plan from today whose last tick is recent, it
//! resumes instead of starting over, and the sleep gap is applied as paused
//! time rather than spent time.
use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub deadline: String,
    pub grace_seconds: i64,
    pub total_seconds: i64,
    pub borrows: u32,
    pub released: bool,
    pub last_tick: String,
}

fn path(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .resolve("plan.json", BaseDirectory::AppData)
        .unwrap_or_else(|_| std::path::PathBuf::from("plan.json"))
}

pub fn save(app: &AppHandle, saved: &Saved) {
    let target = path(app);
    if let Some(parent) = target.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string(saved) {
        let _ = std::fs::write(target, text);
    }
}

pub fn load(app: &AppHandle) -> Option<Saved> {
    let text = std::fs::read_to_string(path(app)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn clear(app: &AppHandle) {
    let _ = std::fs::remove_file(path(app));
}
