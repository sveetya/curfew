//! Task Scheduler wiring, kept pure so the arguments can be tested.
//!
//! A raw `schtasks` line is where this kind of app usually breaks: without
//! `/it` the task runs in session 0, where no window can be drawn, so the night
//! goes by with a silent shutdown and no card. That is why the arguments are
//! built in one tested place instead of being typed into a README.
use std::path::Path;

pub const TASK_NAME: &str = "Curfew";
pub const GUARD_TASK_NAME: &str = "CurfewGuard";

/// Parse "HH:mm" into minutes since midnight. Two digits each, 24h.
pub fn parse_time(value: &str) -> Option<i64> {
    let trimmed = value.trim();
    let (h, m) = trimmed.split_once(':')?;
    if h.len() != 2 || m.len() != 2 || !h.chars().all(|c| c.is_ascii_digit()) || !m.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let hours: i64 = h.parse().ok()?;
    let minutes: i64 = m.parse().ok()?;
    if !(0..=23).contains(&hours) || !(0..=59).contains(&minutes) {
        return None;
    }
    Some(hours * 60 + minutes)
}

pub fn format_time(total_minutes: i64) -> String {
    let wrapped = total_minutes.rem_euclid(24 * 60);
    format!("{:02}:{:02}", wrapped / 60, wrapped % 60)
}

/// Tomorrow's start, pulled earlier by the grace borrowed tonight.
pub fn early_start(start: &str, owed_minutes: i64) -> String {
    match parse_time(start) {
        Some(minutes) => format_time(minutes - owed_minutes.max(0)),
        None => start.to_string(),
    }
}

/// `schtasks /create` arguments for the nightly card.
pub fn install_args(program: &Path, start: &str) -> Vec<String> {
    let target = format!("\"{}\" --card", program.display());
    vec![
        "/create".into(),
        "/tn".into(),
        TASK_NAME.into(),
        "/tr".into(),
        target,
        "/sc".into(),
        "daily".into(),
        "/st".into(),
        start.to_string(),
        "/it".into(),
        "/f".into(),
    ]
}

/// A second task that brings the app back if it is killed inside the curfew
/// window. `schtasks` cannot express "every N minutes between two times"
/// without an end time, so the window is passed explicitly.
pub fn guard_args(program: &Path, from: &str, until: &str, every_minutes: u32) -> Vec<String> {
    vec![
        "/create".into(),
        "/tn".into(),
        GUARD_TASK_NAME.into(),
        "/tr".into(),
        format!("\"{}\" --guard", program.display()),
        "/sc".into(),
        "minute".into(),
        "/mo".into(),
        every_minutes.to_string(),
        "/st".into(),
        from.to_string(),
        "/et".into(),
        until.to_string(),
        "/it".into(),
        "/f".into(),
    ]
}

pub fn guard_delete_args() -> Vec<String> {
    vec![
        "/delete".into(),
        "/tn".into(),
        GUARD_TASK_NAME.into(),
        "/f".into(),
    ]
}

pub fn delete_args() -> Vec<String> {
    vec![
        "/delete".into(),
        "/tn".into(),
        TASK_NAME.into(),
        "/f".into(),
    ]
}

pub fn query_args() -> Vec<String> {
    vec![
        "/query".into(),
        "/tn".into(),
        TASK_NAME.into(),
        "/fo".into(),
        "list".into(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn parses_and_rejects_times() {
        assert_eq!(parse_time("21:30"), Some(1290));
        assert_eq!(parse_time("00:00"), Some(0));
        assert_eq!(parse_time(" 22:05 "), Some(1325));
        assert_eq!(parse_time("24:00"), None);
        assert_eq!(parse_time("21:60"), None);
        assert_eq!(parse_time("9:5"), None);
        assert_eq!(parse_time(""), None);
    }

    #[test]
    fn formats_with_wrapping() {
        assert_eq!(format_time(1290), "21:30");
        assert_eq!(format_time(0), "00:00");
        assert_eq!(format_time(-1), "23:59");
        assert_eq!(format_time(24 * 60 + 5), "00:05");
    }

    #[test]
    fn borrowed_grace_pulls_the_start_earlier() {
        assert_eq!(early_start("21:30", 0), "21:30");
        assert_eq!(early_start("21:30", 4), "21:26");
        assert_eq!(early_start("21:30", 120), "19:30");
    }

    #[test]
    fn early_start_wraps_past_midnight() {
        assert_eq!(early_start("00:05", 10), "23:55");
    }

    #[test]
    fn install_args_carry_the_session_flag() {
        let args = install_args(&PathBuf::from(r"C:\Curfew\curfew.exe"), "21:30");
        // Without /it the task runs in session 0 and cannot draw the card.
        assert!(args.iter().any(|arg| arg == "/it"));
        assert!(args.iter().any(|arg| arg == "/f"));
        assert!(args.iter().any(|arg| arg == TASK_NAME));
        assert!(args.iter().any(|arg| arg == "/sc"));
        assert!(args.iter().any(|arg| arg == "daily"));
        assert_eq!(args.last().unwrap(), "/f");
    }

    #[test]
    fn install_args_quote_the_exe_and_pass_the_card_flag() {
        let args = install_args(&PathBuf::from(r"C:\Program Files\Curfew\curfew.exe"), "21:30");
        let target = args.iter().position(|arg| arg == "/tr").unwrap() + 1;
        assert!(args[target].contains("--card"));
        assert!(args[target].starts_with('"'));
        assert!(args[target].contains("Program Files"));
    }

    #[test]
    fn install_args_put_the_start_time_after_st() {
        let args = install_args(&PathBuf::from("curfew.exe"), "21:30");
        let st = args.iter().position(|arg| arg == "/st").unwrap();
        assert_eq!(args[st + 1], "21:30");
    }

    #[test]
    fn delete_and_query_target_the_same_task() {
        assert!(delete_args().iter().any(|arg| arg == TASK_NAME));
        assert!(delete_args().iter().any(|arg| arg == "/delete"));
        assert!(query_args().iter().any(|arg| arg == "/query"));
    }
}

#[cfg(test)]
mod guard_tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn guard_runs_the_app_in_tray_mode_every_five_minutes() {
        let args = guard_args(&PathBuf::from(r"C:\Apps\curfew.exe"), "21:30", "22:10", 5);
        let target = args.iter().position(|a| a == "/tr").unwrap() + 1;
        assert!(args[target].contains("--guard"));
        assert!(args.iter().any(|a| a == "minute"));
        let mo = args.iter().position(|a| a == "/mo").unwrap();
        assert_eq!(args[mo + 1], "5");
        let et = args.iter().position(|a| a == "/et").unwrap();
        assert_eq!(args[et + 1], "22:10");
        assert!(args.iter().any(|a| a == "/it"));
    }
}
