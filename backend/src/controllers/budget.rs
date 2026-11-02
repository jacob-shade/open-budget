//! Budget page data: income planned vs actual, bucket percentages, and category spending.

use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use serde::Deserialize;

use crate::{
    AppState,
    error::{AppError, AppResult},
    models::budget::{self as m, Budget, IncomePlan, Percentages},
    services::net_worth::parse_date,
};

#[derive(Deserialize)]
pub struct Period {
    start: String,
    end: String,
}

pub async fn show(State(s): State<AppState>, Query(p): Query<Period>) -> AppResult<Json<Budget>> {
    match (parse_date(&p.start), parse_date(&p.end)) {
        (Some(a), Some(b)) if a <= b => Ok(Json(m::budget(&s.pool, &p.start, &p.end).await?)),
        _ => Err(AppError::BadRequest("start and end must be YYYY-MM-DD, start <= end")),
    }
}

pub async fn set_percentages(State(s): State<AppState>, Json(p): Json<Percentages>) -> AppResult<Json<Percentages>> {
    Ok(Json(m::set_percentages(&s.pool, p).await?))
}

pub async fn set_income_plan(State(s): State<AppState>, Json(p): Json<IncomePlan>) -> AppResult<StatusCode> {
    m::set_income_plan(&s.pool, &p).await?;
    Ok(StatusCode::NO_CONTENT)
}
