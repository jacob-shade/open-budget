//! Controllers: HTTP handlers. They parse requests, call models/services, and render views.

mod accounts;
mod auth;
mod items;
mod plaid;
mod transactions;

use axum::{
    Router, middleware,
    routing::{delete, get, post},
};

use crate::AppState;

pub fn router(state: AppState) -> Router {
    // Reachable without signing in.
    let public = Router::new()
        .route("/api/health", get(|| async { "ok" }))
        .route("/api/auth/google/login", get(auth::google_login))
        .route("/api/auth/google/callback", get(auth::google_callback))
        .route("/api/auth/me", get(auth::me))
        .route("/api/auth/mfa/setup", post(auth::mfa_setup))
        .route("/api/auth/mfa/enable", post(auth::mfa_enable))
        .route("/api/auth/mfa/verify", post(auth::mfa_verify))
        .route("/api/auth/logout", post(auth::logout));

    // Everything that touches financial data requires Google sign-in + MFA.
    let protected = Router::new()
        .route("/api/plaid/link-token", post(plaid::create_link_token))
        .route("/api/plaid/exchange", post(plaid::exchange_public_token))
        .route("/api/items", get(items::index))
        .route("/api/items/{id}", delete(items::destroy))
        .route("/api/items/{id}/sync", post(items::sync))
        .route("/api/sync", post(items::sync_all))
        .route("/api/accounts", get(accounts::index))
        .route("/api/transactions", get(transactions::index))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::require_auth));

    public.merge(protected).with_state(state)
}
