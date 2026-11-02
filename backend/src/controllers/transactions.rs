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
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

pub async fn index(
    State(state): State<AppState>,
    Query(q): Query<TransactionQuery>,
) -> AppResult<Json<Vec<TransactionView>>> {
    let filter = TransactionFilter {
        account_id: q.account_id,
        limit: q.limit.unwrap_or(100).clamp(1, 500),
        offset: q.offset.unwrap_or(0).max(0),
    };
    Ok(Json(render(Transaction::list(&state.pool, &filter).await?)))
}
