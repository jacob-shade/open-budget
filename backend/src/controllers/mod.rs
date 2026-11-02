//! Controllers: HTTP handlers. They parse requests, call models/services, and render views.

mod accounts;
mod auth;
mod business;
mod items;
mod plaid;
mod transactions;

use axum::{
    Router, middleware,
    routing::{delete, get, patch, post},
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
        .route("/api/accounts/{id}", patch(accounts::update))
        .route("/api/net-worth/history", get(accounts::net_worth_history))
        .route("/api/business-summary", get(business::summary_all))
        .route("/api/businesses", get(business::index).post(business::create))
        .route("/api/businesses/{id}", patch(business::update).delete(business::destroy))
        .route("/api/businesses/{id}/summary", get(business::summary))
        .route("/api/businesses/{id}/items", get(business::items).post(business::create_item))
        .route("/api/businesses/{id}/items/{item}", patch(business::update_item).delete(business::delete_item))
        .route("/api/businesses/{id}/sales", get(business::sales).post(business::create_sale))
        .route("/api/businesses/{id}/sales/{sale}", delete(business::delete_sale))
        .route("/api/businesses/{id}/trades", get(business::trades).post(business::create_trade))
        .route("/api/businesses/{id}/trades/{trade}", delete(business::delete_trade))
        .route("/api/businesses/{id}/expenses", get(business::expenses).post(business::create_expense))
        .route("/api/businesses/{id}/expenses/{row}", delete(business::delete_expense))
        .route("/api/businesses/{id}/cash", get(business::cash).post(business::create_cash))
        .route("/api/businesses/{id}/cash/{row}", delete(business::delete_cash))
        .route("/api/transactions", get(transactions::index))
        .route("/api/transactions/summary", get(transactions::summary))
        .route("/api/spending/daily", get(transactions::daily_spending))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::require_auth));

    public.merge(protected).with_state(state)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::{
        body::Body,
        http::{Request, StatusCode, header},
    };
    use http_body_util::BodyExt;
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use crate::{
        AppState,
        config::Config,
        models::{session::Session, user::User},
        services::{crypto::unix_now, google::GoogleClient, plaid::PlaidClient},
    };

    /// The real router over an in-memory database, plus a fully signed-in session cookie.
    async fn app() -> (axum::Router, String) {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(sqlx::sqlite::SqliteConnectOptions::new().in_memory(true).foreign_keys(true))
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let config = Config {
            plaid_client_id: "x".into(),
            plaid_secret: "x".into(),
            plaid_env: "sandbox".into(),
            plaid_redirect_uri: None,
            google_client_id: "x".into(),
            google_client_secret: "x".into(),
            allowed_emails: vec!["me@example.com".into()],
            public_url: "http://localhost:3000".into(),
            cookie_secure: false,
            database_url: "sqlite::memory:".into(),
            database_key: crate::db::DatabaseKey::parse(&"ab".repeat(32)).unwrap(),
            port: 0,
            bind_addr: [127, 0, 0, 1].into(),
            static_dir: None,
        };
        let user = User::upsert_from_google(&pool, "sub", "me@example.com", None, None).await.unwrap();
        let token = Session::create(&pool, user, true, unix_now(), 3600).await.unwrap();
        let state = AppState {
            plaid: Arc::new(PlaidClient::new(&config)),
            google: Arc::new(GoogleClient::new(&config)),
            config: Arc::new(config),
            pool,
        };
        (super::router(state), format!("ob_session={token}"))
    }

    async fn call(app: &axum::Router, cookie: Option<&str>, method: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
        let mut req = Request::builder().method(method).uri(uri);
        if let Some(c) = cookie {
            req = req.header(header::COOKIE, c);
        }
        let req = match body {
            Some(b) => req.header(header::CONTENT_TYPE, "application/json").body(Body::from(b.to_string())),
            None => req.body(Body::empty()),
        }
        .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
    }

    #[tokio::test]
    async fn business_routes_work_end_to_end_and_require_sign_in() {
        let (app, cookie) = app().await;
        let c = Some(cookie.as_str());

        assert_eq!(call(&app, None, "GET", "/api/businesses", None).await.0, StatusCode::UNAUTHORIZED);
        assert_eq!(call(&app, None, "POST", "/api/businesses", Some(json!({"name": "x", "kind": "general"}))).await.0, StatusCode::UNAUTHORIZED);

        let (s, b) = call(&app, c, "POST", "/api/businesses", Some(json!({"name": "Card Shop", "kind": "collectibles"}))).await;
        assert_eq!(s, StatusCode::OK, "{b}");
        let id = b["id"].as_i64().unwrap();
        assert_eq!(call(&app, c, "POST", "/api/businesses", Some(json!({"name": "", "kind": "general"}))).await.0, StatusCode::BAD_REQUEST);

        let base = format!("/api/businesses/{id}");
        let (s, item) = call(&app, c, "POST", &format!("{base}/items"), Some(json!({
            "name": "Charizard", "acquired_date": "2026-11-01", "acquired_via": "purchase", "purchase_paid_via": "cash",
            "cost_cents": 4000, "estimated_value_cents": 9000
        }))).await;
        assert_eq!(s, StatusCode::OK, "{item}");
        let item_id = item["id"].as_i64().unwrap();
        let (s, edited) = call(&app, c, "PATCH", &format!("{base}/items/{item_id}"), Some(json!({"estimated_value_cents": 10000, "condition": "PSA 9"}))).await;
        assert_eq!((s, edited["estimated_value_cents"].as_i64(), edited["condition"].as_str()), (StatusCode::OK, Some(10000), Some("PSA 9")));

        assert_eq!(call(&app, c, "POST", &format!("{base}/cash"), Some(json!({"date": "2026-11-01", "amount_cents": 20000, "description": "Start"}))).await.0, StatusCode::OK);
        assert_eq!(call(&app, c, "POST", &format!("{base}/expenses"), Some(json!({"date": "2026-11-02", "category": "protection", "amount_cents": 1500, "paid_via": "cash"}))).await.0, StatusCode::OK);
        let (s, sale) = call(&app, c, "POST", &format!("{base}/sales"), Some(json!({"date": "2026-11-03", "item_ids": [item_id], "total_cents": 12000, "fees_cents": 1000, "paid_via": "bank"}))).await;
        assert_eq!(s, StatusCode::OK, "{sale}");
        let (s, trade) = call(&app, c, "POST", &format!("{base}/trades"), Some(json!({
            "date": "2026-11-04", "given_item_ids": [], "received": [{"name": "Pikachu", "estimated_value_cents": 3000}], "cash_out_cents": 2500, "paid_via": "cash"
        }))).await;
        assert_eq!(s, StatusCode::OK, "{trade}");

        let (s, sum) = call(&app, c, "GET", &format!("{base}/summary?start=2026-11-01&end=2026-11-30"), None).await;
        assert_eq!(s, StatusCode::OK);
        // Cash: 200 − 40 (cash buy) − 15 (sleeves) − 25 (trade) = 120; the bank sale doesn't touch cash.
        assert_eq!(sum["cash_on_hand_cents"], 12000);
        assert_eq!(sum["profit_cents"], 12000 - 4000 - 1000 - 1500);
        assert_eq!((sum["inventory_count"].as_i64(), sum["inventory_cost_cents"].as_i64()), (Some(1), Some(2500)));
        let (_, all) = call(&app, c, "GET", "/api/business-summary?start=2026-11-01&end=2026-11-30", None).await;
        assert_eq!(all["profit_cents"], sum["profit_cents"]);

        for list in ["items", "sales", "trades", "expenses", "cash"] {
            let (s, v) = call(&app, c, "GET", &format!("{base}/{list}"), None).await;
            assert_eq!(s, StatusCode::OK, "{list}");
            assert!(v.as_array().is_some_and(|a| !a.is_empty()), "{list} empty");
        }
        let sale_id = sale["id"].as_i64().unwrap();
        assert_eq!(call(&app, c, "DELETE", &format!("{base}/sales/{sale_id}"), None).await.0, StatusCode::NO_CONTENT);
        assert_eq!(call(&app, c, "DELETE", &format!("{base}/sales/{sale_id}"), None).await.0, StatusCode::NOT_FOUND);
        assert_eq!(call(&app, c, "GET", "/api/businesses/9999/items", None).await.0, StatusCode::NOT_FOUND);
        assert_eq!(call(&app, c, "PATCH", "/api/accounts/nope", Some(json!({"business_id": id}))).await.0, StatusCode::NOT_FOUND);
        assert_eq!(call(&app, c, "DELETE", &base, None).await.0, StatusCode::NO_CONTENT);
        assert_eq!(call(&app, c, "GET", "/api/businesses", None).await.1, json!([]));
    }
}
