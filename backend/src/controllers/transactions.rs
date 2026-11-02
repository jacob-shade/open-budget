use axum::{
    Json,
    extract::{Query, State},
};
use serde::Deserialize;

use crate::{
    AppState,
    error::AppResult,
    models::transaction::{Transaction, TransactionFilter},
    views::{TransactionView, render},
};

#[derive(Deserialize)]
pub struct TransactionQuery {
    pub account_id: Option<String>,
    /// Comma-separated account ids.
    pub accounts: Option<String>,
    /// YYYY-MM-DD, inclusive.
    pub start: Option<String>,
    pub end: Option<String>,
    /// Text to find in the name or merchant.
    pub q: Option<String>,
    /// Comma-separated Plaid primary categories.
    pub categories: Option<String>,
    /// "in" (money in) or "out" (money out).
    pub direction: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

fn split_list(s: Option<String>) -> Vec<String> {
    s.unwrap_or_default().split(',').map(str::trim).filter(|v| !v.is_empty()).map(String::from).take(100).collect()
}

pub async fn index(
    State(state): State<AppState>,
    Query(q): Query<TransactionQuery>,
) -> AppResult<Json<Vec<TransactionView>>> {
    let filter = parse_filter(q)?;
    Ok(Json(render(Transaction::list(&state.pool, &filter).await?)))
}

/// Turns query parameters into a filter, validating dates and direction.
fn parse_filter(q: TransactionQuery) -> AppResult<TransactionFilter> {
    for d in [&q.start, &q.end].into_iter().flatten() {
        if !is_iso_date(d) {
            return Err(crate::error::AppError::BadRequest("start and end must be YYYY-MM-DD"));
        }
    }
    let money_in = match q.direction.as_deref() {
        None | Some("") | Some("all") => None,
        Some("in") => Some(true),
        Some("out") => Some(false),
        Some(_) => return Err(crate::error::AppError::BadRequest("direction must be in or out")),
    };
    let filter = TransactionFilter {
        account_id: q.account_id,
        account_ids: split_list(q.accounts),
        start: q.start,
        end: q.end,
        search: q.q.map(|s| s.chars().take(100).collect()),
        categories: split_list(q.categories),
        money_in,
        limit: q.limit.unwrap_or(100).clamp(1, 500),
        offset: q.offset.unwrap_or(0).max(0),
    };
    Ok(filter)
}

#[derive(serde::Serialize)]
pub struct LargestExpenseView {
    pub id: String,
    pub name: String,
    pub date: String,
    pub amount_cents: i64,
}

#[derive(serde::Serialize)]
pub struct TransactionSummaryView {
    pub count: i64,
    pub spending_cents: i64,
    pub income_cents: i64,
    /// Average outflow, excluding transfers and payments; null when there are none.
    pub average_expense_cents: Option<i64>,
    pub largest_expense: Option<LargestExpenseView>,
}

/// Totals for every transaction matching the same filters as the list.
pub async fn summary(State(state): State<AppState>, Query(q): Query<TransactionQuery>) -> AppResult<Json<TransactionSummaryView>> {
    let filter = parse_filter(q)?;
    let (t, largest) = Transaction::totals(&state.pool, &filter).await?;
    Ok(Json(TransactionSummaryView {
        count: t.count,
        spending_cents: t.spending_cents,
        income_cents: t.income_cents,
        average_expense_cents: (t.expense_count > 0).then(|| (t.spending_cents as f64 / t.expense_count as f64).round() as i64),
        largest_expense: largest.map(|l| LargestExpenseView { id: l.id, name: l.merchant_name.unwrap_or(l.name), date: l.date, amount_cents: -l.amount_cents }),
    }))
}

#[derive(Deserialize)]
pub struct SpendingQuery {
    pub start: String,
    pub end: String,
}

/// True for a well-formed YYYY-MM-DD string (dates are stored in that form, so string order = date order).
fn is_iso_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
}

pub async fn daily_spending(
    State(state): State<AppState>,
    Query(q): Query<SpendingQuery>,
) -> AppResult<Json<Vec<crate::views::DailySpendingView>>> {
    if !is_iso_date(&q.start) || !is_iso_date(&q.end) || q.start > q.end {
        return Err(crate::error::AppError::BadRequest("start and end must be YYYY-MM-DD, start <= end"));
    }
    let days = Transaction::daily_spending(&state.pool, &q.start, &q.end).await?;
    Ok(Json(days.into_iter().map(Into::into).collect()))
}

#[cfg(test)]
mod tests {
    #[test]
    fn iso_date_check() {
        assert!(super::is_iso_date("2026-11-02"));
        assert!(!super::is_iso_date("2026-1-02"));
        assert!(!super::is_iso_date("2026/11/02"));
        assert!(!super::is_iso_date("20261102xx"));
    }
}
