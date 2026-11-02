//! Controllers: HTTP handlers. They parse requests, call models/services, and render views.

mod accounts;
mod items;
mod plaid;
mod transactions;

use axum::{
    Router,
    routing::{delete, get, post},
};

use crate::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(|| async { "ok" }))
        .route("/api/plaid/link-token", post(plaid::create_link_token))
        .route("/api/plaid/exchange", post(plaid::exchange_public_token))
        .route("/api/items", get(items::index))
        .route("/api/items/{id}", delete(items::destroy))
        .route("/api/items/{id}/sync", post(items::sync))
        .route("/api/sync", post(items::sync_all))
        .route("/api/accounts", get(accounts::index))
        .route("/api/transactions", get(transactions::index))
        .with_state(state)
}
