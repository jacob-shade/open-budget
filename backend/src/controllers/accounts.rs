use axum::{
    Json,
    extract::{Path, State},
};
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

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

    // Assets and debts are reconstructed separately (same method), so they can be shown side by side.
    // Debts are signed negative while reconstructing, like their effect on net worth.
    let accounts = Account::all(&state.pool).await?;
    let is_debt = |t: &str| matches!(t, "credit" | "loan");
    let now_assets: i64 = accounts.iter().filter(|a| !is_debt(&a.account_type)).map(|a| a.current_balance_cents.unwrap_or(0)).sum();
    let now_debts: i64 = -accounts.iter().filter(|a| is_debt(&a.account_type)).map(|a| a.current_balance_cents.unwrap_or(0)).sum::<i64>();
    let rows: Vec<(String, i64, i64)> = sqlx::query_as(
        "SELECT t.date,
                SUM(CASE WHEN a.account_type IN ('credit', 'loan') THEN 0 ELSE t.amount_cents END),
                SUM(CASE WHEN a.account_type IN ('credit', 'loan') THEN t.amount_cents ELSE 0 END)
         FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.date > ? GROUP BY t.date",
    )
    .bind(net_worth::format_date(start))
    .fetch_all(&state.pool)
    .await?;
    let asset_sums: BTreeMap<String, i64> = rows.iter().map(|(d, a, _)| (d.clone(), *a)).collect();
    let debt_sums: BTreeMap<String, i64> = rows.iter().map(|(d, _, l)| (d.clone(), *l)).collect();

    let assets = net_worth::reconstruct(now_assets, &asset_sums, start, end);
    let debts = net_worth::reconstruct(now_debts, &debt_sums, start, end);
    let points = assets
        .into_iter()
        .zip(debts)
        .map(|((date, a), (_, d))| NetWorthPointView { date, net_worth_cents: a + d, assets_cents: a, debts_cents: -d })
        .collect();
    Ok(Json(points))
}

#[derive(Serialize)]
pub struct CreatedAccount {
    id: String,
}

/// Adds an account you track by hand.
pub async fn create_manual(
    State(state): State<AppState>,
    Json(input): Json<crate::models::manual_account::ManualAccountInput>,
) -> AppResult<Json<CreatedAccount>> {
    Ok(Json(CreatedAccount { id: crate::models::manual_account::create(&state.pool, &input).await? }))
}

pub async fn update_manual(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<crate::models::manual_account::ManualAccountInput>,
) -> AppResult<axum::http::StatusCode> {
    crate::models::manual_account::update(&state.pool, &id, &input).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub async fn delete_manual(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<axum::http::StatusCode> {
    crate::models::manual_account::delete(&state.pool, &id).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct SetApy {
    /// Basis points (3.50% = 350); null clears it.
    apy_bps: Option<i64>,
}

/// Sets the interest rate (APY) for an account; Plaid doesn't report savings rates.
pub async fn set_apy(State(state): State<AppState>, Path(id): Path<String>, Json(body): Json<SetApy>) -> AppResult<axum::http::StatusCode> {
    if body.apy_bps.is_some_and(|b| !(0..=10000).contains(&b)) {
        return Err(AppError::BadRequest("APY must be between 0% and 100%"));
    }
    if !Account::set_apy(&state.pool, &id, body.apy_bps).await? {
        return Err(AppError::NotFound);
    }
    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct Rename {
    /// The name to show; null or empty goes back to the bank's name.
    nickname: Option<String>,
}

/// Renames a linked account (the bank's name is kept and comes back if you clear this).
pub async fn rename(State(state): State<AppState>, Path(id): Path<String>, Json(body): Json<Rename>) -> AppResult<axum::http::StatusCode> {
    if id.starts_with(crate::models::account::MANUAL_PREFIX) {
        return Err(AppError::BadRequest("rename manual accounts with Update"));
    }
    if body.nickname.as_deref().is_some_and(|n| n.trim().chars().count() > 100) {
        return Err(AppError::BadRequest("names must be 100 characters or fewer"));
    }
    if !Account::set_nickname(&state.pool, &id, body.nickname.as_deref()).await? {
        return Err(AppError::NotFound);
    }
    Ok(axum::http::StatusCode::NO_CONTENT)
}
