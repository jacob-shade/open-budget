use axum::{Json, extract::State};

use crate::{
    AppState,
    error::AppResult,
    models::account::Account,
    views::{AccountView, render},
};

pub async fn index(State(state): State<AppState>) -> AppResult<Json<Vec<AccountView>>> {
    Ok(Json(render(Account::all(&state.pool).await?)))
}
