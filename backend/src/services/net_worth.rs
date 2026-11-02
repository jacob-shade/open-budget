//! Estimated daily net worth, reconstructed backwards from today's balances.
//!
//! Plaid only reports current balances, so past values are estimated: an account's signed balance
//! (assets positive, credit/loan debt negative) at the end of day `d` is today's signed balance
//! minus the sum of its transactions dated after `d`. Stored transaction amounts are already signed
//! (negative = money out), and the same formula holds for liabilities: a card purchase is a negative
//! amount that made the debt larger. Accounts without synced transactions (investments) stay flat.

use std::collections::BTreeMap;

use time::{Date, Month};

/// Longest history returned, in days (about three years).
pub const MAX_DAYS: i64 = 1100;

pub fn parse_date(s: &str) -> Option<Date> {
    let (y, rest) = s.split_once('-')?;
    let (m, d) = rest.split_once('-')?;
    if y.len() != 4 || m.len() != 2 || d.len() != 2 {
        return None;
    }
    let month = Month::try_from(m.parse::<u8>().ok()?).ok()?;
    Date::from_calendar_date(y.parse().ok()?, month, d.parse().ok()?).ok()
}

pub fn format_date(d: Date) -> String {
    format!("{:04}-{:02}-{:02}", d.year(), d.month() as u8, d.day())
}

/// Net worth at the end of each day from `start` to `end` inclusive (oldest first).
/// `now_cents` is today's net worth; `daily_sums` maps YYYY-MM-DD to the sum of that day's
/// transaction amounts across all accounts (any dates; only those after `start` matter).
pub fn reconstruct(now_cents: i64, daily_sums: &BTreeMap<String, i64>, start: Date, end: Date) -> Vec<(String, i64)> {
    let end_key = format_date(end);
    // Transactions dated after `end` (e.g. today's, if `end` is earlier) are already reflected in `now`.
    let mut after: i64 = daily_sums.range::<str, _>((std::ops::Bound::Excluded(end_key.as_str()), std::ops::Bound::Unbounded)).map(|(_, v)| v).sum();
    let mut out = Vec::new();
    let mut day = end;
    loop {
        out.push((format_date(day), now_cents - after));
        if day <= start {
            break;
        }
        // Moving to the previous day: this day's transactions are now "after".
        after += daily_sums.get(&format_date(day)).copied().unwrap_or(0);
        match day.previous_day() {
            Some(prev) => day = prev,
            None => break,
        }
    }
    out.reverse();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_round_trip() {
        let d = parse_date("2026-02-28").unwrap();
        assert_eq!(format_date(d.next_day().unwrap()), "2026-03-01");
        assert!(parse_date("2026-2-28").is_none());
        assert!(parse_date("2026-02-30").is_none());
    }

    #[test]
    fn reconstructs_backwards_from_today() {
        // Today (Nov 3) net worth is $1,000. On Nov 2 we spent $50; on Nov 3 we were paid $200.
        let sums: BTreeMap<String, i64> = [("2026-11-02".to_string(), -5000), ("2026-11-03".to_string(), 20000)].into();
        let pts = reconstruct(100000, &sums, parse_date("2026-11-01").unwrap(), parse_date("2026-11-03").unwrap());
        assert_eq!(
            pts,
            vec![
                ("2026-11-01".to_string(), 100000 - 20000 + 5000), // before both
                ("2026-11-02".to_string(), 100000 - 20000),         // after the spend, before pay
                ("2026-11-03".to_string(), 100000),
            ]
        );
    }

    #[test]
    fn end_before_today_excludes_later_transactions() {
        let sums: BTreeMap<String, i64> = [("2026-11-03".to_string(), 20000)].into();
        let pts = reconstruct(100000, &sums, parse_date("2026-11-02").unwrap(), parse_date("2026-11-02").unwrap());
        assert_eq!(pts, vec![("2026-11-02".to_string(), 80000)]);
    }
}
