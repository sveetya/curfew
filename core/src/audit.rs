//! The audit log.
//!
//! One narrative line per event plus one machine-readable SUMMARY line per run,
//! in the same shape the PowerShell version wrote, so the console's TypeScript
//! parser and any old log stay compatible.
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

use chrono::{DateTime, Local};
use sha2::{Digest, Sha256};

pub fn stamp(now: DateTime<Local>) -> String {
    now.format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn line(now: DateTime<Local>, message: &str) -> String {
    format!("{}  {}\r\n", stamp(now), message)
}

pub fn append(path: &Path, now: DateTime<Local>, message: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(line(now, message).as_bytes())
}

#[allow(clippy::too_many_arguments)]
pub fn summary(
    now: DateTime<Local>,
    start: &str,
    deadline: &str,
    grace_seconds: i64,
    borrows: u32,
    released: bool,
    outcome: &str,
) -> String {
    format!(
        "{}  SUMMARY  date={}  start={}  deadline={}  grace={}s  borrows={}  released={}  outcome={}\r\n",
        stamp(now),
        now.format("%Y-%m-%d"),
        start,
        deadline,
        grace_seconds,
        borrows,
        if released { "True" } else { "False" },
        outcome
    )
}

/// Last `max_lines` lines of the log, or an explanation when there is none yet.
pub fn read_tail(path: &Path, max_lines: usize) -> String {
    match fs::read_to_string(path) {
        Ok(text) => {
            let lines: Vec<&str> = text.lines().collect();
            let start = lines.len().saturating_sub(max_lines);
            lines[start..].join("\n")
        }
        Err(_) => String::new(),
    }
}

/// Keys are compared as hashes; the release key itself never reaches the disk.
pub fn sha256_hex(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Case, spaces and hyphens are ignored so a key read off a phone still works.
pub fn normalize_key(raw: &str) -> String {
    raw.chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .flat_map(|c| c.to_uppercase())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at() -> DateTime<Local> {
        Local.with_ymd_and_hms(2026, 11, 11, 22, 0, 4).unwrap()
    }

    #[test]
    fn summary_matches_the_parser_shape() {
        let text = summary(at(), "21:30", "22:00", 300, 0, false, "shutdown");
        assert!(text.starts_with("2026-11-11 22:00:04  SUMMARY  date=2026-11-11"));
        assert!(text.contains("start=21:30"));
        assert!(text.contains("deadline=22:00"));
        assert!(text.contains("grace=300s"));
        assert!(text.contains("borrows=0"));
        assert!(text.contains("released=False"));
        assert!(text.ends_with("outcome=shutdown\r\n"));
    }

    #[test]
    fn summary_reports_borrows_and_release() {
        let text = summary(at(), "21:26", "22:00", 300, 2, true, "released");
        assert!(text.contains("borrows=2"));
        assert!(text.contains("released=True"));
        assert!(text.contains("outcome=released"));
    }

    #[test]
    fn lines_are_timestamped_with_crlf() {
        let text = line(at(), "started; deadline=22:00");
        assert_eq!(text, "2026-11-11 22:00:04  started; deadline=22:00\r\n");
    }

    #[test]
    fn keys_are_normalised_before_hashing() {
        assert_eq!(normalize_key(" night-owl 7391 "), "NIGHTOWL7391");
        assert_eq!(normalize_key("NightOwl7391"), normalize_key("night owl 7391"));
    }

    #[test]
    fn hashing_is_stable_and_key_specific() {
        let a = sha256_hex(&normalize_key("night owl 7391"));
        let b = sha256_hex(&normalize_key("NIGHT-OWL-7391"));
        assert_eq!(a, b);
        assert_eq!(a.len(), 64);
        assert_ne!(a, sha256_hex("NIGHTOWL7392"));
    }

    #[test]
    fn missing_log_reads_as_empty() {
        let path = std::env::temp_dir().join("curfew-does-not-exist.log");
        assert_eq!(read_tail(&path, 30), "");
    }

    #[test]
    fn tail_keeps_the_last_lines() {
        let path = std::env::temp_dir().join(format!("curfew-test-{}.log", std::process::id()));
        fs::write(&path, "one\ntwo\nthree\n").unwrap();
        assert_eq!(read_tail(&path, 2), "two\nthree");
        assert_eq!(read_tail(&path, 10), "one\ntwo\nthree");
        let _ = fs::remove_file(&path);
    }
}
