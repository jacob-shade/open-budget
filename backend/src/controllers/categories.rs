//! Categories: list, create, rename / re-emoji / change type, reorder, delete.

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};

use crate::{
    AppState,
    error::AppResult,
    models::category::{self as m, Category, CategoryInput},
};

pub async fn index(State(s): State<AppState>) -> AppResult<Json<Vec<Category>>> {
    Ok(Json(m::list(&s.pool).await?))
}

pub async fn create(State(s): State<AppState>, Json(input): Json<CategoryInput>) -> AppResult<Json<Category>> {
    Ok(Json(m::create(&s.pool, &input).await?))
}

pub async fn update(State(s): State<AppState>, Path(id): Path<i64>, Json(input): Json<CategoryInput>) -> AppResult<Json<Category>> {
    Ok(Json(m::update(&s.pool, id, &input).await?))
}

pub async fn destroy(State(s): State<AppState>, Path(id): Path<i64>) -> AppResult<StatusCode> {
    m::delete(&s.pool, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(serde::Deserialize)]
pub struct OrderInput {
    /// Category ids in their new order (one bucket's list).
    pub ids: Vec<i64>,
}

pub async fn reorder(State(s): State<AppState>, Json(input): Json<OrderInput>) -> AppResult<StatusCode> {
    m::reorder(&s.pool, &input.ids).await?;
    Ok(StatusCode::NO_CONTENT)
}
