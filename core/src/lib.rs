//! Curfew's logic, kept away from Tauri so it can be tested anywhere.
//!
//! `curfew` is the state machine, `schedule` builds the Task Scheduler
//! arguments, `audit` owns the log format and the release-key hash comparison.
pub mod audit;
pub mod curfew;
pub mod schedule;
