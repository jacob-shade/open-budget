//! Businesses and their records. Every route is under /api/businesses and requires sign-in.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};

use crate::{
    AppState,
    error::{AppError, AppResult},
    models::business::{self as m, BusinessError},
};

impl From<BusinessError> for AppError {
    fn from(e: BusinessError) -> Self {
        match e {
            BusinessError::Invalid(msg) => AppError::BadRequest(msg),
            BusinessError::NotFound => AppError::NotFound,
            BusinessError::Db(e) => AppError::Db(e),
        }
    }
}

#[derive(Serialize)]
pub struct Created {
    id: i64,
}

// ---------- businesses ----------

pub async fn index(State(s): State<AppState>) -> AppResult<Json<Vec<m::Business>>> {
    Ok(Json(m::list_businesses(&s.pool).await?))
}

#[derive(Deserialize)]
pub struct NewBusiness {
    name: String,
    kind: String,
}

pub async fn create(State(s): State<AppState>, Json(b): Json<NewBusiness>) -> AppResult<Json<m::Business>> {
    Ok(Json(m::create_business(&s.pool, &b.name, &b.kind).await?))
}

#[derive(Deserialize)]
pub struct Rename {
    name: String,
}

pub async fn update(State(s): State<AppState>, Path(id): Path<i64>, Json(b): Json<Rename>) -> AppResult<Json<m::Business>> {
    Ok(Json(m::rename_business(&s.pool, id, &b.name).await?))
}

pub async fn destroy(State(s): State<AppState>, Path(id): Path<i64>) -> AppResult<StatusCode> {
    m::delete_business(&s.pool, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct Period {
    start: String,
    end: String,
}

/// One business's assets now and profit for the period.
pub async fn summary(State(s): State<AppState>, Path(id): Path<i64>, Query(p): Query<Period>) -> AppResult<Json<m::Summary>> {
    m::get_business(&s.pool, id).await?;
    Ok(Json(m::summary(&s.pool, Some(id), &p.start, &p.end).await?))
}

/// All businesses combined (for the Overview).
pub async fn summary_all(State(s): State<AppState>, Query(p): Query<Period>) -> AppResult<Json<m::Summary>> {
    Ok(Json(m::summary(&s.pool, None, &p.start, &p.end).await?))
}

// ---------- items ----------

pub async fn items(State(s): State<AppState>, Path(id): Path<i64>) -> AppResult<Json<Vec<m::Item>>> {
    m::get_business(&s.pool, id).await?;
    Ok(Json(m::list_items(&s.pool, id).await?))
}

pub async fn create_item(State(s): State<AppState>, Path(id): Path<i64>, Json(n): Json<m::NewItem>) -> AppResult<Json<m::Item>> {
    Ok(Json(m::create_item(&s.pool, id, &n).await?))
}

pub async fn update_item(
    State(s): State<AppState>,
    Path((id, item)): Path<(i64, i64)>,
    Json(u): Json<m::ItemUpdate>,
) -> AppResult<Json<m::Item>> {
    Ok(Json(m::update_item(&s.pool, id, item, &u).await?))
}

pub async fn delete_item(State(s): State<AppState>, Path((id, item)): Path<(i64, i64)>) -> AppResult<StatusCode> {
    m::delete_item(&s.pool, id, item).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- sales ----------

pub async fn sales(State(s): State<AppState>, Path(id): Path<i64>) -> AppResult<Json<Vec<m::Sale>>> {
    m::get_business(&s.pool, id).await?;
    Ok(Json(m::list_sales(&s.pool, id).await?))
}

pub async fn create_sale(State(s): State<AppState>, Path(id): Path<i64>, Json(n): Json<m::NewSale>) -> AppResult<Json<Created>> {
    Ok(Json(Created { id: m::create_sale(&s.pool, id, &n).await? }))
}

pub async fn delete_sale(State(s): State<AppState>, Path((id, sale)): Path<(i64, i64)>) -> AppResult<StatusCode> {
    m::delete_sale(&s.pool, id, sale).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- trades ----------

pub async fn trades(State(s): State<AppState>, Path(id): Path<i64>) -> AppResult<Json<Vec<m::Trade>>> {
    m::get_business(&s.pool, id).await?;
    Ok(Json(m::list_trades(&s.pool, id).await?))
}

pub async fn create_trade(State(s): State<AppState>, Path(id): Path<i64>, Json(n): Json<m::NewTrade>) -> AppResult<Json<Created>> {
    Ok(Json(Created { id: m::create_trade(&s.pool, id, &n).await? }))
}

pub async fn delete_trade(State(s): State<AppState>, Path((id, trade)): Path<(i64, i64)>) -> AppResult<StatusCode> {
    m::delete_trade(&s.pool, id, trade).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- expenses & cash ----------

pub async fn expenses(State(s): State<AppState>, Path(id): Path<i64>) -> AppResult<Json<Vec<m::Expense>>> {
    m::get_business(&s.pool, id).await?;
    Ok(Json(m::list_expenses(&s.pool, id).await?))
}

pub async fn create_expense(State(s): State<AppState>, Path(id): Path<i64>, Json(n): Json<m::NewExpense>) -> AppResult<Json<Created>> {
    Ok(Json(Created { id: m::create_expense(&s.pool, id, &n).await? }))
}

pub async fn delete_expense(State(s): State<AppState>, Path((id, row)): Path<(i64, i64)>) -> AppResult<StatusCode> {
    m::delete_row(&s.pool, "business_expenses", id, row).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn cash(State(s): State<AppState>, Path(id): Path<i64>) -> AppResult<Json<Vec<m::CashAdjustment>>> {
    m::get_business(&s.pool, id).await?;
    Ok(Json(m::list_cash(&s.pool, id).await?))
}

pub async fn create_cash(State(s): State<AppState>, Path(id): Path<i64>, Json(n): Json<m::NewCashAdjustment>) -> AppResult<Json<Created>> {
    Ok(Json(Created { id: m::create_cash(&s.pool, id, &n).await? }))
}

pub async fn delete_cash(State(s): State<AppState>, Path((id, row)): Path<(i64, i64)>) -> AppResult<StatusCode> {
    m::delete_row(&s.pool, "cash_adjustments", id, row).await?;
    Ok(StatusCode::NO_CONTENT)
}
