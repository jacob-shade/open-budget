use axum::{
    Json,
    extract::{Path, State},
};
use std::collections::BTreeMap;

use serde::Deserialize;

use crate::{
    AppState,
    error::{AppError, AppResult},
    models::account::Account,
    services::net_worth,
    views::{AccountView, NetWorthPointView, render},
};

pub async fn index(State(state): State<AppState>) -> AppResult<Json<Vec<AccountView>>> {
    Ok(Json(render(Account::all(&state.pool).await?)))
}

#[derive(Deserialize)]
pub struct UpdateAccount {
    /// Business to link the account to; null makes it personal.
    business_id: Option<i64>,
}

/// Links an account to a business, or makes it personal again.
pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateAccount>,
) -> AppResult<axum::http::StatusCode> {
    if let Some(b) = body.business_id {
        let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM businesses WHERE id = ?").bind(b).fetch_optional(&state.pool).await?;
        if exists.is_none() {
            return Err(AppError::BadRequest("no such business"));
        }
    }
    if !Account::set_business(&state.pool, &id, body.business_id).await? {
        return Err(AppError::NotFound);
    }
    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct HistoryQuery {
    /// Oldest day (YYYY-MM-DD). Omitted: from the earliest transaction.
    start: Option<String>,
    /// Newest day, normally the browser's "today" (YYYY-MM-DD).
    end: String,
}

/// Estimated net worth for each day in the range (see services::net_worth for the method).
pub async fn net_worth_history(
    State(state): State<AppState>,
    axum::extract::Query(q): axum::extract::Query<HistoryQuery>,
) -> AppResult<Json<Vec<NetWorthPointView>>> {
    let bad = || AppError::BadRequest("start and end must be YYYY-MM-DD, start <= end");
    let end = net_worth::parse_date(&q.end).ok_or_else(bad)?;
    let start = match &q.start {
        Some(s) => net_worth::parse_date(s).ok_or_else(bad)?,
        None => {
            let earliest: Option<String> = sqlx::query_scalar("SELECT MIN(date) FROM transactions").fetch_one(&state.pool).await?;
            earliest.as_deref().and_then(net_worth::parse_date).unwrap_or(end).min(end)
        }
    };
    if start > end {
        return Err(bad());
    }
    let start = start.max(end - time::Duration::days(net_worth::MAX_DAYS));

    let now_cents: i64 = Account::all(&state.pool)
        .await?
        .iter()
        .map(|a| {
            let b = a.current_balance_cents.unwrap_or(0);
            if matches!(a.account_type.as_str(), "credit" | "loan") { -b } else { b }
        })
        .sum();
    let sums: BTreeMap<String, i64> =
        sqlx::query_as::<_, (String, i64)>("SELECT date, SUM(amount_cents) FROM transactions WHERE date > ? GROUP BY date")
            .bind(net_worth::format_date(start))
            .fetch_all(&state.pool)
            .await?
            .into_iter()
            .collect();

    let points = net_worth::reconstruct(now_cents, &sums, start, end)
        .into_iter()
        .map(|(date, net_worth_cents)| NetWorthPointView { date, net_worth_cents })
        .collect();
    Ok(Json(points))
}
