//! Curfew: a night curfew for Windows.
//!
//! Two windows, one state machine. The card is a small always-on-top countdown;
//! the console is where the schedule and the audit log live. The release key is
//! only ever known as a hash, baked in at build time, so the machine cannot
//! print it back to you at 23:40.
mod config;

use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

use chrono::{DateTime, Duration, Local, NaiveTime, TimeZone};
use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use curfew_core::curfew::{self, Phase, Plan};
use curfew_core::{audit, schedule};

use config::Config;

/// SHA-256 of the normalised release key, supplied at build time. Unset means
/// the release button always refuses.
const RELEASE_HASH: Option<&str> = option_env!("CURFEW_RELEASE_HASH");
/// Wrong-key lockout, so guessing costs clock instead of being free.
const LOCK_MINUTES: i64 = 5;
/// The card's own size; the console is arbitrary.
const CARD_WIDTH: f64 = 380.0;
const CARD_HEIGHT: f64 = 248.0;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurfewState {
    deadline: String,
    deadline_label: String,
    remaining_seconds: i64,
    grace_seconds: i64,
    grace_remaining_seconds: i64,
    phase: Phase,
    total_seconds: i64,
    deadline_minutes: i64,
    grace_minutes: i64,
    borrows: u32,
    owed_minutes: i64,
    lockout_seconds: i64,
    released: bool,
    dry_run: bool,
    log_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseResult {
    ok: bool,
    lockout_seconds: i64,
    message: String,
}

pub struct Runtime {
    inner: Mutex<Inner>,
}

struct Inner {
    plan: Option<Plan>,
    dry_run: bool,
    lockout_until: Option<DateTime<Local>>,
    summarised: bool,
}

impl Default for Runtime {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                plan: None,
                dry_run: false,
                lockout_until: None,
                summarised: false,
            }),
        }
    }
}

fn log_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_log_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("curfew.log")
}

fn today_at(time: &str) -> Option<DateTime<Local>> {
    let naive = NaiveTime::parse_from_str(time, "%H:%M").ok()?;
    let today = Local::now().date_naive();
    Local.from_local_datetime(&today.and_time(naive)).single()
}

fn plan_for_today(config: &Config) -> Plan {
    let now = Local::now();
    let deadline = today_at(&config.deadline).unwrap_or(now);
    Plan::new(deadline, config.grace_minutes, now)
}

/// Tonight's plan, created on first use and kept until the schedule changes.
fn current_plan(inner: &mut Inner, config: &Config) -> Plan {
    if inner.plan.is_none() {
        inner.plan = Some(plan_for_today(config));
    }
    inner.plan.clone().expect("plan was just created")
}

fn state_of(app: &AppHandle, runtime: &Runtime, config: &Config) -> CurfewState {
    let now = Local::now();
    let mut inner = runtime.inner.lock().expect("runtime lock");
    let plan = current_plan(&mut inner, config);
    let lockout = inner
        .lockout_until
        .map(|until| (until - now).num_seconds().max(0))
        .unwrap_or(0);

    CurfewState {
        deadline: plan.deadline().to_rfc3339(),
        deadline_label: plan.deadline().format("%H:%M").to_string(),
        remaining_seconds: plan.remaining(now),
        grace_seconds: plan.grace_seconds(),
        grace_remaining_seconds: plan.grace_remaining(now),
        phase: plan.phase(now),
        total_seconds: plan.total_seconds(),
        deadline_minutes: plan.remaining(now) / 60,
        grace_minutes: plan.grace_seconds() / 60,
        borrows: plan.borrows(),
        owed_minutes: plan.owed_minutes(),
        lockout_seconds: lockout,
        released: plan.released(),
        dry_run: inner.dry_run,
        log_path: log_path(app).display().to_string(),
    }
}

fn write_summary(app: &AppHandle, plan: &Plan, outcome: &str) {
    let now = Local::now();
    let label = plan.deadline().format("%H:%M").to_string();
    let text = audit::summary(
        now,
        &label,
        &label,
        plan.grace_seconds(),
        plan.borrows(),
        plan.released(),
        outcome,
    );
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path(app))
    {
        use std::io::Write;
        let _ = file.write_all(text.as_bytes());
    }
}

#[tauri::command]
fn get_state(app: AppHandle, runtime: State<Runtime>) -> CurfewState {
    let config = config::load(&app);
    state_of(&app, &runtime, &config)
}

#[tauri::command]
fn wait_ten(app: AppHandle, runtime: State<Runtime>) -> CurfewState {
    let config = config::load(&app);
    let now = Local::now();
    let plan = {
        let mut inner = runtime.inner.lock().expect("runtime lock");
        let mut plan = current_plan(&mut inner, &config);
        let outcome = plan.wait(now);
        inner.plan = Some(plan.clone());
        plan
    };

    let message = if plan.borrows() > 0 {
        format!(
            "GRACE BORROWED  shutdown now {}; debt {} min earlier start tomorrow",
            plan.deadline().format("%H:%M"),
            plan.owed_minutes()
        )
    } else {
        format!(
            "DEADLINE EXTENDED {} min; new deadline {}",
            curfew::WAIT_MINUTES,
            plan.deadline().format("%H:%M")
        )
    };
    let _ = audit::append(&log_path(&app), now, &message);

    state_of(&app, &runtime, &config)
}

fn go_down(app: &AppHandle, dry_run: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        // Clear anything Windows had already queued so our own shutdown is the
        // one that fires, then go down immediately.
        let _ = Command::new("shutdown").args(["/a"]).output();
        if !dry_run {
            Command::new("shutdown")
                .args(["/s", "/t", "0"])
                .output()
                .map_err(|err| err.to_string())?;
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (app, dry_run);
    }
    Ok(())
}

#[tauri::command]
fn shutdown_now(app: AppHandle, runtime: State<Runtime>) -> Result<CurfewState, String> {
    let config = config::load(&app);
    let now = Local::now();

    let (plan, dry_run) = {
        let mut inner = runtime.inner.lock().expect("runtime lock");
        let plan = current_plan(&mut inner, &config);
        (plan, inner.dry_run)
    };

    let _ = audit::append(&log_path(&app), now, "user pressed shut down now");
    go_down(&app, dry_run)?;
    write_summary(&app, &plan, "shutdown");
    close_card(&app);

    Ok(state_of(&app, &runtime, &config))
}

#[tauri::command]
fn request_release(app: AppHandle, runtime: State<Runtime>, key: String) -> ReleaseResult {
    let config = config::load(&app);
    let now = Local::now();

    let mut inner = runtime.inner.lock().expect("runtime lock");

    if let Some(until) = inner.lockout_until {
        let left = (until - now).num_seconds().max(0);
        if left > 0 {
            return ReleaseResult {
                ok: false,
                lockout_seconds: left,
                message: format!("Locked. {} left.", humanise(left)),
            };
        }
    }

    let normalised = audit::normalize_key(&key);
    let matches = RELEASE_HASH
        .map(|hash| audit::sha256_hex(&normalised).eq_ignore_ascii_case(hash.trim()))
        .unwrap_or(false);

    if matches {
        let mut plan = current_plan(&mut inner, &config);
        plan.release();
        inner.plan = Some(plan.clone());
        inner.lockout_until = None;
        let _ = audit::append(&log_path(&app), now, "released with valid key");
        drop(inner);
        write_summary(&app, &plan, "released");
        close_card(&app);
        return ReleaseResult {
            ok: true,
            lockout_seconds: 0,
            message: "Released. The card is closing.".into(),
        };
    }

    inner.lockout_until = Some(now + Duration::minutes(LOCK_MINUTES));
    let _ = audit::append(
        &log_path(&app),
        now,
        &format!("release request FAILED; locked {LOCK_MINUTES} min"),
    );
    ReleaseResult {
        ok: false,
        lockout_seconds: LOCK_MINUTES * 60,
        message: format!("Wrong key. Locked for {LOCK_MINUTES} minutes."),
    }
}

fn humanise(seconds: i64) -> String {
    format!("{}:{:02}", seconds / 60, seconds % 60)
}

#[tauri::command]
fn read_log(app: AppHandle) -> String {
    audit::read_tail(&log_path(&app), 400)
}

#[tauri::command]
fn get_config(app: AppHandle) -> Config {
    config::load(&app)
}

#[tauri::command]
fn set_config(app: AppHandle, runtime: State<Runtime>, config: Config) -> Result<Config, String> {
    config.validate()?;
    config::save(&app, &config)?;
    {
        let mut inner = runtime.inner.lock().expect("runtime lock");
        // A changed schedule starts tonight from scratch.
        inner.plan = None;
        inner.summarised = false;
    }
    install_task(&app, &config)?;
    Ok(config)
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<Config, String> {
    let mut config = config::load(&app);
    config.autostart_console = enabled;
    config::save(&app, &config)?;
    Ok(config)
}

/// Install or update the nightly task; nothing else on the machine knows the
/// schedule, so it has to follow every save.
fn install_task(app: &AppHandle, config: &Config) -> Result<(), String> {
    #[cfg(windows)]
    {
        let exe = std::env::current_exe().map_err(|err| err.to_string())?;
        let start = schedule::early_start(&config.start, 0);
        let args = schedule::install_args(&exe, &start);
        let output = Command::new("schtasks")
            .args(&args)
            .output()
            .map_err(|err| err.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (app, config);
    }
    Ok(())
}

fn close_card(app: &AppHandle) {
    if let Some(card) = app.get_webview_window("card") {
        let _ = card.hide();
    }
}

fn place_card(app: &AppHandle) {
    let Some(card) = app.get_webview_window("card") else {
        return;
    };
    if let Ok(Some(monitor)) = card.current_monitor() {
        let screen = monitor.size();
        let scale = monitor.scale_factor();
        let width = (CARD_WIDTH * scale) as i32;
        let margin = (24.0 * scale) as i32;
        let _ = card.set_position(tauri::PhysicalPosition::new(
            screen.width as i32 - width - margin,
            margin,
        ));
    }
}

fn build_card(app: &AppHandle) -> Result<(), String> {
    WebviewWindowBuilder::new(app, "card", WebviewUrl::App("index.html".into()))
        .title("Curfew")
        .inner_size(CARD_WIDTH, CARD_HEIGHT)
        .resizable(false)
        .maximizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .build()
        .map_err(|err| err.to_string())?;
    place_card(app);
    Ok(())
}

fn show_card(app: &AppHandle) -> Result<(), String> {
    match app.get_webview_window("card") {
        Some(card) => {
            card.show().map_err(|err| err.to_string())?;
            place_card(app);
        }
        None => build_card(app)?,
    }
    Ok(())
}

#[tauri::command]
fn open_card(
    app: AppHandle,
    runtime: State<Runtime>,
    minutes: Option<i64>,
    dry_run: Option<bool>,
) -> Result<(), String> {
    let config = config::load(&app);
    let now = Local::now();
    {
        let mut inner = runtime.inner.lock().expect("runtime lock");
        inner.plan = Some(match minutes {
            Some(m) if m > 0 => Plan::new(now + Duration::minutes(m), 1, now),
            _ => Plan::new(today_at(&config.deadline).unwrap_or(now), config.grace_minutes, now),
        });
        inner.dry_run = dry_run.unwrap_or(false);
        inner.summarised = false;
    }
    show_card(&app)
}

fn show_console(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("console") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, "console", WebviewUrl::App("console.html".into()))
        .title("Curfew")
        .inner_size(1120.0, 780.0)
        .min_inner_size(880.0, 620.0)
        .build();
}

fn tray(app: &mut tauri::App) -> tauri::Result<()> {
    let console_item = MenuItem::with_id(app, "console", "Open console", true, None::<&str>)?;
    let test_item = MenuItem::with_id(app, "test", "Test card (2 min)", true, None::<&str>)?;
    let off_item = MenuItem::with_id(app, "off", "Shut down now", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&console_item, &test_item, &off_item, &quit_item])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;

    TrayIconBuilder::with_id("curfew")
        .icon(icon)
        .tooltip("Curfew")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "console" => show_console(app),
            "test" => {
                let _ = open_card_for(app, 2);
            }
            "off" => {
                let _ = go_down(app, false);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { .. } = event {
                show_console(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Start the card without a command context (setup and tray both need this).
fn open_card_for(app: &AppHandle, minutes: i64) -> Result<(), String> {
    let config = config::load(app);
    let now = Local::now();
    let runtime = app.state::<Runtime>();
    {
        let mut inner = runtime.inner.lock().expect("runtime lock");
        inner.plan = Some(if minutes > 0 {
            Plan::new(now + Duration::minutes(minutes), 1, now)
        } else {
            Plan::new(today_at(&config.deadline).unwrap_or(now), config.grace_minutes, now)
        });
        inner.dry_run = minutes > 0;
        inner.summarised = false;
    }
    show_card(app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--tray"]),
        ))
        .manage(Runtime::default())
        .invoke_handler(tauri::generate_handler![
            get_state,
            wait_ten,
            shutdown_now,
            request_release,
            read_log,
            get_config,
            set_config,
            set_autostart,
            open_card
        ])
        .setup(|app| {
            tray(app)?;

            // `--card` is how Task Scheduler starts the night; `--tray` is how
            // the console starts at login without a taskbar window.
            let args: Vec<String> = std::env::args().collect();
            let wants_card = args.iter().any(|arg| arg == "--card");
            let wants_tray = args.iter().any(|arg| arg == "--tray");

            if wants_card {
                let _ = open_card_for(&app.handle().clone(), 0);
            } else if !wants_tray {
                show_console(&app.handle().clone());
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Curfew");
}
