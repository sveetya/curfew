//! The curfew state machine.
//!
//! Everything the card shows is derived from one `Plan` and the current time.
//! No timers, no threads: the frontend asks "what is true now", so a closed
//! window, a sleep/resume and a clock change all produce the same answer as a
//! running countdown would.
use chrono::{DateTime, Duration, Local};
use serde::Serialize;

/// Minutes the shutdown moves when Wait is pressed.
pub const WAIT_MINUTES: i64 = 10;
/// Minutes of earlier start owed tomorrow per borrowed grace window.
pub const DONATION_MINUTES: i64 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    /// Countdown running. Wait moves the real deadline.
    Work,
    /// Countdown hit zero, grace running. Wait borrows grace.
    Grace,
    /// Deadline passed.
    Expired,
}

#[derive(Debug, Clone)]
pub struct Plan {
    /// Moment Windows goes down.
    deadline: DateTime<Local>,
    grace_seconds: i64,
    /// Length of the countdown, for the progress bar. Grows when Wait is pressed.
    total_seconds: i64,
    borrows: u32,
    released: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WaitOutcome {
    /// True when the press landed during FINISH UP and is booked as debt.
    pub borrowed: bool,
    pub deadline: DateTime<Local>,
}

impl Plan {
    pub fn new(deadline: DateTime<Local>, grace_minutes: i64, now: DateTime<Local>) -> Self {
        let grace_seconds = grace_minutes.max(0) * 60;
        let total = (deadline - now).num_seconds().max(0);
        Self {
            deadline,
            grace_seconds,
            total_seconds: total,
            borrows: 0,
            released: false,
        }
    }

    pub fn deadline(&self) -> DateTime<Local> {
        self.deadline
    }

    pub fn grace_seconds(&self) -> i64 {
        self.grace_seconds
    }

    pub fn total_seconds(&self) -> i64 {
        self.total_seconds
    }

    pub fn borrows(&self) -> u32 {
        self.borrows
    }

    pub fn released(&self) -> bool {
        self.released
    }

    pub fn release(&mut self) {
        self.released = true;
    }

    /// When the countdown reaches zero. Grace is carved out of the deadline,
    /// never added on top of it.
    pub fn countdown_end(&self) -> DateTime<Local> {
        self.deadline - Duration::seconds(self.grace_seconds)
    }

    pub fn remaining(&self, now: DateTime<Local>) -> i64 {
        (self.countdown_end() - now).num_seconds().max(0)
    }

    pub fn grace_remaining(&self, now: DateTime<Local>) -> i64 {
        (self.deadline - now).num_seconds().clamp(0, self.grace_seconds)
    }

    pub fn phase(&self, now: DateTime<Local>) -> Phase {
        if now < self.countdown_end() {
            Phase::Work
        } else if now < self.deadline {
            Phase::Grace
        } else {
            Phase::Expired
        }
    }

    /// Minutes tomorrow should start earlier because of tonight's borrowing.
    pub fn owed_minutes(&self) -> i64 {
        self.borrows as i64 * DONATION_MINUTES
    }

    /// Move the whole plan later, used when the machine was asleep. A paused
    /// countdown keeps its remaining time: only lived minutes are spent.
    pub fn shift(&mut self, by: Duration) {
        let seconds = by.num_seconds();
        if seconds <= 0 {
            return;
        }
        self.deadline += by;
        self.total_seconds += seconds;
    }

    /// Rebuild a plan from a saved snapshot, so a crash mid-night keeps the
    /// deadline and the debt instead of starting over.
    pub fn restore(
        deadline: DateTime<Local>,
        grace_seconds: i64,
        total_seconds: i64,
        borrows: u32,
        released: bool,
    ) -> Self {
        Self {
            deadline,
            grace_seconds,
            total_seconds,
            borrows,
            released,
        }
    }

    /// Wait pressed: shutdown moves later. During FINISH UP the same move is
    /// booked as borrowed grace, which is what the debt line is for.
    pub fn wait(&mut self, now: DateTime<Local>) -> WaitOutcome {
        let borrowed = self.phase(now) == Phase::Grace;
        self.deadline += Duration::minutes(WAIT_MINUTES);
        self.total_seconds += WAIT_MINUTES * 60;
        if borrowed {
            self.borrows += 1;
        }
        WaitOutcome {
            borrowed,
            deadline: self.deadline,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(hour: u32, minute: u32, second: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(2026, 11, 11, hour, minute, second).unwrap()
    }

    fn plan_2200() -> Plan {
        Plan::new(at(22, 0, 0), 5, at(21, 30, 0))
    }

    #[test]
    fn grace_is_carved_out_of_the_deadline() {
        let plan = plan_2200();
        assert_eq!(plan.countdown_end(), at(21, 55, 0));
        assert_eq!(plan.total_seconds(), 30 * 60);
    }

    #[test]
    fn countdown_counts_down_and_stops_at_zero() {
        let plan = plan_2200();
        assert_eq!(plan.remaining(at(21, 50, 0)), 300);
        assert_eq!(plan.remaining(at(21, 55, 0)), 0);
        assert_eq!(plan.remaining(at(22, 30, 0)), 0);
    }

    #[test]
    fn phases_change_on_the_boundaries() {
        let plan = plan_2200();
        assert_eq!(plan.phase(at(21, 54, 59)), Phase::Work);
        assert_eq!(plan.phase(at(21, 55, 0)), Phase::Grace);
        assert_eq!(plan.phase(at(21, 59, 59)), Phase::Grace);
        assert_eq!(plan.phase(at(22, 0, 0)), Phase::Expired);
    }

    #[test]
    fn grace_runs_down_to_the_deadline() {
        let plan = plan_2200();
        assert_eq!(plan.grace_remaining(at(21, 55, 0)), 300);
        assert_eq!(plan.grace_remaining(at(21, 57, 30)), 150);
        assert_eq!(plan.grace_remaining(at(22, 0, 0)), 0);
        assert_eq!(plan.grace_remaining(at(22, 5, 0)), 0);
    }

    #[test]
    fn wait_before_zero_moves_the_deadline_without_debt() {
        let mut plan = plan_2200();
        let outcome = plan.wait(at(21, 40, 0));
        assert!(!outcome.borrowed);
        assert_eq!(plan.deadline(), at(22, 10, 0));
        assert_eq!(plan.countdown_end(), at(22, 5, 0));
        assert_eq!(plan.borrows(), 0);
        assert_eq!(plan.owed_minutes(), 0);
    }

    #[test]
    fn wait_during_grace_is_booked_as_debt() {
        let mut plan = plan_2200();
        let outcome = plan.wait(at(21, 56, 0));
        assert!(outcome.borrowed);
        assert_eq!(plan.deadline(), at(22, 10, 0));
        assert_eq!(plan.borrows(), 1);
        assert_eq!(plan.owed_minutes(), DONATION_MINUTES);
        // Grace is still carved out of the new deadline.
        assert_eq!(plan.countdown_end(), at(22, 5, 0));
        // The borrowed ten minutes push the countdown end with it.
        assert_eq!(plan.phase(at(22, 2, 0)), Phase::Work);
        assert_eq!(plan.phase(at(22, 7, 0)), Phase::Grace);
    }

    #[test]
    fn borrowing_twice_doubles_the_debt() {
        let mut plan = plan_2200();
        plan.wait(at(21, 56, 0));
        plan.wait(at(22, 7, 0));
        assert_eq!(plan.borrows(), 2);
        assert_eq!(plan.owed_minutes(), 2 * DONATION_MINUTES);
        assert_eq!(plan.deadline(), at(22, 20, 0));
    }

    #[test]
    fn wait_after_expiry_still_moves_the_shutdown() {
        let mut plan = plan_2200();
        let outcome = plan.wait(at(22, 1, 0));
        // Expired is not Grace, so nothing is booked as debt: you cannot borrow
        // what has already been taken.
        assert!(!outcome.borrowed);
        assert_eq!(plan.borrows(), 0);
    }

    #[test]
    fn zero_grace_gives_a_hard_cut() {
        let plan = Plan::new(at(22, 0, 0), 0, at(21, 30, 0));
        assert_eq!(plan.countdown_end(), at(22, 0, 0));
        assert_eq!(plan.phase(at(21, 59, 59)), Phase::Work);
        assert_eq!(plan.phase(at(22, 0, 0)), Phase::Expired);
    }

    #[test]
    fn a_deadline_already_past_starts_expired() {
        let plan = Plan::new(at(21, 0, 0), 5, at(21, 30, 0));
        assert_eq!(plan.phase(at(21, 30, 0)), Phase::Expired);
        assert_eq!(plan.remaining(at(21, 30, 0)), 0);
        assert_eq!(plan.total_seconds(), 0);
    }

    #[test]
    fn release_is_sticky() {
        let mut plan = plan_2200();
        plan.release();
        assert!(plan.released());
    }
}

#[cfg(test)]
mod pause_tests {
    use super::*;
    use chrono::Local;

    #[test]
    fn sleeping_does_not_spend_the_countdown() {
        let now = Local::now();
        let mut plan = Plan::new(now + Duration::minutes(30), 5, now);
        let before = plan.remaining(now);
        // Wake up forty minutes later: the plan moves with the clock, so the
        // machine sees the same countdown it went to sleep with.
        let woke = now + Duration::minutes(40);
        plan.shift(woke - now);
        assert_eq!(plan.remaining(woke), before);
        assert_eq!(plan.phase(woke), Phase::Work);
    }

    #[test]
    fn a_restored_plan_keeps_its_debt_and_total() {
        let now = Local::now();
        let plan = Plan::restore(now + Duration::minutes(10), 300, 2400, 2, false);
        assert_eq!(plan.owed_minutes(), 4);
        assert_eq!(plan.total_seconds(), 2400);
        // Ten minutes out with a five minute grace is still the countdown.
        assert_eq!(plan.phase(now), Phase::Work);
        assert_eq!(plan.phase(now + Duration::minutes(7)), Phase::Grace);
    }
}
