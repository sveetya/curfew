//! The curfew state machine.
//!
//! Everything the card shows is derived from one `Plan` and the current time.
//! No timers, no threads: the frontend asks "what is true now", so a closed
//! window, a sleep/resume and a clock change all produce the same answer as a
//! running countdown would.
use chrono::{DateTime, Duration, Local, NaiveTime, TimeZone};
use serde::Serialize;

use crate::schedule::parse_time;

/// Minutes the shutdown moves when Wait is pressed.
pub const WAIT_MINUTES: i64 = 10;
/// Minutes of earlier start owed tomorrow per borrowed grace window.
pub const DONATION_MINUTES: i64 = 2;

/// A curfew night is over at six in the morning. Six is not a curfew hour, it
/// is the line where "still up" stops being tonight's problem.
pub const NIGHT_END_HOUR: u32 = 6;

fn clock_at(value: &str) -> Option<NaiveTime> {
    let minutes = parse_time(value)?;
    NaiveTime::from_hms_opt((minutes / 60) as u32, (minutes % 60) as u32, 0)
}

/// The moment the night that opens at `opens` on `date` is over.
fn night_ends(date: chrono::NaiveDate, opens: NaiveTime) -> Option<DateTime<Local>> {
    let morning = NaiveTime::from_hms_opt(NIGHT_END_HOUR, 0, 0)?;
    // A card that opens after midnight (unusual, but the settings allow it)
    // ends at the same morning it opened in.
    let day = if opens < morning {
        date
    } else {
        date.succ_opt()?
    };
    Local.from_local_datetime(&day.and_time(morning)).single()
}

/// The deadline of the night that is running right now.
///
/// Tonight is not the calendar day. A night opens with the card at `start` and
/// ends in the morning; anything between that morning and tonight's card is
/// daytime, which looks forward. Reading the calendar day instead is what makes
/// an app opened at 23:00 count down twenty-three hours to tomorrow's curfew,
/// and an app opened at 00:30 look forward past a curfew it is still inside.
pub fn night_deadline(start: &str, deadline: &str, now: DateTime<Local>) -> Option<DateTime<Local>> {
    let opens = clock_at(start)?;
    let closes = clock_at(deadline)?;
    let today = now.date_naive();
    let yesterday = today.pred_opt()?;

    let last_opens = Local.from_local_datetime(&yesterday.and_time(opens)).single()?;
    let last_ends = night_ends(yesterday, opens)?;
    let still_last_night = now >= last_opens && now < last_ends;

    let date = if still_last_night { yesterday } else { today };
    Local.from_local_datetime(&date.and_time(closes)).single()
}

/// Length of the evening the schedule describes, in minutes: the card opens at
/// `start`, Windows goes down at `deadline`.
pub fn window_minutes(start: &str, deadline: &str) -> Option<i64> {
    let opens = parse_time(start)?;
    let closes = parse_time(deadline)?;
    if closes <= opens {
        None
    } else {
        Some(closes - opens)
    }
}

/// The plan the app opens with.
///
/// Before the deadline it is the night's own countdown. After it, the night is
/// already gone — but the machine still has to go down, just not the instant
/// the lid opens. So a late open starts the timer: the same length of evening
/// the schedule describes, counted from now, grace included. Opened at 23:00
/// with a 21:30/22:00 night, the card counts down to 23:30 and shuts the
/// machine down then.
pub fn plan_for_now(start: &str, deadline: &str, grace_minutes: i64, now: DateTime<Local>) -> Plan {
    let closes = night_deadline(start, deadline, now).unwrap_or(now);
    if now < closes {
        return Plan::new(closes, grace_minutes, now);
    }
    let evening = window_minutes(start, deadline).unwrap_or(0);
    // A malformed or zero-length schedule still gets a sane timer rather than
    // an immediate outage.
    let length = if evening > 0 { evening } else { 30 };
    Plan::new(now + Duration::minutes(length), grace_minutes, now)
}

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

    /// Seconds past the deadline. Zero for the whole night until Windows was
    /// supposed to be down, which is what the card shows after a late open.
    pub fn overdue(&self, now: DateTime<Local>) -> i64 {
        (now - self.deadline).num_seconds().max(0)
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

    /// Wait pressed: shutdown moves later. During FINISH UP and after the
    /// deadline the same move is booked as borrowed grace, which is what the
    /// debt line is for. Once the deadline is gone there is nothing left to
    /// extend, so the ten minutes are counted from now instead — otherwise the
    /// button would hand out free time to anyone who opened the app late.
    pub fn wait(&mut self, now: DateTime<Local>) -> WaitOutcome {
        let phase = self.phase(now);
        let borrowed = phase != Phase::Work;
        if phase == Phase::Expired {
            self.deadline = now + Duration::minutes(WAIT_MINUTES);
            self.total_seconds = WAIT_MINUTES * 60;
        } else {
            self.deadline += Duration::minutes(WAIT_MINUTES);
            self.total_seconds += WAIT_MINUTES * 60;
        }
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

    /// Any moment in November 2026, so the night tests can move the day.
    fn on(day: u32, hour: u32, minute: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(2026, 11, day, hour, minute, 0).unwrap()
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
    fn wait_after_expiry_buys_ten_minutes_from_now_and_books_the_debt() {
        let mut plan = plan_2200();
        // Opened at 22:01, past the shutdown. There is no deadline left to
        // extend, so the ten minutes run from now — and they cost the same
        // debt as grace, or the button would be a free pass.
        let outcome = plan.wait(at(22, 1, 0));
        assert!(outcome.borrowed);
        assert_eq!(plan.deadline(), at(22, 11, 0));
        assert_eq!(plan.borrows(), 1);
        assert_eq!(plan.owed_minutes(), DONATION_MINUTES);
        assert_eq!(plan.total_seconds(), 10 * 60);
        // Five of those ten are the carved-out grace, so the countdown is back.
        assert_eq!(plan.phase(at(22, 2, 0)), Phase::Work);
        assert_eq!(plan.remaining(at(22, 2, 0)), 4 * 60);
        assert_eq!(plan.overdue(at(22, 12, 0)), 60);
    }

    #[test]
    fn a_late_open_starts_the_timer_instead_of_cutting_power() {
        // 23:00 against a 21:30/22:00 night, grace 5: the countdown runs 25
        // minutes and Windows goes down 30 minutes after the lid opened.
        let now = Local.with_ymd_and_hms(2026, 11, 13, 23, 0, 0).unwrap();
        let plan = plan_for_now("21:30", "22:00", 5, now);
        assert_eq!(plan.phase(now), Phase::Work);
        assert_eq!(plan.remaining(now), 25 * 60);
        assert_eq!(plan.deadline(), now + Duration::minutes(30));
        assert_eq!(plan.overdue(now), 0);
        assert_eq!(plan.phase(now + Duration::minutes(26)), Phase::Grace);
        assert_eq!(plan.phase(now + Duration::minutes(30)), Phase::Expired);
    }

    #[test]
    fn a_late_open_after_midnight_starts_the_same_timer() {
        let now = Local.with_ymd_and_hms(2026, 11, 14, 0, 30, 0).unwrap();
        let plan = plan_for_now("21:30", "22:00", 5, now);
        assert_eq!(plan.phase(now), Phase::Work);
        assert_eq!(plan.deadline(), now + Duration::minutes(30));
    }

    #[test]
    fn an_on_time_open_keeps_the_real_deadline() {
        let now = Local.with_ymd_and_hms(2026, 11, 13, 21, 30, 0).unwrap();
        let plan = plan_for_now("21:30", "22:00", 5, now);
        assert_eq!(plan.deadline(), on(13, 22, 0));
        assert_eq!(plan.remaining(now), 25 * 60);

        // Daytime looks forward to tonight's card unchanged.
        let noon = Local.with_ymd_and_hms(2026, 11, 13, 12, 0, 0).unwrap();
        assert_eq!(plan_for_now("21:30", "22:00", 5, noon).deadline(), on(13, 22, 0));
    }

    #[test]
    fn the_evening_length_comes_from_the_schedule() {
        assert_eq!(window_minutes("21:30", "22:00"), Some(30));
        assert_eq!(window_minutes("20:00", "23:30"), Some(210));
        assert_eq!(window_minutes("22:00", "21:30"), None);
        assert_eq!(window_minutes("21:30", "21:30"), None);
        assert_eq!(window_minutes("9:5", "22:00"), None);
    }

    #[test]
    fn a_broken_schedule_still_starts_a_sane_timer() {
        let now = Local.with_ymd_and_hms(2026, 11, 13, 23, 0, 0).unwrap();
        let plan = plan_for_now("9:5", "22:00", 5, now);
        assert_eq!(plan.phase(now), Phase::Work);
        assert_eq!(plan.deadline(), now + Duration::minutes(30));
    }

    #[test]
    fn overdue_measures_from_the_deadline_not_the_countdown() {
        let plan = plan_2200();
        assert_eq!(plan.overdue(at(21, 0, 0)), 0);
        assert_eq!(plan.overdue(at(21, 59, 0)), 0);
        assert_eq!(plan.overdue(at(22, 0, 0)), 0);
        assert_eq!(plan.overdue(at(23, 0, 0)), 3600);
    }

    #[test]
    fn a_night_that_starts_yesterday_is_still_yesterday_after_midnight() {
        // 00:30 is inside the night that opened at 21:30 the day before, so the
        // deadline belongs to yesterday and is already gone.
        let now = Local.with_ymd_and_hms(2026, 11, 14, 0, 30, 0).unwrap();
        let deadline = night_deadline("21:30", "22:00", now).unwrap();
        assert_eq!(deadline, on(13, 22, 0));
        assert!(deadline < now);
    }

    #[test]
    fn opening_at_2300_shows_tonights_curfew_not_tomorrows() {
        let now = Local.with_ymd_and_hms(2026, 11, 13, 23, 0, 0).unwrap();
        let deadline = night_deadline("21:30", "22:00", now).unwrap();
        assert_eq!(deadline, on(13, 22, 0));
        let plan = Plan::new(deadline, 5, now);
        assert_eq!(plan.phase(now), Phase::Expired);
        assert_eq!(plan.overdue(now), 3600);
        assert_eq!(plan.remaining(now), 0);
    }

    #[test]
    fn daytime_belongs_to_tonights_curfew() {
        // 09:00 is after last night ended and before tonight's card opens:
        // the clock that matters is the one later today.
        let now = Local.with_ymd_and_hms(2026, 11, 13, 9, 0, 0).unwrap();
        let deadline = night_deadline("21:30", "22:00", now).unwrap();
        assert_eq!(deadline, on(13, 22, 0));
        assert!(deadline > now);
        assert_eq!(Plan::new(deadline, 5, now).phase(now), Phase::Work);
    }

    #[test]
    fn the_night_ends_in_the_morning_not_at_tonights_card() {
        // 21:29 is daytime: the clock that matters is later tonight.
        let before = Local.with_ymd_and_hms(2026, 11, 13, 21, 29, 59).unwrap();
        assert_eq!(
            night_deadline("21:30", "22:00", before).unwrap(),
            on(13, 22, 0)
        );
        // 05:59 is still the night that opened the evening before.
        let dawn = Local.with_ymd_and_hms(2026, 11, 13, 5, 59, 0).unwrap();
        assert_eq!(
            night_deadline("21:30", "22:00", dawn).unwrap(),
            on(12, 22, 0)
        );
        // 06:01 is a new day, and it looks forward to tonight.
        let morning = Local.with_ymd_and_hms(2026, 11, 13, 6, 1, 0).unwrap();
        assert_eq!(
            night_deadline("21:30", "22:00", morning).unwrap(),
            on(13, 22, 0)
        );
    }

    #[test]
    fn a_malformed_schedule_has_no_night() {
        let now = Local.with_ymd_and_hms(2026, 11, 13, 23, 0, 0).unwrap();
        assert!(night_deadline("9:5", "22:00", now).is_none());
        assert!(night_deadline("21:30", "24:00", now).is_none());
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
